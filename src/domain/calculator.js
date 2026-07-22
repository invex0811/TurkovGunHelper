import { getPurchasePriceValue } from '../data/price/priceMapper.js';
import {
  evaluateCustomExactTargets,
  getCustomExactTolerance,
  hasEnabledCustomExactTargets,
  normalizeCustomExactTargets,
} from './customExactTargets.js';
import { getItemCategoryKeys, normalizeCategoryIdentifier } from './itemCategories.js';

const PRICE_AWARE_TARGET = Symbol('priceAware');

function createCalculationCache() {
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

function _calculateWeighted(
  weapon,
  ergoWeight,
  recoilWeight,
  priceWeight,
  modMap,
  options = {},
  ergoCap = 100,
  targetType = 'custom',
  weightWeight = 0.001,
  overflowErgoWeight = 0,
  ergoSoftCap = ergoCap,
  calculationCache = createCalculationCache(),
) {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = getItemPrice(weapon);
  let hasSight = false;
  let hasSuppressorGlobal = hasCategory(weapon, 'Silencer');
  const requireSight = options.requireSight === true;
  const maxWeight = Number(options.maxWeight) || 0;
  const maxPrice = Number(options.maxPrice) || 0;
  const weightEpsilon = 0.0001;
  const requiredItemIds = new Set(
    (options.requiredItemIds || [])
      .map(String)
      .filter(itemId => itemId && itemId !== weapon.id && modMap[itemId]),
  );
  const requiredSightIds = new Set(
    [...requiredItemIds].filter(itemId => hasCategory(modMap[itemId], 'Sights')),
  );
  const requiredLaserIds = new Set(
    [...requiredItemIds].filter(itemId => hasCategory(modMap[itemId], 'Comb. tact. device')),
  );
  const requiredFlashlightIds = new Set(
    [...requiredItemIds].filter(itemId => hasCategory(modMap[itemId], 'Flashlight')),
  );
  const hasRequiredItemRequirements = requiredItemIds.size > 0;
  const missingRequiredSlotNames = new Set();

  let targetCapacity = 30;
  if (options.magazineCapacity !== undefined) {
    const parsed = Number(options.magazineCapacity);
    if (!isNaN(parsed) && parsed > 0) {
      targetCapacity = parsed;
    }
  }

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const installedIds = new Set([weapon.id]);
  const installedConflicts = new Set();
  if (weapon.conflictingItems) {
    weapon.conflictingItems.forEach(conflict => installedConflicts.add(conflict.id));
  }

  const slotPriority = {
    'pistol grip': 1,
    'receiver': 2,
    'reciever': 2,
    'cover': 2,
    'dust cover': 2,
    'slide': 2,
    'bolt': 2,
    'barrel': 3,
    'gas block': 4,
    'gas tube': 4,
    'handguard': 5,
    'foregrip': 6,
    'muzzle': 7,
    'stock': 8,
    'magazine': 9,
    'mag': 9,
    'scope': 10,
    'mount': 11,
    'ch. handle': 12,
    'charging handle': 12
  };

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

  const weaponHasSeparateStockSlot = weapon.properties?.slots?.some(slot => isStockSlot(slot.name, slot.nameId)) || false;

  function branchHasRequiredSight(branchEval) {
    return branchEval.items.some(part => requiredSightIds.has(part.item.id));
  }

  function branchHasOnlyOptionalSight(branchEval) {
    return requiredSightIds.size > 0 && branchEval.hasSight && !branchHasRequiredSight(branchEval);
  }

  function filterAllowedItems(allowedItems, targetCap) {
    if (!allowedItems || allowedItems.length === 0) return allowedItems;

    let filteredAllowedItemsByCapacity = calculationCache.filteredAllowedItemsBySource.get(allowedItems);
    if (!filteredAllowedItemsByCapacity) {
      filteredAllowedItemsByCapacity = new Map();
      calculationCache.filteredAllowedItemsBySource.set(allowedItems, filteredAllowedItemsByCapacity);
    }

    if (filteredAllowedItemsByCapacity.has(targetCap)) {
      return filteredAllowedItemsByCapacity.get(targetCap);
    }

    const magazines = [];
    allowedItems.forEach(child => {
      const item = modMap[child.id];
      if (item && hasCategory(item, 'Magazine')) {
        magazines.push(item);
      }
    });

    if (magazines.length === 0) {
      filteredAllowedItemsByCapacity.set(targetCap, allowedItems);
      return allowedItems;
    }

    const exactMatch = magazines.filter(m => m.properties?.capacity === targetCap);
    if (exactMatch.length > 0) {
      const exactIds = new Set(exactMatch.map(m => m.id));
      const exactAllowedItems = allowedItems.filter(child => exactIds.has(child.id));
      filteredAllowedItemsByCapacity.set(targetCap, exactAllowedItems);
      return exactAllowedItems;
    }

    let minDiff = Infinity;
    magazines.forEach(m => {
      const cap = m.properties?.capacity ?? 30;
      const diff = Math.abs(cap - targetCap);
      if (diff < minDiff) {
        minDiff = diff;
      }
    });

    const nearestMags = magazines.filter(m => {
      const cap = m.properties?.capacity ?? 30;
      return Math.abs(cap - targetCap) === minDiff;
    });

    const nearestIds = new Set(nearestMags.map(m => m.id));
    const nearestAllowedItems = allowedItems.filter(child => nearestIds.has(child.id));
    filteredAllowedItemsByCapacity.set(targetCap, nearestAllowedItems);
    return nearestAllowedItems;
  }

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

  function rebuildBuildState() {
    installedIds.clear();
    installedIds.add(weapon.id);

    installedConflicts.clear();
    if (weapon.conflictingItems) {
      weapon.conflictingItems.forEach(conflict => installedConflicts.add(conflict.id));
    }

    totalErgo = weapon.properties.ergonomics || 0;
    totalRecoilMod = 0;
    totalWeight = weapon.weight || 0;
    totalPrice = getItemPrice(weapon);
    hasSight = hasCategory(weapon, 'Sights');
    hasSuppressorGlobal = hasCategory(weapon, 'Silencer');

    build.forEach(part => {
      installedIds.add(part.item.id);
      addItemConflictsToSet(part.item, installedConflicts);
      totalErgo += part.item.ergonomicsModifier || 0;
      totalRecoilMod += part.item.recoilModifier || 0;
      totalWeight += part.item.weight || 0;
      totalPrice += getItemPrice(part.item);
      if (hasCategory(part.item, 'Sights')) hasSight = true;
      if (isSuppressor(part.item)) hasSuppressorGlobal = true;
    });
  }

  function getSlotPriority(slot) {
    const name = getSlotSearchName(slot?.name, slot?.nameId || slot?.id);
    if (calculationCache.slotPrioritiesByName.has(name)) {
      return calculationCache.slotPrioritiesByName.get(name);
    }

    let priority = slotPriority[name];
    if (priority) {
      calculationCache.slotPrioritiesByName.set(name, priority);
      return priority;
    }

    for (const [key, priority] of Object.entries(slotPriority)) {
      if (name.includes(key)) {
        calculationCache.slotPrioritiesByName.set(name, priority);
        return priority;
      }
    }

    calculationCache.slotPrioritiesByName.set(name, 99);
    return 99;
  }

  function getSortedSlots(slots) {
    const cachedSortedSlots = calculationCache.sortedSlotsBySource.get(slots);
    if (cachedSortedSlots) return cachedSortedSlots;

    const requiredProviderBySlot = new Map();
    if (hasRequiredItemRequirements) {
      slots.forEach(slot => {
        requiredProviderBySlot.set(slot, slotCanProvideRequiredItem(slot));
      });
    }

    const sortedSlots = [...slots].sort((a, b) => {
      const requiredProviderOrder = Number(requiredProviderBySlot.get(b) === true)
        - Number(requiredProviderBySlot.get(a) === true);
      if (requiredProviderOrder !== 0) return requiredProviderOrder;

      const requiredOrder = Number(b.required === true) - Number(a.required === true);
      if (requiredOrder !== 0) return requiredOrder;
      return getSlotPriority(a) - getSlotPriority(b);
    });
    calculationCache.sortedSlotsBySource.set(slots, sortedSlots);
    return sortedSlots;
  }

  function getMinimumRequiredSlotPrice(slot, pathIds = new Set()) {
    if (!slot?.required) return 0;

    const cachedPrice = calculationCache.minimumRequiredPricesBySlot.get(slot);
    if (cachedPrice !== undefined) return cachedPrice;

    let allowed = slot.filters?.allowedItems || [];
    if (isMagazineSlot(slot)) {
      allowed = filterAllowedItems(allowed, targetCapacity);
    }

    let minimumPrice = Number.POSITIVE_INFINITY;

    allowed.forEach(allowedItem => {
      const item = modMap[allowedItem.id];
      if (!item || pathIds.has(item.id)) return;

      const itemPrice = getItemPrice(item);
      if (!Number.isFinite(itemPrice)) return;

      const nestedPrice = getMinimumRequiredItemPrice(item, new Set([...pathIds, item.id]));
      if (!Number.isFinite(nestedPrice)) return;

      minimumPrice = Math.min(minimumPrice, itemPrice + nestedPrice);
    });

    calculationCache.minimumRequiredPricesBySlot.set(slot, minimumPrice);
    return minimumPrice;
  }

  function getMinimumRequiredItemPrice(item, pathIds = new Set()) {
    const cachedPrice = calculationCache.minimumRequiredPricesByItem.get(item);
    if (cachedPrice !== undefined) return cachedPrice;

    const requiredSlots = (item.properties?.slots || []).filter(slot => slot.required === true);
    let totalPrice = 0;

    for (const slot of requiredSlots) {
      const slotPrice = getMinimumRequiredSlotPrice(slot, pathIds);
      if (!Number.isFinite(slotPrice)) {
        totalPrice = Number.POSITIVE_INFINITY;
        break;
      }
      totalPrice += slotPrice;
    }

    calculationCache.minimumRequiredPricesByItem.set(item, totalPrice);
    return totalPrice;
  }

  function getRemainingRequiredSlotPrice(slots, currentIndex, pathIds = new Set()) {
    let totalPrice = 0;

    for (let index = currentIndex + 1; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot.required !== true) continue;

      const slotPrice = getMinimumRequiredSlotPrice(slot, pathIds);
      if (!Number.isFinite(slotPrice)) return Number.POSITIVE_INFINITY;
      totalPrice += slotPrice;
    }

    return totalPrice;
  }

  function getMinimumRequiredSlotWeight(slot, pathIds = new Set()) {
    if (!slot?.required) return 0;

    const cachedWeight = calculationCache.minimumRequiredWeightsBySlot.get(slot);
    if (cachedWeight !== undefined) return cachedWeight;

    let allowed = slot.filters?.allowedItems || [];
    if (isMagazineSlot(slot)) {
      allowed = filterAllowedItems(allowed, targetCapacity);
    }

    let minimumWeight = Number.POSITIVE_INFINITY;

    allowed.forEach(allowedItem => {
      const item = modMap[allowedItem.id];
      if (!item || pathIds.has(item.id)) return;

      const nestedWeight = getMinimumRequiredItemWeight(item, new Set([...pathIds, item.id]));
      if (!Number.isFinite(nestedWeight)) return;

      minimumWeight = Math.min(minimumWeight, (item.weight || 0) + nestedWeight);
    });

    calculationCache.minimumRequiredWeightsBySlot.set(slot, minimumWeight);
    return minimumWeight;
  }

  function getMinimumRequiredItemWeight(item, pathIds = new Set()) {
    const cachedWeight = calculationCache.minimumRequiredWeightsByItem.get(item);
    if (cachedWeight !== undefined) return cachedWeight;

    const requiredSlots = (item.properties?.slots || []).filter(slot => slot.required === true);
    let totalRequiredWeight = 0;

    for (const slot of requiredSlots) {
      const slotWeight = getMinimumRequiredSlotWeight(slot, pathIds);
      if (!Number.isFinite(slotWeight)) {
        totalRequiredWeight = Number.POSITIVE_INFINITY;
        break;
      }
      totalRequiredWeight += slotWeight;
    }

    calculationCache.minimumRequiredWeightsByItem.set(item, totalRequiredWeight);
    return totalRequiredWeight;
  }

  function getRemainingRequiredSlotWeight(slots, currentIndex, pathIds = new Set()) {
    let totalRequiredWeight = 0;

    for (let index = currentIndex + 1; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot.required !== true) continue;

      const slotWeight = getMinimumRequiredSlotWeight(slot, pathIds);
      if (!Number.isFinite(slotWeight)) return Number.POSITIVE_INFINITY;
      totalRequiredWeight += slotWeight;
    }

    return totalRequiredWeight;
  }

  function isMagazineSlot(slot) {
    const displayName = String(slot?.name || '').trim().toLowerCase();
    const stableName = String(slot?.nameId || slot?.id || '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ');
    return displayName === 'mag'
      || displayName === 'magazine'
      || stableName === 'mag'
      || stableName === 'magazine'
      || stableName.includes('mod magazine');
  }

  function isTacticalSlot(slotName, slotNameId = '') {
    const name = getSlotSearchName(slotName, slotNameId);
    return name.includes('tactical') || name.includes('flashlight');
  }

  function isValidTacticalDevice(item) {
    const isLaser = hasCategory(item, 'Comb. tact. device');
    const isFlashlight = hasCategory(item, 'Flashlight');

    if (isLaser && options.includeLaser) return true;
    if (isFlashlight && options.includeFlashlight) return true;
    return false;
  }

  function isValidSightForMode(item) {
    if (hasCategory(item, 'Ironsight')) {
      return false;
    }
    if (hasCategory(item, 'Thermal Vision') || hasCategory(item, 'Night Vision') || hasCategory(item, 'Special scope')) {
      return false;
    }

    const mode = options.sightMode || 'any';
    if (mode === 'none') return false;
    if (mode === 'any') return true;

    const isReflex = hasCategory(item, 'Reflex sight') || hasCategory(item, 'Compact reflex sight');
    const isMagnified = hasCategory(item, 'Scope') || hasCategory(item, 'Assault scope');

    if (mode === 'reflex') return isReflex;
    if (mode === 'scope') return isMagnified;

    const parsedMode = Number(mode);
    if (!isNaN(parsedMode)) {
      const zoomLevels = item.properties?.zoomLevels;
      if (zoomLevels) {
        const flatZooms = zoomLevels.flat();
        return flatZooms.includes(parsedMode);
      }
      if (parsedMode === 1) {
        return isReflex;
      }
      return false;
    }

    return true;
  }

  function hasLaserDevice(installedSet) {
    for (const id of installedSet) {
      const item = modMap[id];
      if (item && hasCategory(item, 'Comb. tact. device')) {
        return true;
      }
    }
    return false;
  }

  function hasFlashlightDevice(installedSet) {
    for (const id of installedSet) {
      const item = modMap[id];
      if (item && hasCategory(item, 'Flashlight')) {
        return true;
      }
    }
    return false;
  }

  function isReservedForRequiredTacticalDevice(item) {
    if (requiredItemIds.has(item.id)) return false;

    const isLaser = hasCategory(item, 'Comb. tact. device');
    const isFlashlight = hasCategory(item, 'Flashlight');

    return (isLaser && requiredLaserIds.size > 0)
      || (isFlashlight && requiredFlashlightIds.size > 0);
  }

  function itemTreeCanProvideRequiredItem(item, visitedIds, unavailableIds) {
    if (!hasRequiredItemRequirements) return false;

    const activeVisitedIds = visitedIds || new Set();
    const activeUnavailableIds = unavailableIds || new Set();

    if (!item || activeVisitedIds.has(item.id)) return false;
    if (activeUnavailableIds.has(item.id)) return false;
    if (requiredItemIds.has(item.id)) return true;

    activeVisitedIds.add(item.id);

    return (item.properties?.slots || []).some(slot => slotCanProvideRequiredItem(slot, activeVisitedIds, activeUnavailableIds));
  }

  function slotCanProvideRequiredItem(slot, visitedIds, unavailableIds) {
    if (!hasRequiredItemRequirements) return false;

    const activeVisitedIds = visitedIds || new Set();
    const activeUnavailableIds = unavailableIds || new Set();

    return (slot.filters?.allowedItems || []).some(allowedItem => {
      if (activeUnavailableIds.has(allowedItem.id)) return false;
      if (requiredItemIds.has(allowedItem.id)) return true;
      return itemTreeCanProvideRequiredItem(modMap[allowedItem.id], new Set(activeVisitedIds), activeUnavailableIds);
    });
  }

  function isSkippedSlot(slot) {
    const slotNameId = (slot.nameId || '').toLowerCase();
    if (slot.required === true) return false;
    if (hasRequiredItemRequirements && slotCanProvideRequiredItem(slot)) return false;

    const hasAnyTactical = options.includeLaser || options.includeFlashlight;
    if (hasAnyTactical) {
      return slotNameId.includes('bipod')
        || slotNameId.includes('launcher')
        || slotNameId.includes('equipment');
    }
    return slotNameId.includes('tactical')
      || slotNameId.includes('flashlight')
      || slotNameId.includes('bipod')
      || slotNameId.includes('launcher')
      || slotNameId.includes('equipment');
  }

  function invalidBranchEvaluation() {
    return {
      score: -Infinity,
      items: [],
      statsDelta: {
        ergonomics: 0,
        recoil: 0,
        weight: 0,
        price: 0,
      },
      hasSuppressor: false,
      hasSight: false,
      requiredMatches: new Set(),
      conflicts: new Set(),
      isValid: false,
      warnings: [],
    };
  }

  function createBranchEvaluation(slotName, item, score) {
    return {
      score,
      items: [{ slotName, item }],
      statsDelta: {
        ergonomics: item.ergonomicsModifier || 0,
        recoil: item.recoilModifier || 0,
        weight: item.weight || 0,
        price: getItemPrice(item),
      },
      hasSuppressor: isSuppressor(item),
      hasSight: hasCategory(item, 'Sights'),
      requiredMatches: requiredItemIds.has(item.id) ? new Set([item.id]) : new Set(),
      conflicts: new Set(getItemConflictIds(item)),
      isValid: true,
      warnings: [],
    };
  }

  function mergeBranchEvaluation(target, source) {
    target.score += source.score;
    target.items.push(...source.items);

    target.statsDelta.ergonomics += source.statsDelta.ergonomics;
    target.statsDelta.recoil += source.statsDelta.recoil;
    target.statsDelta.weight += source.statsDelta.weight;
    target.statsDelta.price += source.statsDelta.price;

    target.hasSuppressor = target.hasSuppressor || source.hasSuppressor;
    target.hasSight = target.hasSight || source.hasSight;
    source.requiredMatches.forEach(itemId => target.requiredMatches.add(itemId));

    source.conflicts.forEach(conflictId => target.conflicts.add(conflictId));
    target.warnings.push(...source.warnings);
  }

  function canInstallItem(itemId, item, pathIds, branchInstalledIds, branchConflicts) {
    if (installedIds.has(itemId)) return false;
    if (installedConflicts.has(itemId)) return false;
    if (pathIds.has(itemId)) return false;
    if (branchInstalledIds.has(itemId)) return false;
    if (branchConflicts.has(itemId)) return false;

    for (const conflict of item.conflictingItems || []) {
      if (installedIds.has(conflict.id)) return false;
      if (pathIds.has(conflict.id)) return false;
      if (branchInstalledIds.has(conflict.id)) return false;
    }

    return true;
  }

  function isBetterBranch(candidate, bestCandidate, mustFindSuppressor, mustFindSight, mustFindRequired = false) {
    if (!candidate || !candidate.isValid || candidate.score === -Infinity) return false;
    if (!bestCandidate) return true;

    if (mustFindRequired && candidate.requiredMatches.size !== bestCandidate.requiredMatches.size) {
      return candidate.requiredMatches.size > bestCandidate.requiredMatches.size;
    }

    if (mustFindSuppressor && candidate.hasSuppressor !== bestCandidate.hasSuppressor) {
      return candidate.hasSuppressor;
    }

    if (mustFindSight && candidate.hasSight !== bestCandidate.hasSight) {
      return candidate.hasSight;
    }

    return candidate.score > bestCandidate.score;
  }

  function shouldApplyChildBranch(
    childEval,
    activeMustFindSuppressor,
    activeMustFindSight,
    activeMustFindRequired = false,
    mustFillSlot = false,
  ) {
    if (!childEval || !childEval.isValid || childEval.score === -Infinity) return false;

    if (mustFillSlot) return true;

    if (activeMustFindRequired) {
      return childEval.requiredMatches.size > 0;
    }

    if (activeMustFindSuppressor) {
      return childEval.hasSuppressor;
    }

    if (activeMustFindSight) {
      return childEval.hasSight;
    }

    return childEval.score > 0;
  }

  function evaluateBranch(
    slotName,
    itemId,
    currentErgo,
    pathIds = new Set(),
    currentWeight = totalWeight,
    parentBranchInstalledIds = new Set(),
    parentBranchConflicts = new Set(),
    currentPrice = totalPrice,
    reservedPrice = 0,
    reservedWeight = 0,
    slotNameId = '',
  ) {
    const item = modMap[itemId];
    if (!item) return invalidBranchEvaluation();

    if (!canInstallItem(itemId, item, pathIds, parentBranchInstalledIds, parentBranchConflicts)) {
      return invalidBranchEvaluation();
    }

    const isRequiredItem = requiredItemIds.has(item.id);
    const providesRequiredItem = hasRequiredItemRequirements && itemTreeCanProvideRequiredItem(
      item,
      new Set(),
      new Set([
        ...installedIds,
        ...parentBranchInstalledIds,
        ...pathIds,
      ]),
    );

    if (!isRequiredItem && weaponHasSeparateStockSlot && isPistolGripSlot(slotName, slotNameId) && isCombinedPistolGripStock(item)) {
      return invalidBranchEvaluation();
    }

    if (!isRequiredItem && hasCategory(item, 'Sights') && !isValidSightForMode(item)) {
      return invalidBranchEvaluation();
    }

    const isTacSlot = isTacticalSlot(slotName, slotNameId);
    const hasAnyTactical = options.includeLaser || options.includeFlashlight;
    if (isTacSlot && hasAnyTactical) {
      if (isReservedForRequiredTacticalDevice(item)) {
        return invalidBranchEvaluation();
      }

      if (!isRequiredItem && !providesRequiredItem && !isValidTacticalDevice(item)) {
        return invalidBranchEvaluation();
      }
      
      const isLaser = hasCategory(item, 'Comb. tact. device');
      const isFlashlight = hasCategory(item, 'Flashlight');
      
      if (isLaser && !isRequiredItem) {
        const alreadyHasLaser = hasLaserDevice(installedIds) || hasLaserDevice(parentBranchInstalledIds);
        if (alreadyHasLaser) {
          return invalidBranchEvaluation();
        }
      }
      
      if (isFlashlight && !isRequiredItem) {
        const alreadyHasFlashlight = hasFlashlightDevice(installedIds) || hasFlashlightDevice(parentBranchInstalledIds);
        if (alreadyHasFlashlight) {
          return invalidBranchEvaluation();
        }
      }
    }

    const itemWeight = item.weight || 0;
    if (
      maxWeight > 0
      && currentWeight + itemWeight + reservedWeight > maxWeight + weightEpsilon
    ) {
      return invalidBranchEvaluation();
    }

    const price = getItemPrice(item);
    if (maxPrice > 0 && currentPrice + price + reservedPrice > maxPrice) {
      return invalidBranchEvaluation();
    }

    if (options.forbidSuppressor && isSuppressor(item)) {
      return invalidBranchEvaluation();
    }

    const ergoMod = item.ergonomicsModifier || 0;
    const recoilMod = item.recoilModifier || 0;

    const currentUsableErgo = Math.min(ergoCap, currentErgo);
    const newUsableErgo = Math.min(ergoCap, currentErgo + ergoMod);
    const cappedErgoMod = newUsableErgo - currentUsableErgo;
    const currentOverflowErgo = Math.max(0, Math.min(ergoSoftCap, currentErgo) - ergoCap);
    const newOverflowErgo = Math.max(0, Math.min(ergoSoftCap, currentErgo + ergoMod) - ergoCap);
    const overflowErgoMod = newOverflowErgo - currentOverflowErgo;
    const itemOverflowErgoWeight = targetType === 'meta' && hasCategory(item, 'Stock')
      ? Math.max(overflowErgoWeight, 0.45)
      : overflowErgoWeight;
    const effectiveErgoMod = cappedErgoMod + (overflowErgoMod * itemOverflowErgoWeight);

    const scoringPrice = Number.isFinite(price) ? price : Number.MAX_SAFE_INTEGER;
    let branchScore = (effectiveErgoMod * ergoWeight)
      - (recoilMod * recoilWeight)
      - (scoringPrice * priceWeight)
      - (itemWeight * weightWeight);

    if (isTacSlot && hasAnyTactical) {
      branchScore += 10000; // Крупный бонус для гарантии установки
    }

    if (hasCategory(item, 'Magazine')) {
      const recoil = item.recoilModifier || 0;
      const loadMod = item.properties?.loadModifier || 0;
      const ammoCheckMod = item.properties?.ammoCheckModifier || 0;
      const ergoM = item.ergonomicsModifier || 0;
      const lowPrice = Number.isFinite(price) ? price : Number.MAX_SAFE_INTEGER;

      if (targetType === 'meta') {
        branchScore = (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10) + (ergoM * 0.2);
      } else if (targetType === PRICE_AWARE_TARGET) {
        const baseScoring = (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10) + (ergoM * 0.2) + 200;
        branchScore = baseScoring / lowPrice;
      } else {
        branchScore = (ergoM * 1.0) - (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10);
      }
    }

    const branchEval = createBranchEvaluation(slotName, item, branchScore);

    let branchErgo = Math.max(0, currentErgo + ergoMod);
    let branchTotalWeight = currentWeight + itemWeight;
    let branchTotalPrice = currentPrice + price;

    const branchInstalledIds = new Set(parentBranchInstalledIds);
    branchInstalledIds.add(itemId);

    const branchConflicts = new Set(parentBranchConflicts);
    addItemConflictsToSet(item, branchConflicts);

    const nextPathIds = new Set(pathIds);
    nextPathIds.add(itemId);

    if (item.properties?.slots) {
      const sortedSlots = getSortedSlots(item.properties.slots);

      for (let slotIndex = 0; slotIndex < sortedSlots.length; slotIndex += 1) {
        const slot = sortedSlots[slotIndex];
        if (isSkippedSlot(slot)) continue;

        let allowed = slot.filters?.allowedItems;
        if (!allowed || allowed.length === 0) {
          if (slot.required === true) return invalidBranchEvaluation();
          continue;
        }

        if (isMagazineSlot(slot)) {
          allowed = filterAllowedItems(allowed, targetCapacity);
        }

        if (allowed.length === 0) {
          if (slot.required === true) return invalidBranchEvaluation();
          continue;
        }

        const remainingRequiredPrice = getRemainingRequiredSlotPrice(
          sortedSlots,
          slotIndex,
          nextPathIds,
        );
        if (!Number.isFinite(remainingRequiredPrice)) return invalidBranchEvaluation();
        const childReservedPrice = reservedPrice + remainingRequiredPrice;
        const remainingRequiredWeight = getRemainingRequiredSlotWeight(
          sortedSlots,
          slotIndex,
          nextPathIds,
        );
        if (!Number.isFinite(remainingRequiredWeight)) return invalidBranchEvaluation();
        const childReservedWeight = reservedWeight + remainingRequiredWeight;

        const mustFindSuppressor = options.requireSuppressor && !branchEval.hasSuppressor;
        const mustFindSight = requireSight && !(hasSight || branchEval.hasSight);

        let slotCanProvideSuppressor = false;
        let slotCanProvideSight = false;
        let slotCanProvideRequired = false;

        const childEvals = [];

        allowed.forEach(child => {
          const childItem = modMap[child.id];
          if (!childItem) return;

          if ((hasSight || branchEval.hasSight) && hasCategory(childItem, 'Sights') && !requiredItemIds.has(childItem.id)) return;

          const childEval = evaluateBranch(
            slot.name,
            child.id,
            branchErgo,
            nextPathIds,
            branchTotalWeight,
            branchInstalledIds,
            branchConflicts,
            branchTotalPrice,
            childReservedPrice,
            childReservedWeight,
            slot.nameId || slot.id,
          );

          if (childEval.isValid && childEval.score !== -Infinity) {
            if (
              (hasSight || branchEval.hasSight)
              && childEval.hasSight
              && !branchHasRequiredSight(childEval)
            ) return;
            if (branchHasOnlyOptionalSight(childEval)) return;
            if (childEval.hasSuppressor) slotCanProvideSuppressor = true;
            if (childEval.hasSight) slotCanProvideSight = true;
            if (childEval.requiredMatches.size > 0) slotCanProvideRequired = true;
            childEvals.push(childEval);
          }
        });

        let bestChildEval = null;
        const activeMustFindSuppressor = mustFindSuppressor && slotCanProvideSuppressor;
        const activeMustFindSight = mustFindSight && slotCanProvideSight;
        const activeMustFindRequired = slotCanProvideRequired;

        childEvals.forEach(childEval => {
          if (isBetterBranch(childEval, bestChildEval, activeMustFindSuppressor, activeMustFindSight, activeMustFindRequired)) {
            bestChildEval = childEval;
          }
        });

        const shouldApply = shouldApplyChildBranch(
          bestChildEval,
          activeMustFindSuppressor,
          activeMustFindSight,
          activeMustFindRequired,
          slot.required === true,
        );

        if (slot.required === true && !shouldApply) {
          return invalidBranchEvaluation();
        }

        if (shouldApply) {
          mergeBranchEvaluation(branchEval, bestChildEval);

          branchErgo = Math.max(0, branchErgo + bestChildEval.statsDelta.ergonomics);
          branchTotalWeight += bestChildEval.statsDelta.weight;
          branchTotalPrice += bestChildEval.statsDelta.price;

          bestChildEval.items.forEach(part => branchInstalledIds.add(part.item.id));
          bestChildEval.conflicts.forEach(conflictId => branchConflicts.add(conflictId));
        }
      }
    }

    return branchEval;
  }

  function applyBranchPlan(branchEval, insertIndex = build.length) {
    build.splice(insertIndex, 0, ...branchEval.items);

    branchEval.items.forEach(part => {
      installedIds.add(part.item.id);
      addItemConflictsToSet(part.item, installedConflicts);

      totalErgo += part.item.ergonomicsModifier || 0;
      totalRecoilMod += part.item.recoilModifier || 0;
      totalWeight += part.item.weight || 0;
      totalPrice += getItemPrice(part.item);

      if (hasCategory(part.item, 'Sights')) hasSight = true;
      if (isSuppressor(part.item)) hasSuppressorGlobal = true;
    });
  }

  function processSlots(slots) {
    const sortedSlots = getSortedSlots(slots);

    for (let slotIndex = 0; slotIndex < sortedSlots.length; slotIndex += 1) {
      const slot = sortedSlots[slotIndex];
      if (isSkippedSlot(slot)) continue;

      let allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) {
        if (slot.required === true) missingRequiredSlotNames.add(slot.name || slot.nameId || 'Unknown slot');
        continue;
      }

      if (isMagazineSlot(slot)) {
        allowed = filterAllowedItems(allowed, targetCapacity);
      }

      if (allowed.length === 0) {
        if (slot.required === true) missingRequiredSlotNames.add(slot.name || slot.nameId || 'Unknown slot');
        continue;
      }

      const remainingRequiredPrice = getRemainingRequiredSlotPrice(
        sortedSlots,
        slotIndex,
        new Set([weapon.id]),
      );
      const reservedPrice = Number.isFinite(remainingRequiredPrice) ? remainingRequiredPrice : 0;
      const remainingRequiredWeight = getRemainingRequiredSlotWeight(
        sortedSlots,
        slotIndex,
        new Set([weapon.id]),
      );
      const reservedWeight = Number.isFinite(remainingRequiredWeight) ? remainingRequiredWeight : 0;

      let slotCanProvideSuppressor = false;
      let slotCanProvideSight = false;
      let slotCanProvideRequired = false;

      const candidates = [];

      allowed.forEach(shallowItem => {
        const item = modMap[shallowItem.id];
        if (!item) return;

        if (hasSight && hasCategory(item, 'Sights') && !requiredItemIds.has(item.id)) return;

        const branchEval = evaluateBranch(
          slot.name,
          item.id,
          totalErgo,
          new Set(),
          totalWeight,
          new Set(),
          new Set(),
          totalPrice,
          reservedPrice,
          reservedWeight,
          slot.nameId || slot.id,
        );
        if (!branchEval.isValid) return;
        if (hasSight && branchEval.hasSight && !branchHasRequiredSight(branchEval)) return;
        if (branchHasOnlyOptionalSight(branchEval)) return;

        if (maxWeight > 0) {
          const hypotheticalWeight = totalWeight + branchEval.statsDelta.weight + reservedWeight;
          if (hypotheticalWeight > maxWeight + weightEpsilon) return;
        }

        if (maxPrice > 0) {
          const hypotheticalPrice = totalPrice + branchEval.statsDelta.price + reservedPrice;
          if (hypotheticalPrice > maxPrice) return;
        }

        if (branchEval.hasSuppressor) slotCanProvideSuppressor = true;
        if (branchEval.hasSight) slotCanProvideSight = true;
        if (branchEval.requiredMatches.size > 0) slotCanProvideRequired = true;

        candidates.push({
          branchEval,
          score: branchEval.score,
          hasSuppressor: branchEval.hasSuppressor,
          hasSight: branchEval.hasSight,
          requiredMatches: branchEval.requiredMatches,
          isValid: branchEval.isValid,
        });
      });

      let bestCandidate = null;
      const mustFindSuppressor = options.requireSuppressor && !hasSuppressorGlobal;
      const mustFindSight = requireSight && !hasSight;

      const activeMustFindSuppressor = mustFindSuppressor && slotCanProvideSuppressor;
      const activeMustFindSight = mustFindSight && slotCanProvideSight;
      const activeMustFindRequired = slotCanProvideRequired;

      candidates.forEach(candidate => {
        if (isBetterBranch(candidate, bestCandidate, activeMustFindSuppressor, activeMustFindSight, activeMustFindRequired)) {
          bestCandidate = candidate;
        }
      });

      if (!bestCandidate) {
        if (slot.required === true) missingRequiredSlotNames.add(slot.name || slot.nameId || 'Unknown slot');
        continue;
      }
      if (activeMustFindSuppressor && !bestCandidate.hasSuppressor) continue;
      if (activeMustFindSight && !bestCandidate.hasSight) continue;
      if (activeMustFindRequired && bestCandidate.requiredMatches.size === 0) continue;

      const rootItem = bestCandidate.branchEval.items[0]?.item;
      if (!rootItem) {
        if (slot.required === true) missingRequiredSlotNames.add(slot.name || slot.nameId || 'Unknown slot');
        continue;
      }

      const isMount = hasCategory(rootItem, 'Mount');
      const isOptionalErgoOnlyPriceAwarePart = targetType === PRICE_AWARE_TARGET
        && (rootItem.ergonomicsModifier || 0) > 0
        && (rootItem.recoilModifier || 0) >= 0
        && !hasCategory(rootItem, 'Magazine');
      if (
        (isMount || isOptionalErgoOnlyPriceAwarePart)
        && slot.required !== true
        && bestCandidate.score <= 0
        && !(options.requireSuppressor && !hasSuppressorGlobal && bestCandidate.hasSuppressor)
        && !(requireSight && !hasSight && bestCandidate.hasSight)
        && bestCandidate.requiredMatches.size === 0
      ) {
        continue;
      }

      applyBranchPlan(bestCandidate.branchEval);
    }
  }

  function findInstalledSlotContextForItem(itemId) {
    const installedParts = [weapon, ...build.map(part => part.item)];

    for (const parentItem of installedParts) {
      for (const slot of parentItem.properties?.slots || []) {
        const allowed = slot.filters?.allowedItems || [];
        if (allowed.some(allowedItem => allowedItem.id === itemId)) {
          return { parentItem, slot };
        }
      }
    }

    return null;
  }

  function collectInstalledBranchIds(rootItem) {
    const installedBuildIds = new Set(build.map(part => part.item.id));
    const branchIds = new Set([rootItem.id]);

    function walk(item) {
      for (const slot of item.properties?.slots || []) {
        for (const allowedItem of slot.filters?.allowedItems || []) {
          if (!installedBuildIds.has(allowedItem.id) || branchIds.has(allowedItem.id)) continue;

          const childItem = modMap[allowedItem.id];
          if (!childItem) continue;

          branchIds.add(childItem.id);
          walk(childItem);
        }
      }
    }

    walk(rootItem);
    return branchIds;
  }

  function createExistingBranchEvaluation(parts) {
    const branchEval = {
      score: 0,
      items: parts,
      statsDelta: {
        ergonomics: 0,
        recoil: 0,
        weight: 0,
        price: 0,
      },
      hasSuppressor: false,
      hasSight: false,
      requiredMatches: new Set(),
      conflicts: new Set(),
      isValid: true,
      warnings: [],
    };

    parts.forEach(part => {
      branchEval.statsDelta.ergonomics += part.item.ergonomicsModifier || 0;
      branchEval.statsDelta.recoil += part.item.recoilModifier || 0;
      branchEval.statsDelta.weight += part.item.weight || 0;
      branchEval.statsDelta.price += getItemPrice(part.item);
      if (isSuppressor(part.item)) branchEval.hasSuppressor = true;
      if (hasCategory(part.item, 'Sights')) branchEval.hasSight = true;
      if (requiredItemIds.has(part.item.id)) branchEval.requiredMatches.add(part.item.id);
      addItemConflictsToSet(part.item, branchEval.conflicts);
    });

    return branchEval;
  }

  function getProjectedStats(branchEval) {
    const recoilMod = totalRecoilMod + branchEval.statsDelta.recoil;

    return {
      ergonomics: totalErgo + branchEval.statsDelta.ergonomics,
      recoilVertical: baseRecoilV * (1 + (recoilMod / 100)),
      recoilHorizontal: baseRecoilH * (1 + (recoilMod / 100)),
      weight: totalWeight + branchEval.statsDelta.weight,
      price: totalPrice + branchEval.statsDelta.price,
    };
  }

  function getBranchBarrelRecoil(branchEval) {
    const barrelPart = branchEval.items.find(part => hasCategory(part.item, 'Barrel'));
    return barrelPart?.item.recoilModifier || 0;
  }

  function withForcedSlotAllowedItem(slot, allowedItem, callback) {
    const originalAllowedItems = slot.filters.allowedItems;
    slot.filters.allowedItems = [allowedItem];

    try {
      return callback();
    } finally {
      slot.filters.allowedItems = originalAllowedItems;
    }
  }

  function isBetterFinalBarrel(candidate, bestCandidate) {
    if (!candidate) return false;
    if (!bestCandidate) return true;

    if (candidate.branchEval.requiredMatches.size !== bestCandidate.branchEval.requiredMatches.size) {
      return candidate.branchEval.requiredMatches.size > bestCandidate.branchEval.requiredMatches.size;
    }

    const recoilDelta = bestCandidate.projected.recoilVertical - candidate.projected.recoilVertical;
    if (recoilDelta > 0.25) return true;
    if (recoilDelta < -0.25) return false;

    if (candidate.barrelRecoil < bestCandidate.barrelRecoil - 0.1) return true;
    if (candidate.barrelRecoil > bestCandidate.barrelRecoil + 0.1) return false;

    if (candidate.projected.ergonomics > bestCandidate.projected.ergonomics + 0.25) return true;
    if (candidate.projected.ergonomics < bestCandidate.projected.ergonomics - 0.25) return false;

    return candidate.projected.weight < bestCandidate.projected.weight;
  }

  function optimizeFinalBarrelBlock() {
    if (targetType !== 'meta') return;

    const barrelIndex = build.findIndex(part => hasCategory(part.item, 'Barrel'));
    if (barrelIndex === -1) return;

    const currentBarrel = build[barrelIndex];
    const barrelSlotContext = findInstalledSlotContextForItem(currentBarrel.item.id);
    if (!barrelSlotContext || !isBarrelSlot(barrelSlotContext.slot.name, barrelSlotContext.slot.nameId)) return;

    const parentHasBarrelSlot = barrelSlotContext.parentItem.properties?.slots?.some(slot => isBarrelSlot(slot.name, slot.nameId)) || false;
    const rootItem = barrelSlotContext.parentItem !== weapon && parentHasBarrelSlot
      ? barrelSlotContext.parentItem
      : currentBarrel.item;
    const rootSlotContext = rootItem === currentBarrel.item
      ? barrelSlotContext
      : findInstalledSlotContextForItem(rootItem.id);

    if (!rootSlotContext) return;

    const rootIndex = build.findIndex(part => part.item.id === rootItem.id);
    if (rootIndex === -1) return;

    const removedIds = collectInstalledBranchIds(rootItem);
    const removedParts = build.filter(part => removedIds.has(part.item.id));
    const restoreBranchEval = createExistingBranchEvaluation(removedParts);

    for (let i = build.length - 1; i >= 0; i -= 1) {
      if (removedIds.has(build[i].item.id)) {
        build.splice(i, 1);
      }
    }
    rebuildBuildState();

    let bestCandidate = null;
    const allowed = rootSlotContext.slot.filters?.allowedItems || [];

    allowed.forEach(shallowItem => {
      const item = modMap[shallowItem.id];
      if (!item) return;

      const barrelSlot = item.properties?.slots?.find(slot => isBarrelSlot(slot.name, slot.nameId));
      const forcedBarrelItems = barrelSlot
        ? barrelSlot.filters?.allowedItems?.filter(allowedItem => {
          const allowedMod = modMap[allowedItem.id];
          return allowedMod && hasCategory(allowedMod, 'Barrel');
        }) || []
        : [null];

      if (!barrelSlot && !hasCategory(item, 'Barrel')) return;

      forcedBarrelItems.forEach(forcedBarrelItem => {
        const evaluateCandidate = () => evaluateBranch(rootSlotContext.slot.name, item.id, totalErgo, new Set(), totalWeight, new Set(), new Set(), totalPrice, 0, 0, rootSlotContext.slot.nameId || rootSlotContext.slot.id);
        const branchEval = forcedBarrelItem && barrelSlot
          ? withForcedSlotAllowedItem(barrelSlot, forcedBarrelItem, evaluateCandidate)
          : evaluateCandidate();

        if (!branchEval.isValid) return;
        if (!branchEval.items.some(part => hasCategory(part.item, 'Barrel'))) return;

        const projected = getProjectedStats(branchEval);
        if (projected.ergonomics < ergoCap) return;
        if (maxWeight > 0 && projected.weight > maxWeight + weightEpsilon) return;
        if (maxPrice > 0 && projected.price > maxPrice) return;

        const candidate = { branchEval, projected, barrelRecoil: getBranchBarrelRecoil(branchEval) };
        if (isBetterFinalBarrel(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      });
    });

    applyBranchPlan(bestCandidate?.branchEval || restoreBranchEval, rootIndex);
  }

  function optimizePriceAwareLeafRecoilUpgrades() {
    if (targetType !== PRICE_AWARE_TARGET || maxPrice <= 0) return;

    const maxIterations = Math.max(1, build.length * 2);

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let bestUpgrade = null;
      const installedParts = [...build];

      installedParts.forEach(currentPart => {
        const currentItem = currentPart.item;
        if (requiredItemIds.has(currentItem.id)) return;
        if (options.requireSuppressor && isSuppressor(currentItem)) return;
        if (requireSight && hasCategory(currentItem, 'Sights')) return;

        const branchIds = collectInstalledBranchIds(currentItem);
        if (branchIds.size !== 1) return;

        const slotContext = findInstalledSlotContextForItem(currentItem.id);
        if (!slotContext) return;

        const currentIndex = build.findIndex(part => part.item.id === currentItem.id);
        if (currentIndex === -1) return;

        const [removedPart] = build.splice(currentIndex, 1);
        rebuildBuildState();

        const restoreEval = createExistingBranchEvaluation([removedPart]);
        const currentRecoil = currentItem.recoilModifier || 0;

        for (const allowedItem of slotContext.slot.filters?.allowedItems || []) {
          if (allowedItem.id === currentItem.id) continue;

          const candidateEval = evaluateBranch(
            slotContext.slot.name,
            allowedItem.id,
            totalErgo,
            new Set(),
            totalWeight,
            new Set(),
            new Set(),
            totalPrice,
            0,
            0,
            slotContext.slot.nameId || slotContext.slot.id,
          );
          if (!candidateEval.isValid) continue;

          const recoilImprovement = currentRecoil - candidateEval.statsDelta.recoil;
          if (recoilImprovement <= 0.001) continue;

          const candidate = {
            currentItemId: currentItem.id,
            candidateItemId: allowedItem.id,
            recoilImprovement,
            ergonomicsDelta: candidateEval.statsDelta.ergonomics
              - restoreEval.statsDelta.ergonomics,
            priceDelta: candidateEval.statsDelta.price - restoreEval.statsDelta.price,
          };

          if (
            !bestUpgrade
            || candidate.recoilImprovement > bestUpgrade.recoilImprovement + 0.001
            || (
              Math.abs(candidate.recoilImprovement - bestUpgrade.recoilImprovement) <= 0.001
              && candidate.ergonomicsDelta > bestUpgrade.ergonomicsDelta
            )
            || (
              Math.abs(candidate.recoilImprovement - bestUpgrade.recoilImprovement) <= 0.001
              && candidate.ergonomicsDelta === bestUpgrade.ergonomicsDelta
              && candidate.priceDelta < bestUpgrade.priceDelta
            )
          ) {
            bestUpgrade = candidate;
          }
        }

        applyBranchPlan(restoreEval, currentIndex);
      });

      if (!bestUpgrade) return;

      const currentIndex = build.findIndex(part => part.item.id === bestUpgrade.currentItemId);
      if (currentIndex === -1) return;

      const currentPart = build[currentIndex];
      const slotContext = findInstalledSlotContextForItem(currentPart.item.id);
      if (!slotContext) return;

      build.splice(currentIndex, 1);
      rebuildBuildState();

      const replacementEval = evaluateBranch(
        slotContext.slot.name,
        bestUpgrade.candidateItemId,
        totalErgo,
        new Set(),
        totalWeight,
        new Set(),
        new Set(),
        totalPrice,
        0,
        0,
        slotContext.slot.nameId || slotContext.slot.id,
      );

      if (!replacementEval.isValid) {
        applyBranchPlan(createExistingBranchEvaluation([currentPart]), currentIndex);
        return;
      }

      applyBranchPlan(replacementEval, currentIndex);
    }
  }

  processSlots(weapon.properties.slots);
  optimizeFinalBarrelBlock();
  optimizePriceAwareLeafRecoilUpgrades();
  rebuildBuildState();

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  const result = {
    build,
    stats: {
      ergonomics: Math.min(100, Math.round(totalErgo)),
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Number.isFinite(totalPrice) ? Math.round(totalPrice) : null,
    },
  };

  const warnings = [];
  const errors = [];
  if (options.requireSuppressor && !hasSuppressorGlobal) {
    errors.push('No compatible suppressor could be installed with the current constraints.');
  }
  const missingRequiredIds = [...requiredItemIds].filter(itemId => !installedIds.has(itemId));
  if (missingRequiredIds.length > 0) {
    const missingNames = missingRequiredIds
      .map(itemId => modMap[itemId]?.shortName || modMap[itemId]?.name || itemId)
      .join(', ');
    errors.push(`Required modules could not be installed with the current weapon and constraints: ${missingNames}.`);
  }
  if (missingRequiredSlotNames.size > 0) {
    errors.push(
      `Required weapon slots could not be completed within the current constraints: ${[...missingRequiredSlotNames].join(', ')}.`,
    );
  }
  if (maxWeight > 0 && totalWeight > maxWeight + weightEpsilon) {
    warnings.push('The base weapon already exceeds the selected max weight.');
  }
  if (maxPrice > 0 && totalPrice > maxPrice) {
    warnings.push('The build exceeds the selected max price.');
  }
  if (!Number.isFinite(totalPrice)) {
    warnings.push('One or more selected items have no available price under the active price policy.');
  }
  if (warnings.length > 0) {
    result.warning = warnings.join(' ');
  }
  if (errors.length > 0) {
    result.error = errors.join(' ');
  }

  return result;
}

