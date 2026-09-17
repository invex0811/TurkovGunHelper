import {
  hasEnabledCustomExactTargets,
  normalizeCustomExactTargets,
} from '../customExactTargets.js';
import { _calculateWeighted } from './candidateSearch.js';
import {
  appendBuildWarning,
  BUILD_WARNING_CODES,
} from './buildResultMessages.js';
import { createCalculationCache } from './calculationCache.js';
import { PRICE_AWARE_TARGET } from './constants.js';
import { generatePriorityCandidates } from './priorityCandidates.js';
import {
  selectCustomPriorityCandidate,
  selectWeightedCustomPriorityCandidate,
} from './prioritySelection.js';
import {
  getBuildTieKey,
  getMetaResultScore,
  getPriceAwareResultScore,
} from './scoring.js';
import { evaluateCustomTargetMatching } from '../customTargetMatching.js';
import { getNestedSlotRouteKey, getRootSlotRouteKey } from './constraints.js';
import { createCompatibilityTools } from './compatibility.js';
import { createPricingTools } from './pricing.js';
import { scopeSupportsZoom } from '../scopeZoom.js';
import {
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
} from '../customPriorityAttributes.js';

const CONSTRAINT_ROUTE_BEAM_WIDTH = 24;
const CONSTRAINT_ROUTE_OPTIONS_PER_SLOT = 8;

function hasHardRouteConstraints(options) {
  return (options.requiredItemIds || []).length > 0
    || options.requireSuppressor === true
    || options.requireSight === true
    || options.includeLaser === true
    || options.includeFlashlight === true
    || Number(options.maxPrice) > 0;
}

function getRouteTieKey(route) {
  return Object.entries({ ...route.choices, ...route.nestedChoices })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, itemId]) => `${path}=${itemId ?? ''}`)
    .join('|');
}

function getRouteMatching(weapon, route, targets, exactTargets) {
  const recoilModifier = route.recoilModifier;
  return evaluateCustomTargetMatching(
    {
      ergonomics: (weapon.properties?.ergonomics || 0) + route.ergonomics,
      verticalRecoil: (weapon.properties?.recoilVertical || 0) * (1 + (recoilModifier / 100)),
      horizontalRecoil: (weapon.properties?.recoilHorizontal || 0) * (1 + (recoilModifier / 100)),
      weight: (weapon.weight || 0) + route.weight,
    },
    targets,
    exactTargets,
  );
}

function compareRoutes(left, right, weapon, targets, exactTargets) {
  const distance = getRouteMatching(weapon, left, targets, exactTargets).totalDistance
    - getRouteMatching(weapon, right, targets, exactTargets).totalDistance;
  if (distance !== 0) return distance;
  if (left.price !== right.price) return left.price - right.price;
  return getRouteTieKey(left).localeCompare(getRouteTieKey(right));
}

function hasFillableRequiredSlots(item, modMap, visitedIds = new Set()) {
  if (!item || visitedIds.has(item.id)) return false;

  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  return (item.properties?.slots || [])
    .filter(slot => slot.required === true)
    .every(slot => (slot.filters?.allowedItems || []).some(allowedItem => (
      hasFillableRequiredSlots(modMap[allowedItem.id], modMap, nextVisitedIds)
    )));
}

function getMinimumRequiredBranchPrice(item, modMap, getItemPrice, visitedIds = new Set()) {
  if (!item || visitedIds.has(item.id)) return Number.POSITIVE_INFINITY;
  const itemPrice = getItemPrice(item);
  if (!Number.isFinite(itemPrice)) return Number.POSITIVE_INFINITY;

  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  let requiredChildrenPrice = 0;

  for (const slot of item.properties?.slots || []) {
    if (slot.required !== true) continue;
    const minimumChildPrice = Math.min(
      ...(slot.filters?.allowedItems || []).map(allowedItem => getMinimumRequiredBranchPrice(
        modMap[allowedItem.id], modMap, getItemPrice, nextVisitedIds,
      )),
    );
    if (!Number.isFinite(minimumChildPrice)) return Number.POSITIVE_INFINITY;
    requiredChildrenPrice += minimumChildPrice;
  }

  return itemPrice + requiredChildrenPrice;
}

