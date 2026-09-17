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
import { getRootSlotRouteKey } from './constraints.js';
import { createCompatibilityTools } from './compatibility.js';
import { createPricingTools } from './pricing.js';
import {
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
} from '../customPriorityAttributes.js';

const CONSTRAINT_ROUTE_BEAM_WIDTH = 24;
const CONSTRAINT_ROUTE_OPTIONS_PER_SLOT = 8;

function getRouteTieKey(route) {
  return Object.values(route.choices)
    .filter(Boolean)
    .sort()
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
      ergonomics: left.item.ergonomicsModifier || 0,
      recoilModifier: left.item.recoilModifier || 0,
      weight: left.item.weight || 0,
      price: left.capabilities.price,
    };
    const rightRoute = {
      choices: { item: right.item.id },
      ergonomics: right.item.ergonomicsModifier || 0,
      recoilModifier: right.item.recoilModifier || 0,
      weight: right.item.weight || 0,
      price: right.capabilities.price,
    };
    const comparison = compareRoutes(leftRoute, rightRoute, weapon, targets, exactTargets);
    if (comparison !== 0) return comparison;
    return getCapabilitySignature(left.capabilities).localeCompare(getCapabilitySignature(right.capabilities));
  });
}

function getCapabilitySignature(capabilities) {
  return [
    [...capabilities.requiredIds].sort().join('|'),
    capabilities.suppressorKind,
    [...capabilities.installedIds].sort().join('|'),
    [...capabilities.conflictIds].sort().join('|'),
  ].join(';');
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

function dedupeCapabilityVariants(variants) {
  const bySignature = new Map();
  variants.forEach(variant => {
    const signature = getCapabilitySignature(variant);
    const current = bySignature.get(signature);
    if (!current || variant.price < current.price) {
      bySignature.set(signature, variant);
    }
  });
  return [...bySignature.values()].sort((left, right) => {
    if (left.price !== right.price) return left.price - right.price;
    return getCapabilitySignature(left).localeCompare(getCapabilitySignature(right));
  });
}

function combineCapabilities(left, right, nestedSuppressor = false) {
  const requiredIds = new Set([...left.requiredIds, ...right.requiredIds]);
  return {
    requiredIds,
    suppressorKind: Math.max(left.suppressorKind, right.suppressorKind > 0 && nestedSuppressor ? 1 : right.suppressorKind),
    installedIds: new Set([...left.installedIds, ...right.installedIds]),
    conflictIds: new Set([...left.conflictIds, ...right.conflictIds]),
    price: left.price + right.price,
  };
}

function getRouteCapabilityVariants(item, modMap, options, tools, route, visitedIds = new Set()) {
  if (!item || visitedIds.has(item.id) || route.installedIds.has(item.id) || route.conflictIds.has(item.id)) return [];
  if ((item.conflictingItems || []).some(conflict => route.installedIds.has(conflict.id))) return [];
  if (options.forbidSuppressor === true && tools.isSuppressor(item)) return [];

  const itemPrice = tools.getItemPrice(item);
  if (!Number.isFinite(itemPrice)) return [];
  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  const rootCapabilities = {
    requiredIds: requiredItemIds.has(item.id) ? new Set([item.id]) : new Set(),
    suppressorKind: tools.isSuppressor(item) ? 2 : 0,
    installedIds: new Set([item.id]),
    conflictIds: new Set((item.conflictingItems || []).map(conflict => conflict.id)),
    price: itemPrice,
  };
  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  let variants = [rootCapabilities];

  for (const slot of item.properties?.slots || []) {
    const nextVariants = [];
    for (const variant of variants) {
      const activeRoute = getCombinedRouteState(route, variant);
      const childVariants = (slot.filters?.allowedItems || []).flatMap(allowedItem => (
        getRouteCapabilityVariants(
          modMap[allowedItem.id],
          modMap,
          options,
          tools,
          activeRoute,
          nextVisitedIds,
        )
      )).filter(child => isCompatibleCapabilities(activeRoute, child));
      if (slot.required === true) {
        childVariants.forEach(child => nextVariants.push(combineCapabilities(variant, child, true)));
      } else {
        nextVariants.push(variant);
        childVariants
          .filter(child => child.requiredIds.size > 0 || child.suppressorKind > 0)
          .forEach(child => nextVariants.push(combineCapabilities(variant, child, true)));
      }
    }
    variants = dedupeCapabilityVariants(nextVariants);
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
  currentIndex,
) {
  const allItems = (slot.filters?.allowedItems || [])
    .map(allowedItem => modMap[allowedItem.id])
    .filter(Boolean);
  const fillableItems = allItems.filter(item => hasFillableRequiredSlots(item, modMap));
  const candidates = fillableItems.length > 0 ? fillableItems : allItems;
  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  const basePrice = tools.getWeaponPrice(weapon);
  const otherRequiredRootsPrice = slots
    .slice(currentIndex + 1)
    .reduce((sum, otherSlot) => sum + getMinimumRequiredSlotPrice(otherSlot, modMap, tools.getItemPrice), 0);
  const maxPrice = Number(options.maxPrice) || 0;
  const optionVariants = candidates.flatMap(item => getRouteCapabilityVariants(
    item, modMap, options, tools, route,
  ).map(capabilities => ({ item, capabilities })));
  const hardOptions = optionVariants.filter(({ capabilities }) => {
    const providesRequiredItem = requiredItemIds.size > 0 && capabilities.requiredIds.size > 0;
    const providesSuppressor = options.requireSuppressor === true && capabilities.suppressorKind > 0;
    const isPriceFeasible = maxPrice > 0
      && Number.isFinite(basePrice)
      && Number.isFinite(otherRequiredRootsPrice)
      && Number.isFinite(capabilities.price)
      && basePrice + route.price + otherRequiredRootsPrice + capabilities.price <= maxPrice;
    return providesRequiredItem || providesSuppressor || isPriceFeasible;
  });
  const rankedHardOptions = getTargetRankedRouteOptions(hardOptions, weapon, targets, exactTargets);
  const hardSignatures = new Set(rankedHardOptions.map(option => (
    `${option.item.id};${getCapabilitySignature(option.capabilities)}`
  )));
  const rankedRemainingOptions = getTargetRankedRouteOptions(
    optionVariants.filter(option => !hardSignatures.has(
      `${option.item.id};${getCapabilitySignature(option.capabilities)}`,
    )),
    weapon,
    targets,
    exactTargets,
  );

  const hasHardConstraints = requiredItemIds.size > 0
    || options.requireSuppressor === true
    || maxPrice > 0;
  if (hasHardConstraints) {
    // Distinct installed/conflict signatures can determine whether a later root
    // remains feasible, so they must reach the compatibility-aware frontier.
    return [...rankedHardOptions, ...rankedRemainingOptions];
  }

  // Mandatory providers take precedence over the optimization cap. The remaining
  // capacity stays bounded and is filled by the deterministic target ranking.
  return [
    ...rankedHardOptions,
    ...rankedRemainingOptions.slice(0, Math.max(0, CONSTRAINT_ROUTE_OPTIONS_PER_SLOT - rankedHardOptions.length)),
  ];
}

function getRemainingRequiredRootsPrice(slots, currentIndex, modMap, getItemPrice) {
  return slots
    .slice(currentIndex + 1)
    .reduce((sum, slot) => sum + getMinimumRequiredSlotPrice(slot, modMap, getItemPrice), 0);
}

function getRouteHardKey(route, options) {
  const coverage = [...route.requiredCoverage].sort().join('|');
  const suppressor = options.requireSuppressor === true ? `;s${route.suppressorKind}` : '';
  const installed = [...route.installedIds].sort().join('|');
  const conflicts = [...route.conflictIds].sort().join('|');
  return `${coverage}${suppressor};i${installed};c${conflicts}`;
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
) {
  const hasHardConstraints = (options.requiredItemIds || []).length > 0
    || options.requireSuppressor === true
    || (Number(options.maxPrice) || 0) > 0;
  const rankedRoutes = [...routes].sort((left, right) => (
    compareRoutes(left, right, weapon, targets, exactTargets)
  ));
  if (!hasHardConstraints) return rankedRoutes.slice(0, CONSTRAINT_ROUTE_BEAM_WIDTH);

  const maxPrice = Number(options.maxPrice) || 0;
  const hardFrontier = new Map();
  rankedRoutes.forEach(route => {
    const routePrice = basePrice + route.price + remainingRequiredRootsPrice;
    if (maxPrice > 0 && routePrice > maxPrice) return;
    const hardKey = getRouteHardKey(route, options);
    const current = hardFrontier.get(hardKey);
    if (!current || compareHardRoutes(route, current, remainingRequiredRootsPrice, weapon, targets, exactTargets) < 0) {
      hardFrontier.set(hardKey, route);
    }
  });

  const protectedRoutes = [...hardFrontier.values()].sort((left, right) => (
    compareHardRoutes(left, right, remainingRequiredRootsPrice, weapon, targets, exactTargets)
  ));
  const getRouteStateKey = route => `${getRouteTieKey(route)};${getRouteHardKey(route, options)}`;
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
    ergonomics: 0,
    recoilModifier: 0,
    weight: 0,
    price: 0,
    requiredCoverage: new Set(),
    suppressorKind: 0,
    installedIds: new Set([weapon.id]),
    conflictIds: new Set((weapon.conflictingItems || []).map(conflict => conflict.id)),
  }];
  const slots = weapon.properties?.slots || [];
  const { isSuppressor } = createCompatibilityTools(calculationCache);
  const { getItemPrice, getWeaponPrice } = createPricingTools(calculationCache, options);
  const tools = { getItemPrice, getWeaponPrice, isSuppressor };

  for (const slot of slots) {
    // Required roots are where a greedy early choice can prevent a later required
    // composition. Optional roots retain the target-aware branch scorer below.
    if (slot.required !== true) continue;
    const routeKey = getRootSlotRouteKey(slot, slots);
    if (!routeKey) continue;
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
        slots.indexOf(slot),
      );
      return allowed.map(({ item, capabilities }) => {
        const requiredCoverage = new Set(route.requiredCoverage);
        capabilities.requiredIds.forEach(requiredId => requiredCoverage.add(requiredId));
        const combinedRouteState = getCombinedRouteState(route, capabilities);
        return {
          choices: { ...route.choices, [routeKey]: item.id },
          ergonomics: route.ergonomics + (item.ergonomicsModifier || 0),
          recoilModifier: route.recoilModifier + (item.recoilModifier || 0),
          weight: route.weight + (item.weight || 0),
          price: route.price + capabilities.price,
          requiredCoverage,
          suppressorKind: Math.max(route.suppressorKind, capabilities.suppressorKind),
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
    const candidates = routes.map(route => _calculateWeighted(
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
      { ...targetSearchCapabilities, forcedRootChoices: route.choices },
    ));
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
