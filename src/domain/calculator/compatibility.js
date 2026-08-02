import { getItemCategoryKeys, normalizeCategoryIdentifier } from '../itemCategories.js';

export function createCompatibilityTools(calculationCache) {
  function getCategoryKeys(item) {
    const cachedCategoryKeys = calculationCache.categoryNamesByItem.get(item);
    if (cachedCategoryKeys) return cachedCategoryKeys;

    const categoryKeys = getItemCategoryKeys(item);
    calculationCache.categoryNamesByItem.set(item, categoryKeys);
    return categoryKeys;
  }

  function hasCategory(item, categoryName) {
    return getCategoryKeys(item).has(normalizeCategoryIdentifier(categoryName));
  }

  function getSlotSearchName(slotName, slotNameId = '') {
    return `${slotName || ''} ${slotNameId || ''}`.toLowerCase().replace(/[_-]+/g, ' ');
  }

  function isStockSlot(slotName, slotNameId = '') {
    return getSlotSearchName(slotName, slotNameId).includes('stock');
  }

  function isPistolGripSlot(slotName, slotNameId = '') {
    const name = getSlotSearchName(slotName, slotNameId);
    return name.includes('pistol grip') || name.includes('mod_pistol_grip');
  }

  function isBarrelSlot(slotName, slotNameId = '') {
    return getSlotSearchName(slotName, slotNameId).includes('barrel');
  }

  function isMuzzleSlot(slotName, slotNameId = '') {
    const name = getSlotSearchName(slotName, slotNameId);
    return name.includes('muzzle') || name.includes('suppressor') || name.includes('silencer');
  }

  function isCombinedPistolGripStock(item) {
    const name = `${item.name || ''} ${item.shortName || ''}`.toLowerCase();
    return hasCategory(item, 'Stock')
      || name.includes('pistol grip/buttstock')
      || name.includes('grip/buttstock')
      || name.includes('pistol grip-stock')
      || name.includes('buttstock')
      || name.includes(' stock');
  }

  function isSuppressor(item) {
    return hasCategory(item, 'Silencer');
  }

  return {
    getSlotSearchName,
    hasCategory,
    isBarrelSlot,
    isCombinedPistolGripStock,
    isMuzzleSlot,
    isPistolGripSlot,
    isStockSlot,
    isSuppressor,
  };
}