function getMinimumRequiredSlotPrice(slot, modMap, getItemPrice) {
  if (slot.required !== true) return 0;
  return Math.min(
    ...(slot.filters?.allowedItems || []).map(allowedItem => getMinimumRequiredBranchPrice(
      modMap[allowedItem.id], modMap, getItemPrice,
    )),
  );
}

function getTargetRankedRouteOptions(entries, weapon, targets, exactTargets) {
  return [...entries].sort((left, right) => {
    const leftRoute = {
      choices: { item: left.item.id },
      nestedChoices: left.capabilities.nestedChoices,
      ergonomics: left.capabilities.ergonomics,
      recoilModifier: left.capabilities.recoilModifier,
      weight: left.capabilities.weight,
      price: left.capabilities.price,
    };
    const rightRoute = {
      choices: { item: right.item.id },
      nestedChoices: right.capabilities.nestedChoices,
      ergonomics: right.capabilities.ergonomics,
      recoilModifier: right.capabilities.recoilModifier,
      weight: right.capabilities.weight,
      price: right.capabilities.price,
    };
    return compareRoutes(leftRoute, rightRoute, weapon, targets, exactTargets);
  });
}

function getCapabilitySignature(capabilities, future, options) {
  // Identity matters only while a remaining branch can duplicate the item or
  // conflict with it. Keeping every past ID here makes ordinary budgets exponential.
  const installedIds = [...capabilities.installedIds].filter(itemId => (
    future.installedIds.has(itemId) || future.conflictIds.has(itemId)
  ));
  const conflictIds = [...capabilities.conflictIds].filter(itemId => future.installedIds.has(itemId));
  return [
    [...capabilities.requiredIds].sort().join('|'),
    options.requireSuppressor === true ? capabilities.suppressorKind : '',
    capabilities.deviceMask,
    installedIds.sort().join('|'),
    conflictIds.sort().join('|'),
  ].join(';');
}

function combineDependencies(...dependencies) {
  return {
    installedIds: new Set(dependencies.flatMap(dependency => [...dependency.installedIds])),
    conflictIds: new Set(dependencies.flatMap(dependency => [...dependency.conflictIds])),
  };
}

function createFutureDependencies(modMap) {
  const bySlot = new WeakMap();
  function forSlot(slot) {
    if (bySlot.has(slot)) return bySlot.get(slot);
    const result = { installedIds: new Set(), conflictIds: new Set() };
    function visit(itemId) {
      if (result.installedIds.has(itemId)) return;
      const item = modMap[itemId];
      if (!item) return;
      result.installedIds.add(itemId);
      (item.conflictingItems || []).forEach(conflict => result.conflictIds.add(conflict.id));
      (item.properties?.slots || []).forEach(childSlot => (
        (childSlot.filters?.allowedItems || []).forEach(child => visit(child.id))
      ));
    }
    (slot.filters?.allowedItems || []).forEach(item => visit(item.id));
    bySlot.set(slot, result);
    return result;
  }
  return slots => combineDependencies(...slots.map(forSlot));
}

function getCombinedRouteState(route, capabilities) {
  return {
    installedIds: new Set([...route.installedIds, ...capabilities.installedIds]),
    conflictIds: new Set([...route.conflictIds, ...capabilities.conflictIds]),
  };
}

function isCompatibleCapabilities(route, capabilities) {
  for (const itemId of capabilities.installedIds) {
    if (route.installedIds.has(itemId) || route.conflictIds.has(itemId)) return false;
  }
  for (const conflictId of capabilities.conflictIds) {
    if (route.installedIds.has(conflictId)) return false;
  }
  return true;
}

function dedupeCapabilityVariants(variants, future, options, tools, route) {
  const asRoute = variant => ({
    ...variant,
    ergonomics: route.ergonomics + variant.ergonomics,
    recoilModifier: route.recoilModifier + variant.recoilModifier,
    weight: route.weight + variant.weight,
  });
  const compare = (left, right) => compareRoutes(
    asRoute(left), asRoute(right), tools.weapon, tools.targets, tools.exactTargets,
  );
  const ranked = variants.sort(compare);
  if (!hasHardRouteConstraints(options)) return ranked.slice(0, CONSTRAINT_ROUTE_BEAM_WIDTH);

  const bySignature = new Map();
  ranked.forEach(variant => {
    const signature = getCapabilitySignature(variant, future, options);
    const current = bySignature.get(signature);
    if (!current || variant.price < current.price) {
      bySignature.set(signature, variant);
    }
  });
  const protectedVariants = new Set(bySignature.values());
  return [
    ...protectedVariants,
    ...ranked.filter(variant => !protectedVariants.has(variant))
      .slice(0, Math.max(0, CONSTRAINT_ROUTE_BEAM_WIDTH - protectedVariants.size)),
  ];
}

