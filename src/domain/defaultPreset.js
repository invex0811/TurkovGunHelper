import { excludeUnavailableItems } from './calculator/pricing.js';
import {
  buildWeaponAssemblyTree,
  getBuildItemInstanceId,
  getBuildRootInstanceId,
  getBuildSlotId,
  getBuildSlotInstanceId,
} from './weaponAssembly.js';

// Bounds the slot search for presets that do not fit the weapon's slot tree.
const MAX_PLACEMENT_STEPS = 20_000;

const presetModuleIdsByWeapon = new WeakMap();

function getReferenceId(reference) {
  if (typeof reference === 'string') return reference;
  return reference?.id ?? null;
}

// Item ids the weapon's default preset installs, without the weapon itself.
// Tarkov.dev lists them flat in `containsItems`, one entry per item with a count.
export function getDefaultPresetModuleIds(weapon) {
  if (!weapon || typeof weapon !== 'object') return [];
  if (presetModuleIdsByWeapon.has(weapon)) return presetModuleIdsByWeapon.get(weapon);

  const moduleIds = (weapon.defaultPresetItem?.containsItems || []).flatMap(entry => {
    const itemId = getReferenceId(entry?.item);
    if (!itemId || itemId === weapon.id) return [];
    const count = Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1;
    return Array.from({ length: count }, () => itemId);
  });
  presetModuleIdsByWeapon.set(weapon, moduleIds);
  return moduleIds;
}

function createSlotContexts(parentItem, parentInstanceId) {
  return (parentItem.properties?.slots || []).map((slot, slotIndex) => ({
    slot,
    slotIndex,
    parentItem,
    parentInstanceId,
    allowedIds: new Set((slot.filters?.allowedItems || []).map(getReferenceId)),
  }));
}

// Places every preset module into a slot of the weapon or of another preset
// module. A module can fit several slots, so a dead end steps back and tries
// the next slot instead of leaving the module out.
function placeModules(openSlots, remainingItems, budget) {
  if (remainingItems.length === 0) return [];
  if (openSlots.length === 0) return null;
  budget.steps += 1;
  if (budget.steps > MAX_PLACEMENT_STEPS) return null;

  const [slotContext, ...otherSlots] = openSlots;
  const triedItemIds = new Set();

  for (let index = 0; index < remainingItems.length; index += 1) {
    const item = remainingItems[index];
    if (!slotContext.allowedIds.has(item.id) || triedItemIds.has(item.id)) continue;
    triedItemIds.add(item.id);

    const { slot, slotIndex, parentItem, parentInstanceId } = slotContext;
    const slotInstanceId = getBuildSlotInstanceId(parentInstanceId, slot, slotIndex);
    const part = {
      slotName: slot.name,
      slotId: getBuildSlotId(slot, slotIndex),
      slotIndex,
      slotInstanceId,
      parentItemId: parentItem.id,
      parentInstanceId,
      item,
    };
    const placedChildren = placeModules(
      [
        ...otherSlots,
        ...createSlotContexts(item, getBuildItemInstanceId(slotInstanceId, item)),
      ],
      remainingItems.filter((_, itemIndex) => itemIndex !== index),
      budget,
    );
    if (placedChildren) return [part, ...placedChildren];
  }

  return placeModules(otherSlots, remainingItems, budget);
}

// Build parts for the weapon's default preset, or null when the weapon has no
// preset or its modules are missing from the catalog or do not fit its slots.
export function assembleDefaultPresetBuild(weapon, allMods) {
  const moduleIds = getDefaultPresetModuleIds(weapon);
  if (moduleIds.length === 0 || !allMods) return null;

  const items = moduleIds.map(itemId => allMods[itemId]);
  if (items.some(item => !item)) return null;

  return placeModules(
    createSlotContexts(weapon, getBuildRootInstanceId(weapon)),
    items,
    { steps: 0 },
  );
}

// Ids of the default preset modules a build needs because nothing on sale
// can fill their required slots: the calculator drops modules that cannot be
// bought under the price policy, so such a slot blocks every build. Only those
// modules come from the preset; any other slot is left to the calculator.
export function getDefaultPresetFallbackItemIds(weapon, allMods, options = {}) {
  const presetBuild = assembleDefaultPresetBuild(weapon, allMods);
  if (!presetBuild) return [];

  const availableMods = excludeUnavailableItems(allMods, options);
  const fillableByItemId = new Map();

  function isItemFillable(itemId, visiting) {
    if (fillableByItemId.has(itemId)) return fillableByItemId.get(itemId);
    const item = availableMods[itemId];
    if (!item || visiting.has(itemId)) return false;

    visiting.add(itemId);
    const fillable = (item.properties?.slots || [])
      .filter(slot => slot.required === true)
      .every(slot => isSlotFillable(slot, visiting));
    visiting.delete(itemId);
    fillableByItemId.set(itemId, fillable);
    return fillable;
  }

  function isSlotFillable(slot, visiting = new Set([weapon.id])) {
    return (slot.filters?.allowedItems || [])
      .some(allowedItem => isItemFillable(getReferenceId(allowedItem), visiting));
  }

  const fallbackItemIds = [];
  function collectFallbackItems(node) {
    node.slots.forEach(({ slot, installedNode }) => {
      if (slot.required !== true || !installedNode || isSlotFillable(slot)) return;
      fallbackItemIds.push(installedNode.item.id);
      // The preset module is installed as is, so its own required slots must
      // be fillable too.
      collectFallbackItems(installedNode);
    });
  }
  collectFallbackItems(buildWeaponAssemblyTree(weapon, presetBuild));

  return [...new Set(fallbackItemIds)];
}

// Ids of the preset modules on the weapon's chain of required slots.
function getDefaultPresetRequiredItemIds(weapon, presetBuild) {
  const requiredItemIds = [];
  function collectRequiredItems(node) {
    node.slots.forEach(({ slot, installedNode }) => {
      if (slot.required !== true || !installedNode) return;
      requiredItemIds.push(installedNode.item.id);
      collectRequiredItems(installedNode);
    });
  }
  collectRequiredItems(buildWeaponAssemblyTree(weapon, presetBuild));
  return requiredItemIds;
}

// Preset module sets to pin, tried in order until a build fits. The fallback
// modules come first; a module on sale can still fail to fit (a conflict, a
// slot it does not match), so the next try takes the preset's whole chain of
// required slots. Empty when the preset cannot fill any blocked slot.
export function getDefaultPresetFallbackSteps(weapon, allMods, options = {}) {
  const fallbackItemIds = getDefaultPresetFallbackItemIds(weapon, allMods, options);
  if (fallbackItemIds.length === 0) return [];

  const requiredChainItemIds = [...new Set([
    ...fallbackItemIds,
    ...getDefaultPresetRequiredItemIds(weapon, assembleDefaultPresetBuild(weapon, allMods)),
  ])];
  return requiredChainItemIds.length > fallbackItemIds.length
    ? [fallbackItemIds, requiredChainItemIds]
    : [fallbackItemIds];
}
