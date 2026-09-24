import {
  getPurchasePriceValue,
  isRefOnlyItem,
  selectWeaponPurchasePrice,
} from '../../data/price/priceMapper.js';

// With Ref disabled, items that only Ref sells are removed from the search.
// Modules the user pinned explicitly stay available.
export function excludeRefOnlyItems(modMap, options = {}) {
  if (options.includeRefOffers !== false || !modMap) return modMap;

  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  let removed = false;
  const filtered = {};
  for (const [itemId, item] of Object.entries(modMap)) {
    if (!requiredItemIds.has(itemId) && isRefOnlyItem(item)) {
      removed = true;
      continue;
    }
    filtered[itemId] = item;
  }
  return removed ? filtered : modMap;
}

export function createPricingTools(calculationCache, options) {
  function getItemPrice(item) {
    if (calculationCache.itemPricesByItem.has(item)) {
      return calculationCache.itemPricesByItem.get(item);
    }

    const price = getPurchasePriceValue(item, options, Number.POSITIVE_INFINITY);
    calculationCache.itemPricesByItem.set(item, price);
    return price;
  }

  function getWeaponPrice(weapon) {
    if (calculationCache.itemPricesByItem.has(weapon)) {
      return calculationCache.itemPricesByItem.get(weapon);
    }

    const priceInfo = selectWeaponPurchasePrice(weapon, options);
    const price = Number.isFinite(priceInfo.value) && priceInfo.value > 0
      ? priceInfo.value
      : Number.POSITIVE_INFINITY;
    calculationCache.itemPricesByItem.set(weapon, price);
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
    getWeaponPrice,
  };
}