function combineCapabilities(left, right, nestedSuppressor = false) {
  const requiredIds = new Set([...left.requiredIds, ...right.requiredIds]);
  return {
    requiredIds,
    suppressorKind: Math.max(left.suppressorKind, right.suppressorKind > 0 && nestedSuppressor ? 1 : right.suppressorKind),
    installedIds: new Set([...left.installedIds, ...right.installedIds]),
    conflictIds: new Set([...left.conflictIds, ...right.conflictIds]),
    price: left.price + right.price,
    ergonomics: left.ergonomics + right.ergonomics,
    recoilModifier: left.recoilModifier + right.recoilModifier,
    weight: left.weight + right.weight,
    nestedChoices: { ...left.nestedChoices, ...right.nestedChoices },
    deviceMask: left.deviceMask | right.deviceMask,
  };
}

function getRouteCapabilityVariants(item, modMap, options, tools, route, branchPath, future, visitedIds = new Set()) {
  if (!item || visitedIds.has(item.id) || route.installedIds.has(item.id) || route.conflictIds.has(item.id)) return [];
  if ((item.conflictingItems || []).some(conflict => route.installedIds.has(conflict.id))) return [];
  if (options.forbidSuppressor === true && tools.isSuppressor(item)) return [];
  if (!tools.isAllowedSight(item)) return [];

  const itemPrice = tools.getItemPrice(item);
  if (Number(options.maxPrice) > 0 && !Number.isFinite(itemPrice)) return [];
  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  const rootCapabilities = {
    requiredIds: requiredItemIds.has(item.id) ? new Set([item.id]) : new Set(),
    suppressorKind: tools.isSuppressor(item) ? 2 : 0,
    installedIds: new Set([item.id]),
    conflictIds: new Set((item.conflictingItems || []).map(conflict => conflict.id)),
    price: itemPrice,
    ergonomics: item.ergonomicsModifier || 0,
    recoilModifier: item.recoilModifier || 0,
    weight: item.weight || 0,
    nestedChoices: {},
    deviceMask: tools.getRequiredDeviceMask(item),
  };
  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  let variants = [rootCapabilities];

  const slots = item.properties?.slots || [];
  for (const [slotIndex, slot] of slots.entries()) {
    const slotPath = getNestedSlotRouteKey(branchPath, item, slot, slots);
    const remaining = combineDependencies(future, tools.getFutureDependencies(slots.slice(slotIndex + 1)));
    const nextVariants = [];
    for (const variant of variants) {
      const activeRoute = {
        ...getCombinedRouteState(route, variant),
        ergonomics: route.ergonomics + variant.ergonomics,
        recoilModifier: route.recoilModifier + variant.recoilModifier,
        weight: route.weight + variant.weight,
        price: route.price + variant.price,
      };
      const canProvideRequirement = slot.required === true || tools.slotProvidesRequirement(slot);
      const childVariants = (canProvideRequirement ? slot.filters?.allowedItems || [] : []).flatMap(allowedItem => (
        getRouteCapabilityVariants(
          modMap[allowedItem.id],
          modMap,
          options,
          tools,
          activeRoute,
          slotPath,
          remaining,
          nextVisitedIds,
        )
      )).filter(child => isCompatibleCapabilities(activeRoute, child) && (
        slot.required === true
        || child.requiredIds.size > 0
        || (options.requireSuppressor === true && child.suppressorKind > 0)
        || child.deviceMask > 0
      ));
      if (slot.required !== true) {
        nextVariants.push({ ...variant, nestedChoices: { ...variant.nestedChoices, [slotPath]: null } });
      }
      childVariants.forEach(child => {
        const combined = combineCapabilities(variant, child, true);
        combined.nestedChoices[slotPath] = [...child.installedIds][0];
        nextVariants.push(combined);
      });
    }
    variants = dedupeCapabilityVariants(nextVariants, remaining, options, tools, route);
    if (variants.length === 0) return [];
  }

  return variants;
}

