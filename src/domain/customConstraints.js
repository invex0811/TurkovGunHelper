export const CUSTOM_CONSTRAINT_AXIS_KEYS = Object.freeze([
  'ergonomics', 'verticalRecoil', 'horizontalRecoil', 'weight',
]);

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

export function evaluateCustomConstraints(actualValues, limits) {
  const axes = {};
  const failures = [];
  let totalViolation = 0;
  for (const key of CUSTOM_CONSTRAINT_AXIS_KEYS) {
    const actual = axisValue(actualValues, key);
    const limit = axisValue(limits, key);
    const direction = key === 'ergonomics' ? 'minimum' : 'maximum';
    const active = limit !== null && (key !== 'weight' || limit > 0);
    const violation = !active ? 0 : actual === null ? Infinity
      : Math.max(0, direction === 'minimum' ? limit - actual : actual - limit);
    const normalizedViolation = active ? violation / Math.max(Math.abs(limit), key === 'weight' ? 0.01 : 1) : 0;
    const axis = { key, active, actual, limit, direction, satisfied: violation === 0, violation, normalizedViolation };
    axes[key] = axis;
    totalViolation += normalizedViolation;
    if (!axis.satisfied) failures.push(axis);
  }
  return { axes, failures, satisfied: failures.length === 0, totalViolation };
}
