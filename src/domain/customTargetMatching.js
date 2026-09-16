export const CUSTOM_TARGET_AXIS_KEYS = Object.freeze([
  'ergonomics',
  'verticalRecoil',
  'horizontalRecoil',
  'weight',
]);

const AXIS_DEFINITIONS = Object.freeze({
  ergonomics: Object.freeze({ precision: 0, minimumScale: 1 }),
  verticalRecoil: Object.freeze({ precision: 0, minimumScale: 1 }),
  horizontalRecoil: Object.freeze({ precision: 0, minimumScale: 1 }),
  weight: Object.freeze({ precision: 2, minimumScale: 0.01 }),
});

function toFiniteNumber(value) {
  if (value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeCustomTargetAxisValue(key, value) {
  const numeric = toFiniteNumber(value);
  const definition = AXIS_DEFINITIONS[key];
  if (numeric === null || !definition) return null;

  if (definition.precision === 0) return Math.round(numeric);
  return Number(numeric.toFixed(definition.precision));
}

export function normalizeCustomTargetValues(values = {}) {
  return Object.fromEntries(CUSTOM_TARGET_AXIS_KEYS.map(key => [
    key,
    normalizeCustomTargetAxisValue(
      key,
      key === 'verticalRecoil' ? values?.verticalRecoil ?? values?.recoilVertical
        : key === 'horizontalRecoil' ? values?.horizontalRecoil ?? values?.recoilHorizontal
          : values?.[key],
    ),
  ]));
}

export function getNormalizedCustomTargetError(actual, target, minimumScale = 1) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return Math.abs(actual - target) / Math.max(Math.abs(target), minimumScale);
}

export function evaluateCustomTargetMatching(actualValues, targetValues, exactTargets = {}) {
  const actual = normalizeCustomTargetValues(actualValues);
  const targets = normalizeCustomTargetValues(targetValues);
  const axes = {};
  const exactFailures = [];
  let totalDistance = 0;

  for (const key of CUSTOM_TARGET_AXIS_KEYS) {
    const definition = AXIS_DEFINITIONS[key];
    const target = targets[key];
    const active = key !== 'weight' || target > 0;
    const exact = active && exactTargets?.[key] === true;
    const axisActual = actual[key];
    const delta = axisActual === null || target === null ? null : axisActual - target;
    const normalizedError = active
      ? getNormalizedCustomTargetError(axisActual, target, definition.minimumScale)
      : 0;
    const exactMatch = !exact || delta === 0;
    const distance = exact ? (exactMatch ? 0 : normalizedError) : normalizedError;
    const axis = {
      key,
      active,
      exact,
      exactMatch,
      actual: axisActual,
      target,
      delta,
      normalizedError,
      distance,
    };
    axes[key] = axis;

    if (active) totalDistance += distance;
    if (exact && !exactMatch) exactFailures.push(axis);
  }

  return {
    axes,
    exactFailures,
    exactMatches: exactFailures.length === 0,
    totalDistance,
  };
}

export function getCustomTargetMatchingDiagnostics(result, targetValues, exactTargets) {
  return evaluateCustomTargetMatching(result?.stats, targetValues, exactTargets);
}