function selectConstraintRouteOptions(
  slot,
  slots,
  weapon,
  modMap,
  targets,
  exactTargets,
  options,
  tools,
  route,
  future,
) {
  const allItems = (slot.filters?.allowedItems || [])
    .map(allowedItem => modMap[allowedItem.id])
    .filter(Boolean);
  const fillableItems = allItems.filter(item => hasFillableRequiredSlots(item, modMap));
  const candidates = fillableItems.length > 0 ? fillableItems : allItems;
  const optionVariants = candidates.flatMap(item => getRouteCapabilityVariants(
    item, modMap, options, tools, route, getRootSlotRouteKey(slot, slots), future,
  ).map(capabilities => ({ item, capabilities })));
  const rankedOptions = getTargetRankedRouteOptions(optionVariants, weapon, targets, exactTargets);
  return hasHardRouteConstraints(options) ? rankedOptions : rankedOptions.slice(0, CONSTRAINT_ROUTE_OPTIONS_PER_SLOT);
}

function getRemainingRequiredRootsPrice(slots, currentIndex, modMap, getItemPrice) {
  return slots
    .slice(currentIndex + 1)
    .reduce((sum, slot) => sum + getMinimumRequiredSlotPrice(slot, modMap, getItemPrice), 0);
}

function getRouteHardKey(route, options, future) {
  return getCapabilitySignature({ ...route, requiredIds: route.requiredCoverage }, future, options);
}

function compareHardRoutes(left, right, remainingRequiredRootsPrice, weapon, targets, exactTargets) {
  const leftPrice = left.price + remainingRequiredRootsPrice;
  const rightPrice = right.price + remainingRequiredRootsPrice;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return compareRoutes(left, right, weapon, targets, exactTargets);
}

function pruneConstraintRoutes(
  routes,
  remainingRequiredRootsPrice,
  weapon,
  targets,
  exactTargets,
  options,
  basePrice,
  future,
) {
  const maxPrice = Number(options.maxPrice) || 0;
  const rankedRoutes = routes.filter(route => !(maxPrice > 0) || (
    Number.isFinite(basePrice + route.price + remainingRequiredRootsPrice)
    && basePrice + route.price + remainingRequiredRootsPrice <= maxPrice
  )).sort((left, right) => (
    compareRoutes(left, right, weapon, targets, exactTargets)
  ));
  if (!hasHardRouteConstraints(options)) return rankedRoutes.slice(0, CONSTRAINT_ROUTE_BEAM_WIDTH);

  const hardFrontier = new Map();
  rankedRoutes.forEach(route => {
    const hardKey = getRouteHardKey(route, options, future);
    const current = hardFrontier.get(hardKey);
    if (!current || compareHardRoutes(route, current, remainingRequiredRootsPrice, weapon, targets, exactTargets) < 0) {
      hardFrontier.set(hardKey, route);
    }
  });

  const protectedRoutes = [...hardFrontier.values()].sort((left, right) => (
    compareHardRoutes(left, right, remainingRequiredRootsPrice, weapon, targets, exactTargets)
  ));
  const getRouteStateKey = route => getRouteTieKey(route);
  const protectedRouteKeys = new Set(protectedRoutes.map(getRouteStateKey));
  const remainingRoutes = rankedRoutes.filter(route => !protectedRouteKeys.has(getRouteStateKey(route)));

  // The hard frontier remains intact even when it exceeds the normal beam width.
  return [
    ...protectedRoutes,
    ...remainingRoutes.slice(0, Math.max(0, CONSTRAINT_ROUTE_BEAM_WIDTH - protectedRoutes.length)),
  ];
}

