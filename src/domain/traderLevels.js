export function getEffectiveTraderLevel(traderId, traderLevels, priceMode) {
  if (!traderId) return 1;
  const value = traderLevels?.[traderId] ?? traderLevels?.profiles?.[priceMode]?.[traderId];
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : 1;
}
