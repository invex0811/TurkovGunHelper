import { getPurchasePriceValue } from '../../data/price/priceMapper.js';

const DEFAULT_BARREL_DEVIATION_MAX = 100;
const FULL_DURABILITY = 100;
const MOA_CONVERSION_FACTOR = 2.9089;

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getBarrelDeviation(deviationCurve, barrelDeviationMax) {
  const doubledCurve = 2 * deviationCurve;
  const denominator = 100 - doubledCurve;
  const durabilityFactor = denominator === 0
    ? FULL_DURABILITY / doubledCurve
    : (
      -deviationCurve
      + Math.sqrt((-doubledCurve + 100) * FULL_DURABILITY + deviationCurve)
    ) / denominator;
  const inverseDurabilityFactor = 1 - durabilityFactor;

  return (
    inverseDurabilityFactor * inverseDurabilityFactor * barrelDeviationMax
    + 2 * durabilityFactor * inverseDurabilityFactor * deviationCurve
    + durabilityFactor * durabilityFactor
  );
}

export function calculateAccuracyMoa(weapon, buildParts = []) {
  const baseCenterOfImpact = toFiniteNumber(weapon?.properties?.centerOfImpact);
  const deviationCurve = toFiniteNumber(weapon?.properties?.deviationCurve);
  if (baseCenterOfImpact === null || deviationCurve === null) return null;

  let centerOfImpact = baseCenterOfImpact;
  // tarkov-data-manager starts at 100 and lets an installed barrel/part override it.
  let barrelDeviationMax = DEFAULT_BARREL_DEVIATION_MAX;

  for (const part of Array.isArray(buildParts) ? buildParts : []) {
    const partCenterOfImpact = toFiniteNumber(part?.item?.properties?.centerOfImpact);
    if (partCenterOfImpact !== null) centerOfImpact += partCenterOfImpact;

    const partDeviationMax = toFiniteNumber(part?.item?.properties?.deviationMax);
    if (partDeviationMax !== null && partDeviationMax !== 0) {
      barrelDeviationMax = partDeviationMax;
    }
  }

  const barrelDeviation = getBarrelDeviation(deviationCurve, barrelDeviationMax);
  const accuracyMoa = centerOfImpact * barrelDeviation * 100 / MOA_CONVERSION_FACTOR;
  if (!Number.isFinite(accuracyMoa) || accuracyMoa < 0) return null;

  return Math.round(accuracyMoa * 100) / 100;
}

// The weapon aims as far as its best installed sight allows (EFT shows the
// largest sighting range among the weapon and its sights).
export function calculateSightingRange(weapon, buildParts = []) {
  const ranges = [
    weapon?.properties?.sightingRange,
    ...(Array.isArray(buildParts) ? buildParts : []).map(part => part?.item?.properties?.sightingRange),
  ]
    .map(toFiniteNumber)
    .filter(range => range !== null && range > 0);
  return ranges.length > 0 ? Math.max(...ranges) : null;
}

export function recalculateBuildStats(weapon, buildParts, options = {}) {
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;

  function getItemPrice(item) {
    return getPurchasePriceValue(item, options, Number.POSITIVE_INFINITY);
  }

  let totalPrice = getItemPrice(weapon);

  buildParts.forEach(part => {
    totalErgo += part.item.ergonomicsModifier || 0;
    totalRecoilMod += part.item.recoilModifier || 0;
    totalWeight += part.item.weight || 0;
    totalPrice += getItemPrice(part.item);
  });

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  return {
    build: buildParts,
    stats: {
      ergonomics: Math.min(100, Math.max(0, Math.round(totalErgo))),
      recoilModifier: totalRecoilMod,
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Number.isFinite(totalPrice) ? Math.round(totalPrice) : null,
      accuracyMoa: calculateAccuracyMoa(weapon, buildParts),
      sightingRange: calculateSightingRange(weapon, buildParts),
    }
  };
}
