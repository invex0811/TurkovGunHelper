import { getPurchasePriceValue } from '../../data/price/priceMapper.js';

export function createPricingTools(calculationCache, options) {
  function getItemPrice(item) {
    if (calculationCache.itemPricesByItem.has(item)) {
      return calculationCache.itemPricesByItem.get(item);
    }

    const price = getPurchasePriceValue(item, options, Number.POSITIVE_INFINITY);
    calculationCache.itemPricesByItem.set(item, price);
    return price;
  }

  function getItemConflictIds(item) {
    const cachedConflictIds = calculationCache.conflictIdsByItem.get(item);
    if (cachedConflictIds) return cachedConflictIds;

    const conflictIds = (item.conflictingItems || []).map(conflict => conflict.id);
    calculationCache.conflictIdsByItem.set(item, conflictIds);
    return conflictIds;
  }

  function addItemConflictsToSet(item, targetSet) {
    getItemConflictIds(item).forEach(conflictId => targetSet.add(conflictId));
  }

  return {
    addItemConflictsToSet,
    getItemConflictIds,
    getItemPrice,
  };
}
