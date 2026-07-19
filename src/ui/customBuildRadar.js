import { WEAPON_STAT_UI_RANGES, withBaseStatMaximum } from './weaponStatMeters.js';

export const CUSTOM_BUILD_DEFAULT_PROFILE = Object.freeze({
  ergonomics: 50,
  verticalRecoil: 50,
  horizontalRecoil: 50,
  weight: 0,
  price: 0,
});

const AXIS_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'weight', label: 'Weight', unit: 'kg', step: 0.05, allowNoLimit: true }),
  Object.freeze({ key: 'verticalRecoil', label: 'Vertical recoil', unit: '', step: 1 }),
  Object.freeze({ key: 'horizontalRecoil', label: 'Horizontal recoil', unit: '', step: 1 }),
  Object.freeze({ key: 'price', label: 'Price', unit: 'RUB', step: 1_000, allowNoLimit: true }),
  Object.freeze({ key: 'ergonomics', label: 'Ergonomics', unit: '', step: 1 }),
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
}

function snap(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const precision = Math.max(0, (String(step).split('.')[1] || '').length);
  return Number((Math.round(value / step) * step).toFixed(precision));
}

export function getRadarAxisVectors(count = 5, startAngleDegrees = -90) {
  if (!Number.isInteger(count) || count < 1) return [];

  return Array.from({ length: count }, (_, index) => {
    const angle = (startAngleDegrees + ((360 / count) * index)) * (Math.PI / 180);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
}

export function projectPointerToAxis({
  pointerX,
  pointerY,
  centerX,
  centerY,
  axisX,
  axisY,
  radius,
}) {
  const values = [pointerX, pointerY, centerX, centerY, axisX, axisY, radius];
  if (values.some(value => !Number.isFinite(value)) || radius <= 0) return 0;

  const projection = (((pointerX - centerX) * axisX) + ((pointerY - centerY) * axisY)) / radius;
  return clamp(projection, 0, 1);
}

export function getRadarPoint(centerX, centerY, radius, axis, requirement = 1) {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const safeRequirement = Number.isFinite(requirement) ? clamp(requirement, 0, 1) : 0;
  return {
    x: centerX + ((Number.isFinite(axis?.x) ? axis.x : 0) * safeRadius * safeRequirement),
    y: centerY + ((Number.isFinite(axis?.y) ? axis.y : 0) * safeRadius * safeRequirement),
  };
}

export function getCustomBuildRadarAxes(weapon) {
  const ranges = {
    weight: WEAPON_STAT_UI_RANGES.weight,
    ergonomics: WEAPON_STAT_UI_RANGES.ergonomics,
    price: WEAPON_STAT_UI_RANGES.price,
    verticalRecoil: withBaseStatMaximum(
      WEAPON_STAT_UI_RANGES.verticalRecoil,
      weapon?.properties?.recoilVertical,
    ),
    horizontalRecoil: withBaseStatMaximum(
      WEAPON_STAT_UI_RANGES.horizontalRecoil,
      weapon?.properties?.recoilHorizontal,
    ),
  };
  const vectors = getRadarAxisVectors(AXIS_DEFINITIONS.length);

  return AXIS_DEFINITIONS.map((definition, index) => ({
    ...definition,
    range: ranges[definition.key],
    vector: vectors[index],
  }));
}

export function requirementToValue(requirement, axis) {
  const t = clamp(toFiniteNumber(requirement, 0), 0, 1);
  const { min, max } = axis.range;
  const rawValue = min + (t * (max - min));
  return clamp(snap(rawValue, axis.step), min, max);
}

export function valueToRequirement(value, axis) {
  const { min, max } = axis.range;
  const numericValue = toFiniteNumber(value, min);
  const clampedValue = clamp(numericValue, min, max);
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return 0;

  return clamp((clampedValue - min) / span, 0, 1);
}

export function normalizeCustomBuildProfile(profile = {}, weapon) {
  const axes = getCustomBuildRadarAxes(weapon);
  const source = profile && typeof profile === 'object' ? profile : {};

  return Object.fromEntries(axes.map(axis => {
    const fallback = CUSTOM_BUILD_DEFAULT_PROFILE[axis.key];
    const rawValue = toFiniteNumber(source[axis.key], fallback);
    if (axis.allowNoLimit && rawValue <= 0) return [axis.key, 0];
    return [axis.key, requirementToValue(valueToRequirement(rawValue, axis), axis)];
  }));
}

export function createCustomBuildProfileFromSettings(settings = {}, weapon) {
  const source = settings?.customProfile && typeof settings.customProfile === 'object'
    ? settings.customProfile
    : {
        ergonomics: settings?.customErgonomics ?? settings?.customErgo,
        verticalRecoil: settings?.customVerticalRecoil ?? settings?.customRecoil,
        horizontalRecoil: settings?.customHorizontalRecoil ?? settings?.customRecoil,
        weight: settings?.customMaxWeight ?? settings?.maxWeight,
        price: settings?.customMaxPrice ?? settings?.maxPrice,
      };

  return normalizeCustomBuildProfile(source, weapon);
}

export function updateCustomBuildProfile(profile, axis, requirement, weapon) {
  const resolvedAxis = axis?.range
    ? axis
    : getCustomBuildRadarAxes(weapon).find(candidate => candidate.key === axis);
  if (!resolvedAxis) return normalizeCustomBuildProfile(profile, weapon);

  return {
    ...normalizeCustomBuildProfile(profile, weapon),
    [resolvedAxis.key]: requirementToValue(requirement, resolvedAxis),
  };
}

export function updateCustomBuildProfileValue(profile, axis, value, weapon) {
  const resolvedAxis = axis?.range
    ? axis
    : getCustomBuildRadarAxes(weapon).find(candidate => candidate.key === axis);
  const normalizedProfile = normalizeCustomBuildProfile(profile, weapon);
  if (!resolvedAxis) return normalizedProfile;

  const numericValue = toFiniteNumber(value, normalizedProfile[resolvedAxis.key]);

  return {
    ...normalizedProfile,
    [resolvedAxis.key]: requirementToValue(
      valueToRequirement(numericValue, resolvedAxis),
      resolvedAxis,
    ),
  };
}

export function formatCustomBuildRadarValue(value, axis) {
  if (!Number.isFinite(value)) return 'N/A';

  if (axis.key === 'weight') return `${value.toFixed(2)} kg`;
  if (axis.key === 'price') return `${Math.round(value).toLocaleString('en-US')} RUB`;
  return String(Math.round(value));
}
