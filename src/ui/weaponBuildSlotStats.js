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

export function getSlotOptionComparison({
  item,
  currentItem,
  weapon,
  priceMode,
  includeTraderPrices,
}) {
  const ergonomicsDiff = toFiniteNumber(item?.ergonomicsModifier)
    - toFiniteNumber(currentItem?.ergonomicsModifier);
  const recoilDiff = toFiniteNumber(item?.recoilModifier)
    - toFiniteNumber(currentItem?.recoilModifier);
  const weightDiff = toFiniteNumber(item?.weight) - toFiniteNumber(currentItem?.weight);
  const itemPrice = getPurchasePriceValue(
    item,
    { priceMode, includeTraderPrices },
    null,
  );
  const currentPrice = currentItem
    ? getPurchasePriceValue(
      currentItem,
      { priceMode, includeTraderPrices },
      null,
    )
    : 0;
  const priceDiff = Number.isFinite(itemPrice) && Number.isFinite(currentPrice)
    ? itemPrice - currentPrice
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
    priceDiff,
    priceDiffText: priceDiff === null
      ? 'Difference unavailable'
      : `${formatSigned(Math.round(priceDiff), 0)} ₽`,
    priceTone: priceDiff === null ? 'neutral' : getTone(priceDiff, false),
  };
}
