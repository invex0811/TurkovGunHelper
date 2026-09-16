import { createBranchEvaluator } from './branchEvaluation.js';
import { createBuildOptimizers } from './buildOptimizers.js';
import {
  BUILD_WARNING_CODES,
  setBuildWarnings,
} from './buildResultMessages.js';
import { createCalculationCache } from './calculationCache.js';
import { createCompatibilityTools } from './compatibility.js';
import { createPricingTools } from './pricing.js';
import { scopeSupportsZoom } from '../scopeZoom.js';
import { evaluateCustomTargetMatching } from '../customTargetMatching.js';

export function _calculateWeighted(
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
  searchCapabilities = {},
) {
  const {
    getSlotSearchName,
    hasCategory,
    isBarrelSlot,
    isCombinedPistolGripStock,
    isMuzzleSlot,
    isPistolGripSlot,
    isStockSlot,
    isSuppressor,
  } = createCompatibilityTools(calculationCache);
  const {
    addItemConflictsToSet,
    getItemConflictIds,
    getItemPrice,
    getWeaponPrice,
  } = createPricingTools(calculationCache, options);

  const build = [];
  const budgetAwareSearch = searchCapabilities?.budgetAwareSearch === true;
  const targetMatching = searchCapabilities?.targetMatching ?? null;
  const forcedRootChoices = searchCapabilities?.forcedRootChoices ?? null;
  let branchEvaluatorOptions = options;

  function clearForcedBranchCaches() {
    calculationCache.minimumRequiredPricesByItem = new WeakMap();
    calculationCache.minimumRequiredPricesBySlot = new WeakMap();
    calculationCache.minimumRequiredWeightsByItem = new WeakMap();
    calculationCache.minimumRequiredWeightsBySlot = new WeakMap();
  }

  function withBranchEvaluatorSuppressorOverride(callback) {
    const previousOptions = branchEvaluatorOptions;
    branchEvaluatorOptions = {
      ...previousOptions,
      requireSuppressor: false,
      forbidSuppressor: true,
    };

    try {
      return callback();
    } finally {
      branchEvaluatorOptions = previousOptions;
    }
  }
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = getWeaponPrice(weapon);
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
    totalPrice = getWeaponPrice(weapon);
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
      return scopeSupportsZoom(item, parsedMode);
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

  function getTargetBranchImprovement(branchEval) {
    if (!targetMatching) return null;

    const baseMatching = evaluateCustomTargetMatching(
      {
        ergonomics: totalErgo,
        verticalRecoil: baseRecoilV * (1 + (totalRecoilMod / 100)),
        horizontalRecoil: baseRecoilH * (1 + (totalRecoilMod / 100)),
        weight: totalWeight,
      },
      targetMatching.targets,
      targetMatching.exactTargets,
    );
    const projectedRecoilModifier = totalRecoilMod + branchEval.statsDelta.recoil;
    const projectedMatching = evaluateCustomTargetMatching(
      {
        ergonomics: totalErgo + branchEval.statsDelta.ergonomics,
        verticalRecoil: baseRecoilV * (1 + (projectedRecoilModifier / 100)),
        horizontalRecoil: baseRecoilH * (1 + (projectedRecoilModifier / 100)),
        weight: totalWeight + branchEval.statsDelta.weight,
      },
      targetMatching.targets,
      targetMatching.exactTargets,
    );

    return baseMatching.totalDistance - projectedMatching.totalDistance;
  }

  const {
    evaluateBranch,
    isBetterBranch,
  } = createBranchEvaluator({
    get budgetAwareSearch() { return budgetAwareSearch; },
    get addItemConflictsToSet() { return addItemConflictsToSet; },
    get branchHasOnlyOptionalSight() { return branchHasOnlyOptionalSight; },
    get branchHasRequiredSight() { return branchHasRequiredSight; },
    get ergoCap() { return ergoCap; },
    get ergoSoftCap() { return ergoSoftCap; },
    get ergoWeight() { return ergoWeight; },
    get filterAllowedItems() { return filterAllowedItems; },
    get getItemConflictIds() { return getItemConflictIds; },
    get getItemPrice() { return getItemPrice; },
    get getRemainingRequiredSlotPrice() { return getRemainingRequiredSlotPrice; },
    get getRemainingRequiredSlotWeight() { return getRemainingRequiredSlotWeight; },
    get getSortedSlots() { return getSortedSlots; },
    get getTargetBranchImprovement() { return getTargetBranchImprovement; },
    get hasCategory() { return hasCategory; },
    get hasFlashlightDevice() { return hasFlashlightDevice; },
    get hasLaserDevice() { return hasLaserDevice; },
    get hasRequiredItemRequirements() { return hasRequiredItemRequirements; },
    get hasSight() { return hasSight; },
    get installedConflicts() { return installedConflicts; },
    get installedIds() { return installedIds; },
    get isCombinedPistolGripStock() { return isCombinedPistolGripStock; },
    get isMagazineSlot() { return isMagazineSlot; },
    get isPistolGripSlot() { return isPistolGripSlot; },
    get isReservedForRequiredTacticalDevice() { return isReservedForRequiredTacticalDevice; },
    get isSkippedSlot() { return isSkippedSlot; },
    get isSuppressor() { return isSuppressor; },
    get isTacticalSlot() { return isTacticalSlot; },
    get isValidSightForMode() { return isValidSightForMode; },
    get isValidTacticalDevice() { return isValidTacticalDevice; },
    get itemTreeCanProvideRequiredItem() { return itemTreeCanProvideRequiredItem; },
    get maxPrice() { return maxPrice; },
    get maxWeight() { return maxWeight; },
    get modMap() { return modMap; },
    get options() { return branchEvaluatorOptions; },
    get overflowErgoWeight() { return overflowErgoWeight; },
    get priceWeight() { return priceWeight; },
    get recoilWeight() { return recoilWeight; },
    get requireSight() { return requireSight; },
    get requiredItemIds() { return requiredItemIds; },
    get targetCapacity() { return targetCapacity; },
    get targetMatching() { return targetMatching; },
    get targetType() { return targetType; },
    get totalPrice() { return totalPrice; },
    get totalWeight() { return totalWeight; },
    get weaponHasSeparateStockSlot() { return weaponHasSeparateStockSlot; },
    get weightEpsilon() { return weightEpsilon; },
    get weightWeight() { return weightWeight; },
  });

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

      const routeKey = slot.nameId || slot.id || slot.name;
      if (forcedRootChoices && Object.hasOwn(forcedRootChoices, routeKey)) {
        const forcedItemId = forcedRootChoices[routeKey];
        if (forcedItemId == null) {
          if (slot.required === true) missingRequiredSlotNames.add(slot.name || slot.nameId || 'Unknown slot');
          continue;
        }
        allowed = allowed.filter(allowedItem => allowedItem.id === forcedItemId);
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
      const isOptionalErgoOnlyBudgetAwarePart = budgetAwareSearch
        && (rootItem.ergonomicsModifier || 0) > 0
        && (rootItem.recoilModifier || 0) >= 0
        && !hasCategory(rootItem, 'Magazine');
      if (
        (isMount || isOptionalErgoOnlyBudgetAwarePart)
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

  const {
    optimizeFinalBarrelBlock,
    optimizeFinalMuzzleBlock,
    optimizeBudgetAwareLeafRecoilUpgrades,
  } = createBuildOptimizers({
    get addItemConflictsToSet() { return addItemConflictsToSet; },
    get applyBranchPlan() { return applyBranchPlan; },
    get baseRecoilH() { return baseRecoilH; },
    get baseRecoilV() { return baseRecoilV; },
    get budgetAwareSearch() { return budgetAwareSearch; },
    get build() { return build; },
    get clearForcedBranchCaches() { return clearForcedBranchCaches; },
    get ergoCap() { return ergoCap; },
    get ergoSoftCap() { return ergoSoftCap; },
    get ergoWeight() { return ergoWeight; },
    get evaluateBranch() { return evaluateBranch; },
    get getItemPrice() { return getItemPrice; },
    get hasCategory() { return hasCategory; },
    get isBarrelSlot() { return isBarrelSlot; },
    get isMuzzleSlot() { return isMuzzleSlot; },
    get isSuppressor() { return isSuppressor; },
    get maxPrice() { return maxPrice; },
    get maxWeight() { return maxWeight; },
    get modMap() { return modMap; },
    get options() { return options; },
    get overflowErgoWeight() { return overflowErgoWeight; },
    get rebuildBuildState() { return rebuildBuildState; },
    get requireSight() { return requireSight; },
    get recoilWeight() { return recoilWeight; },
    get requiredItemIds() { return requiredItemIds; },
    get targetType() { return targetType; },
    get totalErgo() { return totalErgo; },
    get totalPrice() { return totalPrice; },
    get totalRecoilMod() { return totalRecoilMod; },
    get totalWeight() { return totalWeight; },
    get weapon() { return weapon; },
    get weightEpsilon() { return weightEpsilon; },
    get weightWeight() { return weightWeight; },
    get withBranchEvaluatorSuppressorOverride() { return withBranchEvaluatorSuppressorOverride; },
  });

  processSlots(weapon.properties.slots);
  optimizeFinalBarrelBlock();
  optimizeFinalMuzzleBlock();
  optimizeBudgetAwareLeafRecoilUpgrades();
  rebuildBuildState();

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  const result = {
    build,
    stats: {
      ergonomics: Math.min(100, Math.round(totalErgo)),
      recoilModifier: totalRecoilMod,
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
    warnings.push({
      code: BUILD_WARNING_CODES.BASE_WEAPON_MAX_WEIGHT,
      params: { maxWeight },
      fallback: 'The base weapon already exceeds the selected max weight.',
    });
  }
  if (maxPrice > 0 && totalPrice > maxPrice) {
    warnings.push({
      code: BUILD_WARNING_CODES.BUILD_MAX_PRICE_EXCEEDED,
      params: { maxPrice },
      fallback: 'The build exceeds the selected max price.',
    });
  }
  if (!Number.isFinite(totalPrice)) {
    const missingItemCount = [
      Number.isFinite(getWeaponPrice(weapon)),
      ...build.map(part => Number.isFinite(getItemPrice(part.item))),
    ].filter(hasPrice => !hasPrice).length;
    warnings.push({
      code: BUILD_WARNING_CODES.PRICE_ITEMS_UNAVAILABLE,
      params: { count: Math.max(1, missingItemCount) },
      fallback: 'One or more selected items have no available price under the active price policy.',
    });
  }
  setBuildWarnings(result, warnings);
  if (errors.length > 0) {
    result.error = errors.join(' ');
  }

  return result;
}