export function createConstraintSearchRoutes(
  weapon,
  modMap,
  targets,
  exactTargets,
  options = {},
  calculationCache = createCalculationCache(),
) {
  let routes = [{
    choices: {},
    nestedChoices: {},
    ergonomics: 0,
    recoilModifier: 0,
    weight: 0,
    price: 0,
    requiredCoverage: new Set(),
    suppressorKind: 0,
    deviceMask: 0,
    installedIds: new Set([weapon.id]),
    conflictIds: new Set((weapon.conflictingItems || []).map(conflict => conflict.id)),
  }];
  const slots = weapon.properties?.slots || [];
  const { isSuppressor, hasCategory } = createCompatibilityTools(calculationCache);
  const { getItemPrice, getWeaponPrice } = createPricingTools(calculationCache, options);
  const getFutureDependencies = createFutureDependencies(modMap);
  const getRequiredDeviceMask = item => (
    (options.requireSight === true && hasCategory(item, 'Sights') ? 1 : 0)
    | (options.includeLaser === true && hasCategory(item, 'Comb. tact. device') ? 2 : 0)
    | (options.includeFlashlight === true && hasCategory(item, 'Flashlight') ? 4 : 0)
  );
  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  const isAllowedSight = item => {
    if (!hasCategory(item, 'Sights') || requiredItemIds.has(item.id)) return true;
    if (['Ironsight', 'Thermal Vision', 'Night Vision', 'Special scope'].some(category => hasCategory(item, category))) return false;
    const mode = options.sightMode || 'any';
    if (mode === 'none') return false;
    if (mode === 'any') return true;
    if (mode === 'reflex') return hasCategory(item, 'Reflex sight') || hasCategory(item, 'Compact reflex sight');
    if (mode === 'scope') return hasCategory(item, 'Scope') || hasCategory(item, 'Assault scope');
    return isNaN(Number(mode)) || scopeSupportsZoom(item, Number(mode));
  };
  const slotProvidesRequirement = slot => [...getFutureDependencies([slot]).installedIds].some(itemId => (
    requiredItemIds.has(itemId)
    || (options.requireSuppressor === true && isSuppressor(modMap[itemId]))
    || getRequiredDeviceMask(modMap[itemId]) > 0
  ));
  const tools = {
    getItemPrice, isSuppressor, getFutureDependencies, getRequiredDeviceMask, slotProvidesRequirement, isAllowedSight,
    weapon, targets, exactTargets,
  };

  for (const [slotIndex, slot] of slots.entries()) {
    // Required roots are where a greedy early choice can prevent a later required
    // composition. Optional roots retain the target-aware branch scorer below.
    if (slot.required !== true) continue;
    const routeKey = getRootSlotRouteKey(slot, slots);
    if (!routeKey) continue;
    const future = getFutureDependencies(slots.filter((otherSlot, otherIndex) => (
      otherIndex > slotIndex || otherSlot.required !== true
    )));
    routes = routes.flatMap(route => {
      const allowed = selectConstraintRouteOptions(
        slot,
        slots,
        weapon,
        modMap,
        targets,
        exactTargets,
        options,
        tools,
        route,
        future,
      );
      return allowed.map(({ item, capabilities }) => {
        const requiredCoverage = new Set(route.requiredCoverage);
        capabilities.requiredIds.forEach(requiredId => requiredCoverage.add(requiredId));
        const combinedRouteState = getCombinedRouteState(route, capabilities);
        return {
          choices: { ...route.choices, [routeKey]: item.id },
          nestedChoices: { ...route.nestedChoices, ...capabilities.nestedChoices },
          ergonomics: route.ergonomics + capabilities.ergonomics,
          recoilModifier: route.recoilModifier + capabilities.recoilModifier,
          weight: route.weight + capabilities.weight,
          price: route.price + capabilities.price,
          requiredCoverage,
          suppressorKind: Math.max(route.suppressorKind, capabilities.suppressorKind),
          deviceMask: route.deviceMask | capabilities.deviceMask,
          installedIds: combinedRouteState.installedIds,
          conflictIds: combinedRouteState.conflictIds,
        };
      });
    });
    const remainingRequiredRootsPrice = getRemainingRequiredRootsPrice(
      slots,
      slots.indexOf(slot),
      modMap,
      getItemPrice,
    );
    routes = pruneConstraintRoutes(
      routes,
      remainingRequiredRootsPrice,
      weapon,
      targets,
      exactTargets,
      options,
      getWeaponPrice(weapon),
      future,
    );
  }

  return routes;
}

