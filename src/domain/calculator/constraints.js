export function getRootSlotRouteKey(slot, rootSlots = []) {
  const baseKey = slot?.nameId || slot?.id || slot?.name || 'root-slot';
  const ordinal = Math.max(0, rootSlots.indexOf(slot));
  return `${baseKey}#${ordinal}`;
}

export function getCustomRequirementMatches(
  result,
  {
    maxHorizontalRecoil,
    maxPrice,
    maxRecoil,
    maxWeight,
    minErgo,
  },
) {
  const ergonomics = result.stats.ergonomics;
  const verticalRecoil = result.stats.recoilVertical;
  const horizontalRecoil = result.stats.recoilHorizontal;
  const weight = parseFloat(result.stats.weight);
  const price = result.stats.price;

  return {
    ergonomics,
    verticalRecoil,
    horizontalRecoil,
    weight,
    price,
    ergoMet: ergonomics >= minErgo,
    recoilMet: verticalRecoil <= maxRecoil,
    horizontalRecoilMet: horizontalRecoil <= maxHorizontalRecoil,
    weightMet: !(maxWeight > 0) || weight <= maxWeight,
    priceMet: !(maxPrice > 0) || (price != null && price <= maxPrice),
  };
}

export function meetsNonExactRequirements(matches, normalizedExactTargets) {
  return (
    (normalizedExactTargets.ergonomics || matches.ergoMet)
    && (normalizedExactTargets.verticalRecoil || matches.recoilMet)
    && (normalizedExactTargets.horizontalRecoil || matches.horizontalRecoilMet)
    && (normalizedExactTargets.weight || matches.weightMet)
    && (normalizedExactTargets.price || matches.priceMet)
  );
}
