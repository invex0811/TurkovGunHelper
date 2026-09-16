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
import {
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
} from '../customPriorityAttributes.js';

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
    // This remains a greedy slot-tree search, but each branch is now ranked by its
    // improvement toward the target vector instead of by a fixed ergo/recoil sweep.
    const candidates = [_calculateWeighted(
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
      targetSearchCapabilities,
    )];
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
      const isBetter = current => !current
        || candidate.targetMatching.totalDistance < current.targetMatching.totalDistance
        || (
          candidate.targetMatching.totalDistance === current.targetMatching.totalDistance
          && (
            (candidate.result.stats.price ?? Number.POSITIVE_INFINITY)
              < (current.result.stats.price ?? Number.POSITIVE_INFINITY)
            || (
              candidate.result.stats.price === current.result.stats.price
              && candidate.tieKey.localeCompare(current.tieKey) < 0
            )
          )
        );
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
