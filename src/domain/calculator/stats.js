import { getPurchasePriceValue } from '../../data/price/priceMapper.js';

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
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Number.isFinite(totalPrice) ? Math.round(totalPrice) : null,
    }
  };
}
