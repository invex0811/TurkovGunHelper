import {
  DEFAULT_PRICE_MODE,
  PRICE_CONFIDENCE,
  PRICE_CURRENCY,
  PRICE_SOURCE,
} from './priceModes.js';

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getPriceCandidates(item) {
  return [
    {
      field: 'avg24hPrice',
      value: item?.avg24hPrice,
      fallbackUsed: false,
      confidence: PRICE_CONFIDENCE.HIGH,
    },
    {
      field: 'lastLowPrice',
      value: item?.lastLowPrice,
      fallbackUsed: true,
      confidence: PRICE_CONFIDENCE.FALLBACK,
    },
    {
      field: 'low24hPrice',
      value: item?.low24hPrice,
      fallbackUsed: true,
      confidence: PRICE_CONFIDENCE.FALLBACK,
    },
    {
      field: 'basePrice',
      value: item?.basePrice,
      fallbackUsed: true,
      confidence: PRICE_CONFIDENCE.FALLBACK,
    },
  ];
}

export function normalizeItemPrice(item, mode = DEFAULT_PRICE_MODE) {
  const selectedPrice = getPriceCandidates(item).find(candidate => isPositiveNumber(candidate.value));

  if (selectedPrice) {
    return {
      value: selectedPrice.value,
      currency: PRICE_CURRENCY.RUB,
      mode,
      source: PRICE_SOURCE.TARKOV_DEV,
      field: selectedPrice.field,
      fallbackUsed: selectedPrice.fallbackUsed,
      updatedAt: item?.updated ?? null,
      confidence: selectedPrice.confidence,
    };
  }

  return {
    value: 0,
    currency: PRICE_CURRENCY.RUB,
    mode,
    source: PRICE_SOURCE.TARKOV_DEV,
    field: null,
    fallbackUsed: true,
    updatedAt: item?.updated ?? null,
    confidence: PRICE_CONFIDENCE.MISSING,
  };
}

export function normalizeItemPriceFields(item, mode = DEFAULT_PRICE_MODE) {
  if (!item) return item;

  return {
    ...item,
    price: normalizeItemPrice(item, mode),
  };
}