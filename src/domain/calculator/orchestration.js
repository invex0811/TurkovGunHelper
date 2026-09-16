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
import {
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
} from '../customPriorityAttributes.js';

const CONSTRAINT_ROUTE_BEAM_WIDTH = 24;
const CONSTRAINT_ROUTE_OPTIONS_PER_SLOT = 8;

function getRoutePrice(item) {
  const price = Number(item?.price?.value ?? item?.avg24hPrice ?? item?.basePrice);
  return Number.isFinite(price) ? price : Number.MAX_SAFE_INTEGER;
}

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

export function createConstraintSearchRoutes(weapon, modMap, targets, exactTargets) {
  let routes = [{
    choices: {}, ergonomics: 0, recoilModifier: 0, weight: 0, price: 0,
  }];
  const slots = weapon.properties?.slots || [];

  for (const slot of slots) {
    // Required roots are where a greedy early choice can prevent a later required
    // composition. Optional roots retain the target-aware branch scorer below.
    if (slot.required !== true) continue;
    const routeKey = getRootSlotRouteKey(slot, slots);
    if (!routeKey) continue;
    const allowed = (slot.filters?.allowedItems || [])
      .map(allowedItem => modMap[allowedItem.id])
      .filter(Boolean)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .slice(0, CONSTRAINT_ROUTE_OPTIONS_PER_SLOT);
    if (allowed.length === 0) continue;

    const choices = slot.required === true ? allowed : [null, ...allowed];
    routes = routes.flatMap(route => choices.map(item => ({
      choices: { ...route.choices, [routeKey]: item?.id ?? null },
      ergonomics: route.ergonomics + (item?.ergonomicsModifier || 0),
      recoilModifier: route.recoilModifier + (item?.recoilModifier || 0),
      weight: route.weight + (item?.weight || 0),
      price: route.price + (item ? getRoutePrice(item) : 0),
    })));
    routes.sort((left, right) => compareRoutes(left, right, weapon, targets, exactTargets));
    routes = routes.slice(0, CONSTRAINT_ROUTE_BEAM_WIDTH);
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
        error: 'No available build matches all enabled Exact targets. Disable Exact for one or more axes to use the closest achievable build.',
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
