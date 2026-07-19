export const CUSTOM_EXACT_TARGET_KEYS = Object.freeze([
  'ergonomics',
  'verticalRecoil',
  'horizontalRecoil',
  'weight',
  'price',
]);

export const DEFAULT_CUSTOM_EXACT_TARGETS = Object.freeze({
  ergonomics: false,
  verticalRecoil: false,
  horizontalRecoil: false,
  weight: false,
  price: false,
});

const FIXED_TOLERANCES = Object.freeze({
  ergonomics: 1,
  verticalRecoil: 1,
  horizontalRecoil: 2,
  weight: 0.05,
});

export function normalizeCustomExactTargets(value) {
  const source = value && typeof value === 'object' ? value : {};

  return CUSTOM_EXACT_TARGET_KEYS.reduce((normalized, key) => {
    normalized[key] = source[key] === true;
    return normalized;
  }, {});
}

export function hasEnabledCustomExactTargets(value) {
  const normalized = normalizeCustomExactTargets(value);
  return CUSTOM_EXACT_TARGET_KEYS.some(key => normalized[key]);
}

export function getCustomExactTolerance(key, target) {
  if (key === 'price') {
    const numericTarget = Number(target);
    return Number.isFinite(numericTarget)
      ? Math.max(1000, Math.abs(numericTarget) * 0.01)
      : Number.NaN;
  }

  return FIXED_TOLERANCES[key] ?? Number.NaN;
}

export function getNormalizedCustomExactDeviation(actual, target, tolerance) {
  if (actual == null || actual === '' || target == null || target === '') {
    return Number.POSITIVE_INFINITY;
  }

  const numericActual = Number(actual);
  const numericTarget = Number(target);
  const numericTolerance = Number(tolerance);

  if (
    !Number.isFinite(numericActual)
    || !Number.isFinite(numericTarget)
    || !Number.isFinite(numericTolerance)
    || numericTolerance <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(numericActual - numericTarget) / numericTolerance;
}

export function evaluateCustomExactTargets(stats, targets, enabledTargets) {
  const normalized = normalizeCustomExactTargets(enabledTargets);
  const failures = [];
  let totalError = 0;

  for (const key of CUSTOM_EXACT_TARGET_KEYS) {
    if (!normalized[key]) continue;

    const target = Number(targets?.[key]);
    const actual = Number(stats?.[key]);
    const tolerance = getCustomExactTolerance(key, target);
    const normalizedDeviation = getNormalizedCustomExactDeviation(actual, target, tolerance);
    totalError += normalizedDeviation;

    if (normalizedDeviation > 1 + Number.EPSILON * 16) {
      failures.push({
        key,
        target,
        actual,
        tolerance,
        normalizedDeviation,
      });
    }
  }

  return {
    totalError,
    failures,
    matches: failures.length === 0 && Number.isFinite(totalError),
  };
}
