import { hasItemCategory } from '../../domain/itemCategories.js';

export const TACTICAL_DEVICE_TYPES = Object.freeze({
  FLASHLIGHT: 'flashlight',
  TBL: 'tbl',
});

const CATEGORY_BY_TYPE = Object.freeze({
  [TACTICAL_DEVICE_TYPES.FLASHLIGHT]: 'Flashlight',
  [TACTICAL_DEVICE_TYPES.TBL]: 'Comb. tact. device',
});

function isCombinedTacticalDevice(item) {
  return hasItemCategory(item, CATEGORY_BY_TYPE[TACTICAL_DEVICE_TYPES.TBL]);
}

export function getTacticalDeviceType(item) {
  if (!item?.id) return null;

  // A combined device is the more specific tactical category. This also keeps
  // an item added from Advanced settings bound to a single primary control.
  if (isCombinedTacticalDevice(item)) {
    return TACTICAL_DEVICE_TYPES.TBL;
  }
  if (hasItemCategory(item, CATEGORY_BY_TYPE[TACTICAL_DEVICE_TYPES.FLASHLIGHT])) {
    return TACTICAL_DEVICE_TYPES.FLASHLIGHT;
  }
  return null;
}

export function getTacticalDeviceOptions(allMods, type) {
  if (!allMods || !CATEGORY_BY_TYPE[type]) return [];

  return Object.values(allMods)
    .filter(item => item?.id && (
      type === TACTICAL_DEVICE_TYPES.TBL
        ? isCombinedTacticalDevice(item)
        : hasItemCategory(item, CATEGORY_BY_TYPE[TACTICAL_DEVICE_TYPES.FLASHLIGHT])
    ))
    .sort((first, second) => (
      (first.shortName || first.name || first.id).localeCompare(second.shortName || second.name || second.id)
    ));
}

export function isTacticalDeviceReachable(weapon, allMods, itemId) {
  if (!weapon?.id || !allMods?.[itemId]) return false;

  const visitedItemIds = new Set();
  const visit = item => {
    if (!item?.id || visitedItemIds.has(item.id)) return false;
    if (item.id === itemId) return true;
    visitedItemIds.add(item.id);
    return (item.properties?.slots || []).some(slot => (
      (slot.filters?.allowedItems || []).some(reference => visit(allMods[reference.id]))
    ));
  };

  return visit(weapon);
}