export function compareConstraintCandidates(left, right) {
  const distance = left.targetMatching.totalDistance - right.targetMatching.totalDistance;
  if (distance !== 0) return distance;
  const leftPrice = left.result.stats.price ?? Number.POSITIVE_INFINITY;
  const rightPrice = right.result.stats.price ?? Number.POSITIVE_INFINITY;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return left.tieKey.localeCompare(right.tieKey);
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
  priorityAttributes = [],
  characteristicMode = 'constraints',
  prioritySelectionMode = 'ordered',
  priorityWeights = undefined,
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
      isPriceAwareCalculation ? { budgetAwareSearch: true } : undefined,
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

      const scoringOptions = {
        ergoCap,
        ergoSoftCap,
        ergoWeight,
        overflowErgoWeight,
        recoilWeight,
        weightWeight,
      };
      const priceAwareScore = getMetaResultScore(priceAwareResult, weapon, scoringOptions);
      const primaryScore = getMetaResultScore(primaryResult, weapon, scoringOptions);
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
      { budgetAwareSearch: true },
    );

    const scoringOptions = {
      ergoWeight,
      priceWeight,
      recoilWeight,
      weightWeight,
    };
    return getPriceAwareResultScore(priceSensitiveResult, scoringOptions)
      > getPriceAwareResultScore(primaryResult, scoringOptions)
      ? priceSensitiveResult
      : primaryResult;
  }

  const normalizedCharacteristicMode = normalizeCustomCharacteristicMode(characteristicMode);
  const isPriorityMode = normalizedCharacteristicMode === 'priorities';
  const normalizedPriorityAttributes = normalizePriorityAttributes(priorityAttributes);
  const normalizedPrioritySelectionMode = normalizePrioritySelectionMode(prioritySelectionMode);
  const normalizedPriorityWeights = normalizePriorityWeights(priorityWeights);
  const hasCustomProfile = Boolean(customProfile && typeof customProfile === 'object');
  const customTargetValues = {
    ergonomics: Number(minErgo),
    verticalRecoil: Number(maxRecoil),
    horizontalRecoil: Number(customProfile?.horizontalRecoil),
    weight: Number(customProfile?.weight),
  };
  const normalizedExactTargets = normalizeCustomExactTargets(customExactTargets, customTargetValues);
  const hasExactTargets = !isPriorityMode
    && hasCustomProfile
    && hasEnabledCustomExactTargets(normalizedExactTargets);
  const customOptions = isPriorityMode
    ? {
        ...options,
        maxWeight: 0,
      }
    : options;

  if (isPriorityMode) {
    const priorityCandidates = generatePriorityCandidates({
      weapon,
      modMap,
      options: customOptions,
      calculationCache,
    });
    const selectedPriorityCandidate = normalizedPrioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED
      ? selectWeightedCustomPriorityCandidate(
        priorityCandidates.candidates,
        normalizedPriorityWeights,
      )
      : selectCustomPriorityCandidate(
        priorityCandidates.candidates,
        normalizedPriorityAttributes,
      );
    if (selectedPriorityCandidate) return selectedPriorityCandidate.result;
    if (priorityCandidates.successfulCalculationCount === 0 && priorityCandidates.firstCalculationError) {
      return priorityCandidates.firstCalculationError;
    }
    return {
      build: [],
      stats: {
        ergonomics: weapon.properties?.ergonomics ?? 0,
        recoilModifier: 0,
        recoilVertical: weapon.properties?.recoilVertical ?? 0,
        recoilHorizontal: weapon.properties?.recoilHorizontal ?? 0,
        weight: Number(weapon.weight || 0).toFixed(2),
        price: null,
      },
      error: customOptions.maxPrice > 0
        ? `No available build satisfies the priority maximum price of ${customOptions.maxPrice} RUB.`
        : 'No available build satisfies the current builder options.',
    };
  }

  if (hasCustomProfile) {
    const targetSearchCapabilities = {
      targetMatching: {
        targets: customTargetValues,
        exactTargets: normalizedExactTargets,
      },
    };
    // Bounded deterministic beam over root slots. Each route still relies on the
    // compatibility-aware recursive builder for nested chains and hard constraints.
    const routes = createConstraintSearchRoutes(
      weapon,
      modMap,
      customTargetValues,
      normalizedExactTargets,
      customOptions,
      calculationCache,
    );
    const calculateRoute = (route = {}, forceNested = false) => _calculateWeighted(
      weapon,
      1,
      1,
      0,
      modMap,
      customOptions,
      100,
      'custom',
      0,
      0,
      100,
      calculationCache,
      {
        ...targetSearchCapabilities,
        forcedRootChoices: route.choices,
        forcedNestedChoices: forceNested ? route.nestedChoices : undefined,
      },
    );
    const candidates = [];
    const ordinaryRootChoices = new Set();
    routes.forEach(route => {
      const rootKey = JSON.stringify(route.choices);
      if (!ordinaryRootChoices.has(rootKey)) {
        candidates.push(calculateRoute(route));
        ordinaryRootChoices.add(rootKey);
      }
      if (Object.keys(route.nestedChoices).length > 0) candidates.push(calculateRoute(route, true));
    });
    // Empty frontiers still return the builder's normal structured errors and
    // missing-price warnings, never undefined.
    if (candidates.length === 0) candidates.push(calculateRoute());
    let closestCandidate = null;
    let validExactCandidate = null;

    candidates.forEach(result => {
      if (result.error) return;
      const targetMatching = evaluateCustomTargetMatching(
        result.stats,
        customTargetValues,
        normalizedExactTargets,
      );
      const candidate = { result, targetMatching, tieKey: getBuildTieKey(result) };
      const isBetter = current => !current || compareConstraintCandidates(candidate, current) < 0;
      if (isBetter(closestCandidate)) closestCandidate = candidate;
      if (targetMatching.exactMatches && isBetter(validExactCandidate)) {
        validExactCandidate = candidate;
      }
    });

    if (!closestCandidate) return candidates[0];
    if (hasExactTargets && !validExactCandidate) {
      return {
        build: [],
        stats: {
          ergonomics: weapon.properties?.ergonomics ?? 0,
          recoilModifier: 0,
          recoilVertical: weapon.properties?.recoilVertical ?? 0,
          recoilHorizontal: weapon.properties?.recoilHorizontal ?? 0,
          weight: Number(weapon.weight || 0).toFixed(2),
          price: null,
        },
        errorCode: 'CUSTOM_EXACT_TARGETS_UNMET',
        exactTargetFailures: closestCandidate.targetMatching.exactFailures,
        targetMatching: closestCandidate.targetMatching,
        closestTargetMatching: closestCandidate.targetMatching,
        error: 'The builder\'s bounded search did not find a strict match for all enabled Exact targets. Disable Exact for one or more axes to use the best match it found.',
      };
    }

    const selectedCandidate = hasExactTargets ? validExactCandidate : closestCandidate;
    return {
      ...selectedCandidate.result,
      targetMatching: selectedCandidate.targetMatching,
    };
  }

  let bestBuild = null;
  let bestBuildScore = -Infinity;
  let firstCalculationError = null;
  let successfulCalculationCount = 0;
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

    const e = result.stats.ergonomics;
    const r = result.stats.recoilVertical;
    let score;

    if (e >= minErgo && r <= maxRecoil) {
      score = 10000 + e - r;
    } else if (e >= minErgo) {
      score = 5000 - r;
    } else if (r <= maxRecoil) {
      score = 5000 + e;
    } else {
      score = -Math.abs(minErgo - e) - Math.abs(r - maxRecoil);
    }

    if (score > bestBuildScore) {
      bestBuildScore = score;
      bestBuild = result;
    }
  }

  if (!bestBuild && successfulCalculationCount === 0 && firstCalculationError) {
    return firstCalculationError;
  }

  if (bestBuild.stats.ergonomics < minErgo || bestBuild.stats.recoilVertical > maxRecoil) {
    appendBuildWarning(bestBuild, {
      code: BUILD_WARNING_CODES.REQUIREMENTS_UNMET_CLOSEST_BUILD,
      params: {},
      fallback: "It's physically impossible to meet your exact requirements with the current available parts. Showing the closest balanced build possible.",
    });
  }

  return bestBuild;
}
