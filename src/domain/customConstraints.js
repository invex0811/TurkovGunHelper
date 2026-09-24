export const CUSTOM_CONSTRAINT_AXIS_KEYS = Object.freeze([
  'ergonomics', 'verticalRecoil', 'horizontalRecoil', 'weight',
]);

// Absorbs floating-point noise from summed part weights (2.8 + 0.2).
const VIOLATION_EPSILON = 1e-9;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function axisValue(values, key) {
  return finiteNumber(key === 'verticalRecoil' ? values?.verticalRecoil ?? values?.recoilVertical
    : key === 'horizontalRecoil' ? values?.horizontalRecoil ?? values?.recoilHorizontal
      : values?.[key]);
}

// Soft directional limits: weight and recoil are desired maximums, ergonomics a
// desired minimum. Values on the allowed side score 0 however far they are
// from the limit; violations are normalized by the limit so axes compare.
export function evaluateCustomConstraints(actualValues, limits) {
  const axes = {};
  const failures = [];
  let totalViolation = 0;
  for (const key of CUSTOM_CONSTRAINT_AXIS_KEYS) {
    const actual = axisValue(actualValues, key);
    const limit = axisValue(limits, key);
    const direction = key === 'ergonomics' ? 'minimum' : 'maximum';
    const active = limit !== null && (key !== 'weight' || limit > 0);
    const rawViolation = !active ? 0 : actual === null ? Infinity
      : Math.max(0, direction === 'minimum' ? limit - actual : actual - limit);
    const violation = rawViolation <= VIOLATION_EPSILON ? 0 : rawViolation;
    const normalizedViolation = active ? violation / Math.max(Math.abs(limit), key === 'weight' ? 0.01 : 1) : 0;
    const axis = { key, active, actual, limit, direction, satisfied: violation === 0, violation, normalizedViolation };
    axes[key] = axis;
    totalViolation += normalizedViolation;
    if (!axis.satisfied) failures.push(axis);
  }
  return { axes, failures, satisfied: failures.length === 0, totalViolation };
}
