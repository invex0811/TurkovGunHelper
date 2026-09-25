import { getPurchasePriceValue } from '../data/price/priceMapper.js';

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trimNumber(value, precision) {
  return Number.parseFloat(value.toFixed(precision));
}

function formatSigned(value, precision = 2) {
  const rounded = trimNumber(value, precision);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function getTone(value, higherIsBetter) {
  if (value === 0) return 'neutral';
  return (value > 0) === higherIsBetter ? 'positive' : 'negative';
}

function formatRecoilDiff(percent, weapon) {
  const vertical = toFiniteNumber(weapon?.properties?.recoilVertical) * (percent / 100);
  const horizontal = toFiniteNumber(weapon?.properties?.recoilHorizontal) * (percent / 100);
  const verticalRounded = Math.round(vertical);
  const horizontalRounded = Math.round(horizontal);
  const percentText = `${formatSigned(percent)}%`;

  if (verticalRounded === 0 && horizontalRounded === 0) return `0 (${percentText})`;
  return `${formatSigned(verticalRounded, 0)} / ${formatSigned(horizontalRounded, 0)} (${percentText})`;
}

function sumItems(items, key) {
  return items.reduce((sum, item) => sum + toFiniteNumber(item?.[key]), 0);
}

function sumPrices(items, priceOptions) {
  return items.reduce((sum, item) => {
    if (sum === null) return null;
    const price = getPurchasePriceValue(item, priceOptions, null);
    return Number.isFinite(price) ? sum + price : null;
  }, 0);
}

// Compares a set of modules with the set it replaces (one module, or a whole
// replacement chain with everything attached to it).
export function getPackageComparison({
  items = [],
  currentItems = [],
  weapon,
  priceMode,
  includeTraderPrices,
  traderLevels,
  strictTraderLevels,
  includeRefOffers,
}) {
  const priceOptions = { priceMode, includeTraderPrices, traderLevels, strictTraderLevels, includeRefOffers };
  const ergonomicsDiff = sumItems(items, 'ergonomicsModifier') - sumItems(currentItems, 'ergonomicsModifier');
  const recoilDiff = sumItems(items, 'recoilModifier') - sumItems(currentItems, 'recoilModifier');
  const weightDiff = sumItems(items, 'weight') - sumItems(currentItems, 'weight');
  const itemsPrice = sumPrices(items, priceOptions);
  const currentPrice = sumPrices(currentItems, priceOptions);
  const priceDiff = itemsPrice !== null && currentPrice !== null
    ? itemsPrice - currentPrice
    : null;

  return {
    stats: [
      {
        key: 'ergonomics',
        label: 'Ergo',
        text: formatSigned(ergonomicsDiff),
        tone: getTone(ergonomicsDiff, true),
      },
      {
        key: 'recoil',
        label: 'Recoil',
        text: formatRecoilDiff(recoilDiff, weapon),
        tone: getTone(recoilDiff, false),
      },
      {
        key: 'weight',
        label: 'Weight',
        text: `${formatSigned(weightDiff, 3)} kg`,
        tone: getTone(weightDiff, false),
      },
    ],
    price: itemsPrice,
    priceDiff,
    priceDiffText: priceDiff === null
      ? 'Difference unavailable'
      : `${formatSigned(Math.round(priceDiff), 0)} ₽`,
    priceTone: priceDiff === null ? 'neutral' : getTone(priceDiff, false),
  };
}

export function getSlotOptionComparison({ item, currentItem, ...options }) {
  return getPackageComparison({
    ...options,
    items: item ? [item] : [],
    currentItems: currentItem ? [currentItem] : [],
  });
}
