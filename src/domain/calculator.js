import { getPurchasePriceValue } from '../data/price/priceMapper.js';

function createCalculationCache() {
  return {
    categoryNamesByItem: new WeakMap(),
    conflictIdsByItem: new WeakMap(),
    itemPricesByItem: new WeakMap(),
    sortedSlotsBySource: new WeakMap(),
    filteredAllowedItemsBySource: new WeakMap(),
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

  function getCategoryNames(item) {
    const cachedCategoryNames = calculationCache.categoryNamesByItem.get(item);
    if (cachedCategoryNames) return cachedCategoryNames;

    const categoryNames = new Set((item.categories || []).map(category => category.name));
    calculationCache.categoryNamesByItem.set(item, categoryNames);
    return categoryNames;
  }

  function hasCategory(item, categoryName) {
    return getCategoryNames(item).has(categoryName);
  }

  function getSlotSearchName(slotName, slotNameId = '') {
    return `${slotName || ''} ${slotNameId || ''}`.toLowerCase();
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

  function getSlotPriority(slotName) {
    const name = (slotName || '').toLowerCase();
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

    const sortedSlots = [...slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));
    calculationCache.sortedSlotsBySource.set(slots, sortedSlots);
    return sortedSlots;
  }

  function isTacticalSlot(slotName) {
    const name = (slotName || '').toLowerCase();
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

  function shouldApplyChildBranch(childEval, activeMustFindSuppressor, activeMustFindSight, activeMustFindRequired = false) {
    if (!childEval || !childEval.isValid || childEval.score === -Infinity) return false;

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

    if (!isRequiredItem && weaponHasSeparateStockSlot && isPistolGripSlot(slotName) && isCombinedPistolGripStock(item)) {
      return invalidBranchEvaluation();
    }

    if (!isRequiredItem && hasCategory(item, 'Sights') && !isValidSightForMode(item)) {
      return invalidBranchEvaluation();
    }

    const isTacSlot = isTacticalSlot(slotName);
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
    if (maxWeight > 0 && currentWeight + itemWeight > maxWeight + weightEpsilon) {
      return invalidBranchEvaluation();
    }

    const price = getItemPrice(item);
    if (maxPrice > 0 && currentPrice + price > maxPrice) {
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

      if (targetType === 'meta' || targetType === 'min_recoil') {
        branchScore = (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10) + (ergoM * 0.2);
      } else if (targetType === 'max_ergo') {
        branchScore = ergoM - (loadMod * 0.1);
      } else if (targetType === 'budget') {
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

      sortedSlots.forEach(slot => {
        if (isSkippedSlot(slot)) return;

        let allowed = slot.filters?.allowedItems;
        if (!allowed || allowed.length === 0) return;

        const isMagSlot = slot.name.toLowerCase() === 'mag'
          || slot.name.toLowerCase() === 'magazine'
          || slot.nameId === 'mod_magazine';

        if (isMagSlot) {
          allowed = filterAllowedItems(allowed, targetCapacity);
        }

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
          );

          if (childEval.isValid && childEval.score !== -Infinity) {
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

        if (shouldApplyChildBranch(bestChildEval, activeMustFindSuppressor, activeMustFindSight, activeMustFindRequired)) {
          mergeBranchEvaluation(branchEval, bestChildEval);

          branchErgo = Math.max(0, branchErgo + bestChildEval.statsDelta.ergonomics);
          branchTotalWeight += bestChildEval.statsDelta.weight;
          branchTotalPrice += bestChildEval.statsDelta.price;

          bestChildEval.items.forEach(part => branchInstalledIds.add(part.item.id));
          bestChildEval.conflicts.forEach(conflictId => branchConflicts.add(conflictId));
        }
      });
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

    sortedSlots.forEach(slot => {
      if (isSkippedSlot(slot)) return;

      let allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) return;

      const isMagSlot = slot.name.toLowerCase() === 'mag'
        || slot.name.toLowerCase() === 'magazine'
        || slot.nameId === 'mod_magazine';

      if (isMagSlot) {
        allowed = filterAllowedItems(allowed, targetCapacity);
      }

      let slotCanProvideSuppressor = false;
      let slotCanProvideSight = false;
      let slotCanProvideRequired = false;

      const candidates = [];

      allowed.forEach(shallowItem => {
        const item = modMap[shallowItem.id];
        if (!item) return;

        if (hasSight && hasCategory(item, 'Sights') && !requiredItemIds.has(item.id)) return;

        const branchEval = evaluateBranch(slot.name, item.id, totalErgo, new Set(), totalWeight, new Set(), new Set(), totalPrice);
        if (!branchEval.isValid) return;
        if (branchHasOnlyOptionalSight(branchEval)) return;

        if (maxWeight > 0) {
          const hypotheticalWeight = totalWeight + branchEval.statsDelta.weight;
          if (hypotheticalWeight > maxWeight + weightEpsilon) return;
        }

        if (maxPrice > 0) {
          const hypotheticalPrice = totalPrice + branchEval.statsDelta.price;
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

      if (!bestCandidate) return;
      if (activeMustFindSuppressor && !bestCandidate.hasSuppressor) return;
      if (activeMustFindSight && !bestCandidate.hasSight) return;
      if (activeMustFindRequired && bestCandidate.requiredMatches.size === 0) return;

      const rootItem = bestCandidate.branchEval.items[0]?.item;
      if (!rootItem) return;

      const isMount = hasCategory(rootItem, 'Mount');
      if (
        isMount
        && bestCandidate.score <= 0
        && !(options.requireSuppressor && !hasSuppressorGlobal && bestCandidate.hasSuppressor)
        && !(requireSight && !hasSight && bestCandidate.hasSight)
      ) {
        return;
      }

      applyBranchPlan(bestCandidate.branchEval);
    });
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
        const evaluateCandidate = () => evaluateBranch(rootSlotContext.slot.name, item.id, totalErgo, new Set(), totalWeight, new Set(), new Set(), totalPrice);
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

  processSlots(weapon.properties.slots);
  optimizeFinalBarrelBlock();

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

export function calculateBestBuild(weapon, targetType, minErgo, maxRecoil, modMap = {}, options = {}) {
  const calculationCache = createCalculationCache();

  if (targetType !== 'custom') {
     let ergoWeight = 1;
     let recoilWeight = 1;
     let priceWeight = 0;
     let weightWeight = 0.001;
     let overflowErgoWeight = 0;
     let ergoSoftCap = 100;
     let ergoCap = 100;
     
     if (targetType === 'max_ergo') { ergoWeight = 1; recoilWeight = 0; }
     else if (targetType === 'min_recoil') { ergoWeight = 0; recoilWeight = 1; }
     else if (targetType === 'meta') { ergoWeight = 1; recoilWeight = 3; weightWeight = 15; overflowErgoWeight = 0.15; ergoCap = 50; ergoSoftCap = 70; }
     else if (targetType === 'budget') { 
       ergoWeight = 1; 
       recoilWeight = 1.5; 
       priceWeight = 0.0001; 
     }
     
    return _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options, ergoCap, targetType, weightWeight, overflowErgoWeight, ergoSoftCap, calculationCache);
  }

  let bestBuild = null;
  let bestBuildScore = -Infinity;

  for (let i = 0; i <= 20; i++) {
    const ergoWeight = i / 20;
    const recoilWeight = 1 - ergoWeight;
    const priceWeight = 0; 
    const result = _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options, 100, 'custom', 0.001, 0, 100, calculationCache);
    if (result.error) return result;
    
    const e = result.stats.ergonomics;
    const r = result.stats.recoilVertical;
    const w = parseFloat(result.stats.weight);
    
    let score;
    const ergoMet = e >= minErgo;
    const recoilMet = r <= maxRecoil;
    
    if (ergoMet && recoilMet) {
      score = 10000 + e - r; 
    } else if (ergoMet) {
      score = 5000 - r; 
    } else if (recoilMet) {
      score = 5000 + e; 
    } else {
      score = -Math.abs(minErgo - e) - Math.abs(r - maxRecoil);
    }

    if (options.maxWeight > 0 && w > options.maxWeight) {
      score -= (w - options.maxWeight) * 1000;
    }
    
    if (score > bestBuildScore) {
      bestBuildScore = score;
      bestBuild = result;
    }
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

