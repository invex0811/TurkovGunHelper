import { PRICE_SOURCE_TYPE } from '../../data/price/priceModes.js';

export function isPositivePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function formatCurrency(value, currency = 'RUB', unavailable = '—') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return unavailable;
  return `${Math.round(value).toLocaleString()} ${currency}`;
}

export function formatPriceSource(priceInfo, t) {
  if (priceInfo?.sourceLabel) return priceInfo.sourceLabel;
  if (priceInfo?.sourceType !== PRICE_SOURCE_TYPE.TRADER) return '';
  const level = isPositivePrice(priceInfo.traderLevel)
    ? t('config.price.traderLevel', { level: priceInfo.traderLevel })
    : t('config.price.traderLevelUnknown');
  return [
    priceInfo.vendorName || t('config.price.trader'),
    level,
    priceInfo.barterOnly ? t('config.price.barterOnly') : priceInfo.isBarter ? t('config.price.barter') : null,
    priceInfo.questRequired ? t('config.price.questRequired') : null,
  ].filter(Boolean).join(' · ');
}
