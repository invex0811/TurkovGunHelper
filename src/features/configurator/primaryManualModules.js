import { isSelectableScope } from './scopeOptions.js';
import { getTacticalDeviceType } from './tacticalDeviceOptions.js';

export const PRIMARY_MANUAL_MODULE_TYPES = Object.freeze({
  SCOPE: 'scope',
  FLASHLIGHT: 'flashlight',
  TBL: 'tbl',
});

export function getPrimaryManualModuleType(item) {
  if (isSelectableScope(item)) return PRIMARY_MANUAL_MODULE_TYPES.SCOPE;

  const tacticalDeviceType = getTacticalDeviceType(item);
  if (tacticalDeviceType === 'flashlight') return PRIMARY_MANUAL_MODULE_TYPES.FLASHLIGHT;
  if (tacticalDeviceType === 'tbl') return PRIMARY_MANUAL_MODULE_TYPES.TBL;
  return null;
}

export function replacePrimaryManualModuleId(moduleIds, previousId, nextId) {
  const nextIds = moduleIds.filter(itemId => itemId !== previousId);
  if (nextId) nextIds.push(nextId);
  return [...new Set(nextIds)];
}

export function getUniqueItemIds(itemIds) {
  return [...new Set(itemIds.filter(Boolean))];
}