export function calculateBestBuild(
  weapon,
  targetType,
  minErgo,
  maxRecoil,
  modMap = {},
  options = {},
  customProfile = null,
  customExactTargets = null,
) {
  const calculationCache = createCalculationCache();
  const effectiveTargetType = targetType === 'custom'
    ? 'custom'
    : targetType === PRICE_AWARE_TARGET
      ? PRICE_AWARE_TARGET
      : 'meta';

  if (effectiveTargetType !== 'custom') {
    const isPriceAwareCalculation = effectiveTargetType === PRICE_AWARE_TARGET;
    const ergoWeight = 1;
    const recoilWeight = 3;
    const priceWeight = isPriceAwareCalculation ? 0.0001 : 0;
    const weightWeight = isPriceAwareCalculation ? 0.001 : 15;
    const overflowErgoWeight = isPriceAwareCalculation ? 0 : 0.15;
    const ergoSoftCap = isPriceAwareCalculation ? 100 : 70;
    const ergoCap = isPriceAwareCalculation ? 100 : 50;
     
    const primaryResult = _calculateWeighted(
      weapon,
      ergoWeight,
      recoilWeight,
      priceWeight,
      modMap,
      options,
      ergoCap,
      effectiveTargetType,
      weightWeight,
      overflowErgoWeight,
      ergoSoftCap,
      calculationCache,
    );

    if (effectiveTargetType === 'meta' && options.maxPrice > 0) {
      const priceAwareResult = calculateBestBuild(
        weapon,
        PRICE_AWARE_TARGET,
        minErgo,
        maxRecoil,
        modMap,
        options,
      );

      function getMetaResultScore(result) {
        if (result.error || result.stats.price == null) return -Infinity;

        const baseErgo = weapon.properties.ergonomics || 0;
        const itemErgo = result.build.reduce(
          (sum, part) => sum + (part.item.ergonomicsModifier || 0),
          0,
        );
        const itemRecoil = result.build.reduce(
          (sum, part) => sum + (part.item.recoilModifier || 0),
          0,
        );
        const itemWeight = result.build.reduce(
          (sum, part) => sum + (part.item.weight || 0),
          0,
        );
        const getEffectiveErgo = value => Math.min(ergoCap, value)
          + (Math.max(0, Math.min(ergoSoftCap, value) - ergoCap) * overflowErgoWeight);
        const effectiveErgoDelta = getEffectiveErgo(baseErgo + itemErgo)
          - getEffectiveErgo(baseErgo);

        return (effectiveErgoDelta * ergoWeight)
          - (itemRecoil * recoilWeight)
          - (itemWeight * weightWeight);
      }

      const priceAwareScore = getMetaResultScore(priceAwareResult);
      const primaryScore = getMetaResultScore(primaryResult);
      const priceAwareWinsTie = priceAwareScore === primaryScore
        && priceAwareResult.stats.price != null
        && (
          primaryResult.stats.price == null
          || priceAwareResult.stats.price < primaryResult.stats.price
        );

      return priceAwareScore > primaryScore || priceAwareWinsTie
        ? priceAwareResult
        : primaryResult;
    }

    if (!isPriceAwareCalculation) return primaryResult;

    // The builder is greedy within each slot tree. Explore a price-sensitive route as well,
    // then compare complete builds with the price-aware objective. This prevents an early
    // optional muzzle purchase from starving a much stronger required stock upgrade.
    const priceSensitiveResult = _calculateWeighted(
      weapon,
      ergoWeight,
      recoilWeight,
      priceWeight * 20,
      modMap,
      options,
      ergoCap,
      effectiveTargetType,
      weightWeight,
      overflowErgoWeight,
      ergoSoftCap,
      calculationCache,
    );

    function getPriceAwareResultScore(result) {
      if (result.error || result.stats.price == null) return -Infinity;

      const itemErgo = result.build.reduce(
        (sum, part) => sum + (part.item.ergonomicsModifier || 0),
        0,
      );
      const itemRecoil = result.build.reduce(
        (sum, part) => sum + (part.item.recoilModifier || 0),
        0,
      );
      const itemWeight = result.build.reduce(
        (sum, part) => sum + (part.item.weight || 0),
        0,
      );

      return (itemErgo * ergoWeight)
        - (itemRecoil * recoilWeight)
        - (result.stats.price * priceWeight)
        - (itemWeight * weightWeight);
    }

    return getPriceAwareResultScore(priceSensitiveResult) > getPriceAwareResultScore(primaryResult)
      ? priceSensitiveResult
      : primaryResult;
  }

  let bestBuild = null;
  let bestBuildScore = -Infinity;
  let bestExactError = Number.POSITIVE_INFINITY;
  let bestBuildTieKey = '';
  let closestExactBuild = null;
  let closestExactEvaluation = null;
  let closestExactScore = -Infinity;
  let closestExactTieKey = '';
  let firstCalculationError = null;
  let successfulCalculationCount = 0;
  const hasCustomProfile = Boolean(customProfile && typeof customProfile === 'object');
  const normalizedExactTargets = normalizeCustomExactTargets(customExactTargets);
  const hasExactTargets = hasCustomProfile
    && hasEnabledCustomExactTargets(normalizedExactTargets);
  const maxHorizontalRecoil = hasCustomProfile
    ? Number(customProfile.horizontalRecoil)
    : Number.POSITIVE_INFINITY;
  const customTargetValues = {
    ergonomics: Number(minErgo),
    verticalRecoil: Number(maxRecoil),
    horizontalRecoil: maxHorizontalRecoil,
    weight: Number(customProfile?.weight),
    price: Number(customProfile?.price),
  };
  const exactMaxWeight = normalizedExactTargets.weight
    ? customTargetValues.weight + getCustomExactTolerance('weight', customTargetValues.weight)
    : Number(customProfile?.weight) || 0;
  const exactMaxPrice = normalizedExactTargets.price
    ? customTargetValues.price + getCustomExactTolerance('price', customTargetValues.price)
    : Number(customProfile?.price) || 0;
  const customOptions = hasCustomProfile
    ? {
        ...options,
        maxWeight: Number.isFinite(exactMaxWeight) ? exactMaxWeight : 0,
        maxPrice: Number.isFinite(exactMaxPrice) ? exactMaxPrice : 0,
      }
    : options;

  function getCustomRequirementMatches(result) {
    const ergonomics = result.stats.ergonomics;
    const verticalRecoil = result.stats.recoilVertical;
    const horizontalRecoil = result.stats.recoilHorizontal;
    const weight = parseFloat(result.stats.weight);
    const price = result.stats.price;

    return {
      ergonomics,
      verticalRecoil,
      horizontalRecoil,
      weight,
      price,
      ergoMet: ergonomics >= minErgo,
      recoilMet: verticalRecoil <= maxRecoil,
      horizontalRecoilMet: horizontalRecoil <= maxHorizontalRecoil,
      weightMet: !(customOptions.maxWeight > 0) || weight <= customOptions.maxWeight,
      priceMet: !(customOptions.maxPrice > 0)
        || (price != null && price <= customOptions.maxPrice),
    };
  }

  function getExactEvaluation(matches) {
    return evaluateCustomExactTargets(
      {
        ergonomics: matches.ergonomics,
        verticalRecoil: matches.verticalRecoil,
        horizontalRecoil: matches.horizontalRecoil,
        weight: matches.weight,
        price: matches.price,
      },
      customTargetValues,
      normalizedExactTargets,
    );
  }

  function getCustomScore(matches) {
    return 10000
      + matches.ergonomics
      - matches.verticalRecoil
      - matches.horizontalRecoil;
  }

  function getBuildTieKey(result) {
    return result.build
      .map(part => String(part.item?.id ?? ''))
      .sort()
      .join('|');
  }

  function meetsNonExactRequirements(matches) {
    return (
      (normalizedExactTargets.ergonomics || matches.ergoMet)
      && (normalizedExactTargets.verticalRecoil || matches.recoilMet)
      && (normalizedExactTargets.horizontalRecoil || matches.horizontalRecoilMet)
      && (normalizedExactTargets.weight || matches.weightMet)
      && (normalizedExactTargets.price || matches.priceMet)
    );
  }

  function considerExactCandidate(result, matches) {
    if (!meetsNonExactRequirements(matches)) return;

    const evaluation = getExactEvaluation(matches);
    const score = getCustomScore(matches);
    const tieKey = getBuildTieKey(result);
    const closer = !closestExactEvaluation
      || evaluation.totalError < closestExactEvaluation.totalError
      || (
        evaluation.totalError === closestExactEvaluation.totalError
        && (
          score > closestExactScore
          || (score === closestExactScore && (
            (result.stats.price ?? Number.POSITIVE_INFINITY)
              < (closestExactBuild?.stats.price ?? Number.POSITIVE_INFINITY)
            || (
              result.stats.price === closestExactBuild?.stats.price
              && tieKey.localeCompare(closestExactTieKey) < 0
            )
          ))
        )
      );

    if (closer) {
      closestExactBuild = result;
      closestExactEvaluation = evaluation;
      closestExactScore = score;
      closestExactTieKey = tieKey;
    }

    if (!evaluation.matches) return;

    const better = !bestBuild
      || evaluation.totalError < bestExactError
      || (
        evaluation.totalError === bestExactError
        && (
          score > bestBuildScore
          || (score === bestBuildScore && (
            (result.stats.price ?? Number.POSITIVE_INFINITY)
              < (bestBuild.stats.price ?? Number.POSITIVE_INFINITY)
            || (
              result.stats.price === bestBuild.stats.price
              && tieKey.localeCompare(bestBuildTieKey) < 0
            )
          ))
        )
      );

    if (better) {
      bestBuild = result;
      bestBuildScore = score;
      bestExactError = evaluation.totalError;
      bestBuildTieKey = tieKey;
    }
  }

  if (hasCustomProfile) {
    const metaCandidate = _calculateWeighted(
      weapon,
      1,
      3,
      0,
      modMap,
      customOptions,
      50,
      'meta',
      15,
      0.15,
      70,
      calculationCache,
    );

    if (!metaCandidate.error) {
      const matches = getCustomRequirementMatches(metaCandidate);
      if (hasExactTargets) {
        considerExactCandidate(metaCandidate, matches);
      }
      if (
        !hasExactTargets
        &&
        matches.ergoMet
        && matches.recoilMet
        && matches.horizontalRecoilMet
        && matches.weightMet
        && matches.priceMet
      ) {
        return metaCandidate;
      }
    }
  }

  for (let i = 0; i <= 20; i++) {
    const ergoWeight = i / 20;
    const recoilWeight = 1 - ergoWeight;
    const priceWeight = 0; 
    const result = _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, customOptions, 100, 'custom', 0.001, 0, 100, calculationCache);
    if (result.error) {
      firstCalculationError ||= result;
      continue;
    }
    successfulCalculationCount += 1;
    
    const matches = getCustomRequirementMatches(result);
    const {
      ergonomics: e,
      verticalRecoil: r,
      horizontalRecoil: h,
      weight: w,
      ergoMet,
      recoilMet,
      horizontalRecoilMet,
      weightMet,
      priceMet,
    } = matches;
    let score;

    if (hasCustomProfile) {
      if (hasExactTargets) {
        considerExactCandidate(result, matches);
        continue;
      }
      if (!ergoMet || !recoilMet || !horizontalRecoilMet || !weightMet || !priceMet) continue;
      score = 10000 + e - r - h;
    } else if (ergoMet && recoilMet) {
      score = 10000 + e - r;
    } else if (ergoMet) {
      score = 5000 - r;
    } else if (recoilMet) {
      score = 5000 + e;
    } else {
      score = -Math.abs(minErgo - e) - Math.abs(r - maxRecoil);
    }

    if (customOptions.maxWeight > 0 && w > customOptions.maxWeight) {
      score -= (w - customOptions.maxWeight) * 1000;
    }
    
    if (score > bestBuildScore) {
      bestBuildScore = score;
      bestBuild = result;
    }
  }

  if (!bestBuild && successfulCalculationCount === 0 && firstCalculationError && !hasExactTargets) {
    return firstCalculationError;
  }

  if (hasCustomProfile && !bestBuild) {
    if (hasExactTargets) {
      const labelByKey = {
        ergonomics: 'ergonomics',
        verticalRecoil: 'vertical recoil',
        horizontalRecoil: 'horizontal recoil',
        weight: 'weight',
        price: 'price',
      };
      const failures = closestExactEvaluation?.failures ?? Object.entries(normalizedExactTargets)
        .filter(([, enabled]) => enabled)
        .map(([key]) => ({
          key,
          target: customTargetValues[key],
          actual: null,
          tolerance: getCustomExactTolerance(key, customTargetValues[key]),
          normalizedDeviation: Number.POSITIVE_INFINITY,
        }));
      const closestValues = failures
        .map(failure => {
          const actual = failure.actual == null ? 'unavailable' : failure.actual;
          return `${labelByKey[failure.key]} ${actual} (target ${failure.target} +/-${failure.tolerance})`;
        })
        .join(', ');

      return {
        build: [],
        stats: {
          ergonomics: weapon.properties?.ergonomics ?? 0,
          recoilVertical: weapon.properties?.recoilVertical ?? 0,
          recoilHorizontal: weapon.properties?.recoilHorizontal ?? 0,
          weight: Number(weapon.weight || 0).toFixed(2),
          price: null,
        },
        errorCode: 'CUSTOM_EXACT_TARGETS_UNMET',
        exactTargetFailures: failures,
        error: `No available build matches all enabled Exact targets within tolerance. Closest values: ${closestValues}. Disable Exact for one or more axes and try again.`,
      };
    }

    const constraints = [
      `ergonomics >= ${minErgo}`,
      `vertical recoil <= ${maxRecoil}`,
      `horizontal recoil <= ${maxHorizontalRecoil}`,
    ];
    if (customOptions.maxWeight > 0) constraints.push(`weight <= ${customOptions.maxWeight} kg`);
    if (customOptions.maxPrice > 0) constraints.push(`price <= ${customOptions.maxPrice} RUB`);

    return {
      build: [],
      stats: {
        ergonomics: weapon.properties?.ergonomics ?? 0,
        recoilVertical: weapon.properties?.recoilVertical ?? 0,
        recoilHorizontal: weapon.properties?.recoilHorizontal ?? 0,
        weight: Number(weapon.weight || 0).toFixed(2),
        price: null,
      },
      error: `No available build satisfies all Custom requirements (${constraints.join(', ')}). Relax one or more radar axes and try again.`,
    };
  }

  if (bestBuild.stats.ergonomics < minErgo || bestBuild.stats.recoilVertical > maxRecoil) {
    const warning = "It's physically impossible to meet your exact requirements with the current available parts. Showing the closest balanced build possible.";
    bestBuild.warning = bestBuild.warning ? `${bestBuild.warning} ${warning}` : warning;
  }

  return bestBuild;
}

export function recalculateBuildStats(weapon, buildParts, options = {}) {
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;

  function getItemPrice(item) {
    return getPurchasePriceValue(item, options, Number.POSITIVE_INFINITY);
  }

  let totalPrice = getItemPrice(weapon);

  buildParts.forEach(part => {
    totalErgo += part.item.ergonomicsModifier || 0;
    totalRecoilMod += part.item.recoilModifier || 0;
    totalWeight += part.item.weight || 0;
    totalPrice += getItemPrice(part.item);
  });

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  return {
    build: buildParts,
    stats: {
      ergonomics: Math.min(100, Math.max(0, Math.round(totalErgo))),
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Number.isFinite(totalPrice) ? Math.round(totalPrice) : null,
    }
  };
}

