import { hasItemCategory } from '../../domain/itemCategories.js';

export const TACTICAL_DEVICE_TYPES = Object.freeze({
  FLASHLIGHT: 'flashlight',
  TBL: 'tbl',
});

const CATEGORY_BY_TYPE = Object.freeze({
  [TACTICAL_DEVICE_TYPES.FLASHLIGHT]: 'Flashlight',
  [TACTICAL_DEVICE_TYPES.TBL]: 'Comb. tact. device',
});

export function getTacticalDeviceType(item) {
  if (!item?.id) return null;

  // A combined device is the more specific tactical category. This also keeps
  // an item added from Advanced settings bound to a single primary control.
  if (hasItemCategory(item, CATEGORY_BY_TYPE[TACTICAL_DEVICE_TYPES.TBL])) {
    return TACTICAL_DEVICE_TYPES.TBL;
  }
  if (hasItemCategory(item, CATEGORY_BY_TYPE[TACTICAL_DEVICE_TYPES.FLASHLIGHT])) {
    return TACTICAL_DEVICE_TYPES.FLASHLIGHT;
  }
  return null;
}

export function getTacticalDeviceOptions(allMods, type) {
  const category = CATEGORY_BY_TYPE[type];
  if (!allMods || !category) return [];

  return Object.values(allMods)
    .filter(item => item?.id && hasItemCategory(item, category))
    .sort((first, second) => (
      (first.shortName || first.name || first.id).localeCompare(second.shortName || second.name || second.id)
    ));
}
