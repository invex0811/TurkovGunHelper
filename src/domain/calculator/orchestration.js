import {
  evaluateCustomExactTargets,
  getCustomExactTolerance,
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
import {
  getCustomRequirementMatches,
  meetsNonExactRequirements,
} from './constraints.js';
import { generatePriorityCandidates } from './priorityCandidates.js';
import { selectCustomPriorityCandidate } from './prioritySelection.js';
import {
  getBuildTieKey,
  getCustomScore,
  getMetaResultScore,
  getPriceAwareResultScore,
} from './scoring.js';
import {
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
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
  const normalizedCharacteristicMode = normalizeCustomCharacteristicMode(characteristicMode);
  const isPriorityMode = normalizedCharacteristicMode === 'priorities';
  const normalizedPriorityAttributes = normalizePriorityAttributes(priorityAttributes);
  const hasCustomProfile = Boolean(customProfile && typeof customProfile === 'object');
  const normalizedExactTargets = normalizeCustomExactTargets(customExactTargets);
  const hasExactTargets = !isPriorityMode
    && hasCustomProfile
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
    : Number(options.maxPrice) || 0;
  const customOptions = isPriorityMode
    ? {
        ...options,
        maxWeight: 0,
      }
    : hasCustomProfile
      ? {
        ...options,
        maxWeight: Number.isFinite(exactMaxWeight) ? exactMaxWeight : 0,
        maxPrice: Number.isFinite(exactMaxPrice) ? exactMaxPrice : 0,
      }
    : options;

  const requirementOptions = {
    maxHorizontalRecoil,
    maxPrice: customOptions.maxPrice,
    maxRecoil,
    maxWeight: customOptions.maxWeight,
    minErgo,
  };

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

  function considerExactCandidate(result, matches) {
    if (!meetsNonExactRequirements(matches, normalizedExactTargets)) return;

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

  if (hasCustomProfile && !isPriorityMode) {
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
      const matches = getCustomRequirementMatches(metaCandidate, requirementOptions);
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

  if (isPriorityMode) {
    const priorityCandidates = generatePriorityCandidates({
      weapon,
      modMap,
      options: customOptions,
      calculationCache,
    });
    firstCalculationError ||= priorityCandidates.firstCalculationError;
    successfulCalculationCount += priorityCandidates.successfulCalculationCount;

    const selectedPriorityCandidate = selectCustomPriorityCandidate(
      priorityCandidates.candidates,
      normalizedPriorityAttributes,
    );
    if (selectedPriorityCandidate) return selectedPriorityCandidate.result;
  } else for (let i = 0; i <= 20; i++) {
    const ergoWeight = i / 20;
    const recoilWeight = 1 - ergoWeight;
    const priceWeight = 0;
    const result = _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, customOptions, 100, 'custom', 0.001, 0, 100, calculationCache);
    if (result.error) {
      firstCalculationError ||= result;
      continue;
    }
    successfulCalculationCount += 1;

    const matches = getCustomRequirementMatches(result, requirementOptions);
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

  if (isPriorityMode && !bestBuild) {
    if (successfulCalculationCount === 0 && firstCalculationError) return firstCalculationError;
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
          recoilModifier: 0,
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
        recoilModifier: 0,
        recoilVertical: weapon.properties?.recoilVertical ?? 0,
        recoilHorizontal: weapon.properties?.recoilHorizontal ?? 0,
        weight: Number(weapon.weight || 0).toFixed(2),
        price: null,
      },
      error: `No available build satisfies all Custom requirements (${constraints.join(', ')}). Relax one or more radar axes and try again.`,
    };
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
