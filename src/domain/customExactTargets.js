import {
  CUSTOM_TARGET_AXIS_KEYS,
  evaluateCustomTargetMatching,
  getNormalizedCustomTargetError,
} from './customTargetMatching.js';

export const CUSTOM_EXACT_TARGET_KEYS = Object.freeze([
  ...CUSTOM_TARGET_AXIS_KEYS,
  'price',
]);

export const DEFAULT_CUSTOM_EXACT_TARGETS = Object.freeze({
  ergonomics: false,
  verticalRecoil: false,
  horizontalRecoil: false,
  weight: false,
  // Persisted legacy settings may contain this key. Price is intentionally never Exact.
  price: false,
});

export function normalizeCustomExactTargets(value, targets = null) {
  const source = value && typeof value === 'object' ? value : {};

  return CUSTOM_EXACT_TARGET_KEYS.reduce((normalized, key) => {
    normalized[key] = key !== 'price'
      && source[key] === true
      && !(key === 'weight' && targets && !(Number(targets.weight) > 0));
    return normalized;
  }, {});
}

export function hasEnabledCustomExactTargets(value) {
  const normalized = normalizeCustomExactTargets(value);
  return CUSTOM_TARGET_AXIS_KEYS.some(key => normalized[key]);
}

// Kept as a compatibility export for callers from the earlier tolerance-based UI.
export function getCustomExactTolerance() { return 0; }

export function getNormalizedCustomExactDeviation(actual, target) {
  return getNormalizedCustomTargetError(Number(actual), Number(target));
}

export function evaluateCustomExactTargets(stats, targets, enabledTargets) {
  const matching = evaluateCustomTargetMatching(
    stats,
    targets,
    normalizeCustomExactTargets(enabledTargets, targets),
  );
  return {
    totalError: matching.totalDistance,
    failures: matching.exactFailures,
    matches: matching.exactMatches && Number.isFinite(matching.totalDistance),
  };
}
