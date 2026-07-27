export function createCalculationCache() {
  return {
    categoryNamesByItem: new WeakMap(),
    conflictIdsByItem: new WeakMap(),
    itemPricesByItem: new WeakMap(),
    sortedSlotsBySource: new WeakMap(),
    filteredAllowedItemsBySource: new WeakMap(),
    minimumRequiredPricesByItem: new WeakMap(),
    minimumRequiredPricesBySlot: new WeakMap(),
    minimumRequiredWeightsByItem: new WeakMap(),
    minimumRequiredWeightsBySlot: new WeakMap(),
    slotPrioritiesByName: new Map(),
  };
}
