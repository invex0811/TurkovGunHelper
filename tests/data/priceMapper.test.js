import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  normalizeItemPrice,
  normalizeItemPriceFields,
} from '../../src/data/price/priceMapper.js';
import {
  DEFAULT_PRICE_MODE,
  PRICE_CONFIDENCE,
  PRICE_CURRENCY,
  PRICE_MODES,
  PRICE_SOURCE,
} from '../../src/data/price/priceModes.js';

const priceModeFixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/priceModes.json', import.meta.url), 'utf8'));
const { rawItems } = priceModeFixtures;

test('normalizeItemPrice uses avg24hPrice as high-confidence default PvP price', () => {
  const price = normalizeItemPrice(rawItems.primaryPrice);

  assert.deepEqual(price, {
    value: rawItems.primaryPrice.avg24hPrice,
    currency: PRICE_CURRENCY.RUB,
    mode: DEFAULT_PRICE_MODE,
    source: PRICE_SOURCE.TARKOV_DEV,
    field: 'avg24hPrice',
    fallbackUsed: false,
    updatedAt: rawItems.primaryPrice.updated,
    confidence: PRICE_CONFIDENCE.HIGH,
  });
});

test('normalizeItemPrice keeps the selected PvE mode in normalized metadata', () => {
  const price = normalizeItemPrice(rawItems.primaryPrice, PRICE_MODES.PVE);

  assert.equal(price.value, rawItems.primaryPrice.avg24hPrice);
  assert.equal(price.currency, PRICE_CURRENCY.RUB);
  assert.equal(price.mode, PRICE_MODES.PVE);
  assert.equal(price.source, PRICE_SOURCE.TARKOV_DEV);
  assert.equal(price.field, 'avg24hPrice');
  assert.equal(price.fallbackUsed, false);
  assert.equal(price.confidence, PRICE_CONFIDENCE.HIGH);
});

test('normalizeItemPrice uses lastLowPrice as the first fallback', () => {
  const price = normalizeItemPrice(rawItems.lastLowFallback, PRICE_MODES.PVP);

  assert.equal(price.value, rawItems.lastLowFallback.lastLowPrice);
  assert.equal(price.field, 'lastLowPrice');
  assert.equal(price.fallbackUsed, true);
  assert.equal(price.confidence, PRICE_CONFIDENCE.FALLBACK);
});

test('normalizeItemPrice uses low24hPrice when avg24hPrice and lastLowPrice are unavailable', () => {
  const price = normalizeItemPrice(rawItems.low24hFallback, PRICE_MODES.PVP);

  assert.equal(price.value, rawItems.low24hFallback.low24hPrice);
  assert.equal(price.field, 'low24hPrice');
  assert.equal(price.fallbackUsed, true);
  assert.equal(price.confidence, PRICE_CONFIDENCE.FALLBACK);
});

test('normalizeItemPrice uses basePrice as the last fallback', () => {
  const price = normalizeItemPrice(rawItems.basePriceFallback, PRICE_MODES.PVP);

  assert.equal(price.value, rawItems.basePriceFallback.basePrice);
  assert.equal(price.field, 'basePrice');
  assert.equal(price.fallbackUsed, true);
  assert.equal(price.confidence, PRICE_CONFIDENCE.FALLBACK);
});

test('normalizeItemPrice marks missing price when all candidate fields are invalid', () => {
  const price = normalizeItemPrice(rawItems.missingPrice, PRICE_MODES.PVP);

  assert.deepEqual(price, {
    value: 0,
    currency: PRICE_CURRENCY.RUB,
    mode: PRICE_MODES.PVP,
    source: PRICE_SOURCE.TARKOV_DEV,
    field: null,
    fallbackUsed: true,
    updatedAt: rawItems.missingPrice.updated,
    confidence: PRICE_CONFIDENCE.MISSING,
  });
});

test('normalizeItemPrice ignores zero, negative and non-finite price values', () => {
  const price = normalizeItemPrice({
    id: 'invalid-price-values',
    avg24hPrice: Number.NaN,
    lastLowPrice: Number.POSITIVE_INFINITY,
    low24hPrice: -1,
    basePrice: 0,
    updated: null,
  });

  assert.equal(price.value, 0);
  assert.equal(price.field, null);
  assert.equal(price.fallbackUsed, true);
  assert.equal(price.confidence, PRICE_CONFIDENCE.MISSING);
});

test('normalizeItemPriceFields preserves item fields and adds normalized price', () => {
  const normalizedItem = normalizeItemPriceFields(rawItems.primaryPrice, PRICE_MODES.PVE);

  assert.notEqual(normalizedItem, rawItems.primaryPrice);
  assert.equal(normalizedItem.id, rawItems.primaryPrice.id);
  assert.equal(normalizedItem.shortName, rawItems.primaryPrice.shortName);
  assert.equal(normalizedItem.avg24hPrice, rawItems.primaryPrice.avg24hPrice);
  assert.equal(normalizedItem.price.value, rawItems.primaryPrice.avg24hPrice);
  assert.equal(normalizedItem.price.mode, PRICE_MODES.PVE);
});

test('normalizeItemPriceFields returns nullish item values unchanged', () => {
  assert.equal(normalizeItemPriceFields(null), null);
  assert.equal(normalizeItemPriceFields(undefined), undefined);
});