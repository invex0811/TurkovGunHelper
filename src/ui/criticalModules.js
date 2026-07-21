export const CRITICAL_MODULE_TOOLTIP = 'This module is required for the weapon to function correctly.';
export const EMPTY_CRITICAL_MODULE_WARNING = 'Required module is not installed';

export function isCriticalSlot(slot) {
  return slot?.required === true;
}

export function getModuleDisplayState(slot, item) {
  const isCritical = isCriticalSlot(slot);
  const isEmpty = !item;

  return {
    isCritical,
    isEmpty,
    showCriticalBadge: isCritical,
    emptyWarning: isCritical && isEmpty ? EMPTY_CRITICAL_MODULE_WARNING : null,
  };
}

export function getModuleDisplayRank(item) {
  if (item?.isCritical && item?.isEmpty) return 0;
  if (item?.isCritical) return 1;
  return 2;
}

export function sortModuleDisplayItems(items) {
  return [...items]
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => (
      getModuleDisplayRank(a.item) - getModuleDisplayRank(b.item)
      || a.originalIndex - b.originalIndex
    ))
    .map(({ item }) => item);
}
