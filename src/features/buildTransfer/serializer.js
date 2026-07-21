import {
  BUILD_EXPORT_FORMAT,
  BUILD_EXPORT_VERSION,
  BUILD_GAME_MODES,
} from './constants.js';
import { buildWeaponAssemblyTree } from '../../domain/weaponAssembly.js';

const EXPORTED_SETTING_KEYS = [
  'targetType',
  'customProfile',
  'customExactTargets',
  'customErgonomics',
  'customVerticalRecoil',
  'customHorizontalRecoil',
  'customMaxWeight',
  'customMaxPrice',
  'customErgo',
  'customRecoil',
  'suppressorMode',
  'includeTraderPrices',
  'maxWeight',
  'maxPrice',
  'magazineCapacity',
  'includeLaser',
  'includeFlashlight',
  'sightMode',
  'requiredModuleIds',
];

function getGameMode(savedBuild) {
  return savedBuild?.settings?.priceMode === 'pve'
    ? BUILD_GAME_MODES.PVE
    : BUILD_GAME_MODES.REGULAR;
}

function copyExportedSettings(settings = {}) {
  return Object.fromEntries(
    EXPORTED_SETTING_KEYS
      .filter(key => Object.hasOwn(settings, key))
      .map(key => [key, structuredClone(settings[key])]),
  );
}

function getPartInstanceId(part) {
  if (!part?.slotInstanceId || !part?.itemId) return null;
  return `${part.slotInstanceId}/item:${encodeURIComponent(String(part.itemId)).replaceAll('%', '_')}`;
}

function getParentKey(part, weaponId, rootInstanceId, partByItemId) {
  if (part.parentInstanceId === rootInstanceId) return 'root';
  if (part.parentInstanceId) return part.parentInstanceId;
  if (part.parentItemId === weaponId) return 'root';
  if (part.parentItemId && partByItemId.has(part.parentItemId)) {
    return getPartInstanceId(partByItemId.get(part.parentItemId));
  }
  return null;
}

function getStableSlotId(slot, slotIndex) {
  return slot?.nameId || slot?.id || `slot:${slotIndex}`;
}

function serializeAssemblyNode(node) {
  return {
    itemId: node.item.id,
    slotId: node.parent ? getStableSlotId(node.sourceSlot, node.sourceSlotIndex) : null,
    ...(node.parent ? { slotIndex: node.sourceSlotIndex } : {}),
    children: node.children.map(serializeAssemblyNode),
  };
}

function isStableSlotReference(slotId, catalog) {
  if (!slotId || !catalog?.itemsById) return false;
  return Object.values(catalog.itemsById).some(item => (
    (item.properties?.slots || []).some((slot, slotIndex) => (
      slot.nameId === slotId
      || slot.id === slotId
      || `${slot.nameId || slot.id || slot.name || 'slot'}:${slotIndex}` === slotId
    ))
  ));
}

function serializeConfigurationFromCatalog(savedBuild, catalog) {
  const weapon = catalog?.itemsById?.[savedBuild.weapon.id];
  if (!weapon) throw new TypeError(`Weapon ${savedBuild.weapon.id} is not available in the selected catalog.`);
  const buildParts = savedBuild.parts.map(part => {
    const item = catalog.itemsById[part.itemId];
    if (!item) throw new TypeError(`Module ${part.itemId} is not available in the selected catalog.`);
    const hasRuntimeContext = Boolean(part.parentInstanceId || part.slotInstanceId)
      || Number.isInteger(part.slotIndex);
    return {
      slotName: part.slotName,
      ...(part.slotId && (hasRuntimeContext || isStableSlotReference(part.slotId, catalog))
        ? { slotId: part.slotId }
        : {}),
      ...(Number.isInteger(part.slotIndex) ? { slotIndex: part.slotIndex } : {}),
      ...(part.parentItemId ? { parentItemId: part.parentItemId } : {}),
      item,
    };
  });
  const assembly = buildWeaponAssemblyTree(weapon, buildParts);
  if (assembly.unattachedParts.length > 0) {
    const names = assembly.unattachedParts.map(part => part.item.shortName || part.item.name || part.item.id);
    throw new TypeError(`The saved build hierarchy could not be exported: ${names.join(', ')}.`);
  }
  return serializeAssemblyNode(assembly);
}

function serializeConfiguration(savedBuild, catalog) {
  if (catalog) return serializeConfigurationFromCatalog(savedBuild, catalog);
  const parts = Array.isArray(savedBuild.parts) ? savedBuild.parts : [];
  const partByItemId = new Map(parts.map(part => [part.itemId, part]));
  const nodeByInstanceId = new Map();
  const root = { itemId: savedBuild.weapon.id, slotId: null, children: [] };
  const rootInstanceId = `weapon:${encodeURIComponent(String(savedBuild.weapon.id)).replaceAll('%', '_')}`;

  const entries = parts.map((part, index) => {
    const node = {
      itemId: part.itemId,
      slotId: part.slotId || part.slotName || `legacy-slot:${index}`,
      ...(Number.isInteger(part.slotIndex) ? { slotIndex: part.slotIndex } : {}),
      children: [],
    };
    const instanceId = getPartInstanceId(part);
    if (instanceId) nodeByInstanceId.set(instanceId, node);
    return { part, node };
  });

  entries.forEach(({ part, node }) => {
    const parentKey = getParentKey(part, savedBuild.weapon.id, rootInstanceId, partByItemId);
    const parent = parentKey === 'root' ? root : nodeByInstanceId.get(parentKey);
    if (!parent) {
      throw new TypeError(`The saved parent of module ${part.itemId} cannot be resolved without the item catalog.`);
    }
    parent.children.push(node);
  });
  return root;
}

export function exportBuild(savedBuild, options = {}) {
  if (!savedBuild?.weapon?.id) throw new TypeError('A saved build with a weapon ID is required.');
  return {
    name: String(savedBuild.name || savedBuild.weapon.shortName || 'Weapon build').slice(0, 80),
    gameMode: getGameMode(savedBuild),
    weaponId: savedBuild.weapon.id,
    settings: copyExportedSettings(savedBuild.settings),
    configuration: serializeConfiguration(savedBuild, options.catalog),
  };
}

export function exportBuilds(savedBuilds, options = {}) {
  if (!Array.isArray(savedBuilds)) throw new TypeError('Saved builds must be an array.');
  return {
    format: BUILD_EXPORT_FORMAT,
    version: BUILD_EXPORT_VERSION,
    exportedAt: options.exportedAt || new Date().toISOString(),
    builds: savedBuilds.map(savedBuild => exportBuild(savedBuild, {
      catalog: options.catalogs?.[getGameMode(savedBuild)]
        || options.catalogs?.get?.(getGameMode(savedBuild))
        || options.catalog,
    })),
  };
}
