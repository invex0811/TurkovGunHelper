import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeItemPriceFields,
  selectPurchasePrice,
  sumPurchasePrices,
} from '../../src/data/price/priceMapper.js';
import {
  PRICE_CONFIDENCE,
  PRICE_MODES,
  PRICE_SOURCE_TYPE,
} from '../../src/data/price/priceModes.js';

function flea(priceRUB, overrides = {}) {
  return {
    ...overrides,
    price: overrides.price ?? priceRUB,
    priceRUB: overrides.priceRUB ?? priceRUB,
    currency: overrides.currency ?? 'RUB',
    vendor: {
      __typename: 'FleaMarket',
      name: 'Flea Market',
      normalizedName: 'flea-market',
      ...overrides.vendor,
    },
  };
}

function trader(priceRUB, overrides = {}) {
  return {
    ...overrides,
    price: overrides.price ?? priceRUB,
    priceRUB: overrides.priceRUB ?? priceRUB,
    currency: overrides.currency ?? 'RUB',
    vendor: {
      __typename: 'TraderOffer',
      name: 'Mechanic',
      normalizedName: 'mechanic',
      minTraderLevel: 3,
      buyLimit: 5,
      taskUnlock: null,
      ...overrides.vendor,
    },
  };
}

function itemWithOffers(...buyFor) {
  return normalizeItemPriceFields({
    id: 'item-1',
    name: 'Test item',
    basePrice: 1,
    buyFor,
  }, PRICE_MODES.PVP);
}

function barter({
  traderName = 'Mechanic',
  traderLevel = 4,
  taskUnlock = null,
  rewardCount = 1,
  requiredItems = [],
} = {}) {
  return {
    id: `barter-${traderName}`,
    level: traderLevel,
    taskUnlock,
    trader: {
      name: traderName,
      normalizedName: traderName.toLowerCase(),
    },
    requiredItems,
    rewardItems: [{ count: rewardCount, item: { id: 'item-1' } }],
  };
}

test('selects a cheaper trader and preserves trader name and loyalty level', () => {
  const item = itemWithOffers(flea(50_000), trader(32_000));
  const price = selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 32_000);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.TRADER);
  assert.equal(price.vendorName, 'Mechanic');
  assert.equal(price.vendorNormalizedName, 'mechanic');
  assert.equal(price.traderLevel, 3);
});

test('selects Flea Market when it is cheaper than a trader', () => {
  const price = selectPurchasePrice(itemWithOffers(flea(25_000), trader(30_000)), {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 25_000);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);
});

test('ignores every trader offer when trader prices are disabled', () => {
  const price = selectPurchasePrice(itemWithOffers(flea(50_000), trader(32_000)), {
    includeTraderPrices: false,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 50_000);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);
});

test('selects the cheapest of multiple trader offers using priceRUB', () => {
  const item = itemWithOffers(
    flea(50_000),
    trader(35_000, { vendor: { name: 'Mechanic', normalizedName: 'mechanic' } }),
    trader(28_000, { vendor: { name: 'Prapor', normalizedName: 'prapor', minTraderLevel: 2 } }),
  );
  const price = selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 28_000);
  assert.equal(price.vendorName, 'Prapor');
  assert.equal(price.traderLevel, 2);
});

test('selects the cheapest Flea offer when more than one is returned', () => {
  const item = itemWithOffers(
    flea(15_000),
    flea(12_000),
    trader(13_000),
  );

  const selected = selectPurchasePrice(item, {
    priceMode: PRICE_MODES.PVP,
    includeTraderPrices: true,
  });

  assert.equal(selected.value, 12_000);
  assert.equal(selected.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);
});

test('compares foreign-currency trader offers by the API priceRUB value', () => {
  const usdOffer = trader(27_990, { price: 200, currency: 'USD' });
  const price = selectPurchasePrice(itemWithOffers(flea(30_000), usdOffer), {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 27_990);
  assert.equal(price.offer.currency, 'USD');
  assert.equal(price.offer.price, 200);
});

test('prefers Flea Market when Flea and trader prices are equal', () => {
  const price = selectPurchasePrice(itemWithOffers(flea(30_000), trader(30_000)), {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);
});

test('uses trader-only price when enabled and returns missing when disabled', () => {
  const item = itemWithOffers(trader(18_000, {
    vendor: { name: 'Prapor', normalizedName: 'prapor', minTraderLevel: 2 },
  }));

  assert.equal(selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  }).value, 18_000);

  const fleaOnly = selectPurchasePrice(item, {
    includeTraderPrices: false,
    priceMode: PRICE_MODES.PVP,
  });
  assert.equal(fleaOnly.value, null);
  assert.equal(fleaOnly.sourceType, PRICE_SOURCE_TYPE.MISSING);
  assert.equal(fleaOnly.confidence, PRICE_CONFIDENCE.MISSING);
});

test('prices a trader-only barter from its required items', () => {
  const item = normalizeItemPriceFields({
    id: 'item-1',
    name: 'Barter-only scope',
    buyFor: [],
    bartersFor: [barter({
      requiredItems: [
        { count: 4, item: { id: 'a', buyFor: [flea(50_000)] } },
        { count: 2, item: { id: 'b', buyFor: [flea(40_000), trader(30_000)] } },
      ],
    })],
  }, PRICE_MODES.PVP);

  const price = selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 260_000);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.TRADER);
  assert.equal(price.vendorName, 'Mechanic');
  assert.equal(price.traderLevel, 4);
  assert.equal(price.field, 'bartersFor');
  assert.equal(price.isBarter, true);
  assert.equal(price.barterOnly, true);
  assert.equal(price.requiredItems.length, 2);

  const fleaOnly = selectPurchasePrice(item, {
    includeTraderPrices: false,
    priceMode: PRICE_MODES.PVP,
  });
  assert.equal(fleaOnly.value, null);
  assert.equal(fleaOnly.barterOnly, false);
});

test('selects the cheapest valid barter and accounts for reward quantity', () => {
  const item = normalizeItemPriceFields({
    id: 'item-1',
    buyFor: [],
    bartersFor: [
      barter({ traderName: 'Skier', requiredItems: [
        { count: 5, item: { id: 'clock', buyFor: [flea(100_000)] } },
      ] }),
      barter({ rewardCount: 2, requiredItems: [
        { count: 3, item: { id: 'filter', buyFor: [flea(120_000)] } },
      ] }),
    ],
  }, PRICE_MODES.PVP);

  const price = selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 180_000);
  assert.equal(price.vendorName, 'Mechanic');
});

test('ignores a barter when any required item has no purchase price', () => {
  const item = normalizeItemPriceFields({
    id: 'item-1',
    buyFor: [],
    bartersFor: [barter({
      requiredItems: [{ count: 1, item: { id: 'missing', buyFor: [] } }],
    })],
  }, PRICE_MODES.PVP);

  const price = selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, null);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.MISSING);
});

test('ignores invalid trader offers', () => {
  const item = itemWithOffers(
    flea(40_000),
    trader(0),
    trader(-1),
    trader(Number.NaN),
    trader(Number.POSITIVE_INFINITY),
    trader(undefined),
  );
  const price = selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.value, 40_000);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.FLEA_MARKET);
});

test('falls back to a loyaltyLevel requirement and preserves quest metadata', () => {
  const offer = trader(20_000, {
    vendor: {
      minTraderLevel: null,
      taskUnlock: { id: 'task-1' },
    },
    requirements: [{ type: 'loyaltyLevel', value: 4 }],
  });
  const price = selectPurchasePrice(itemWithOffers(offer), {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(price.traderLevel, 4);
  assert.equal(price.questRequired, true);
});

test('does not mix normalized PvP offers into a PvE selection', () => {
  const pvpItem = itemWithOffers(flea(10_000), trader(8_000));
  const price = selectPurchasePrice(pvpItem, {
    includeTraderPrices: true,
    priceMode: PRICE_MODES.PVE,
  });

  assert.equal(price.value, null);
  assert.equal(price.sourceType, PRICE_SOURCE_TYPE.MISSING);
});

test('handles old items without buyFor using legacy Flea fields but never basePrice', () => {
  const legacyFlea = normalizeItemPriceFields({
    id: 'legacy-flea',
    avg24hPrice: 12_000,
    basePrice: 1,
  }, PRICE_MODES.PVP);
  assert.equal(selectPurchasePrice(legacyFlea, {
    includeTraderPrices: false,
    priceMode: PRICE_MODES.PVP,
  }).value, 12_000);

  const basePriceOnly = normalizeItemPriceFields({
    id: 'base-only',
    basePrice: 99,
  }, PRICE_MODES.PVP);
  assert.equal(selectPurchasePrice(basePriceOnly, {
    includeTraderPrices: false,
    priceMode: PRICE_MODES.PVP,
  }).value, null);
});

test('sumPurchasePrices returns missing rather than treating an unavailable item as free', () => {
  const priced = itemWithOffers(flea(10_000));
  const missing = normalizeItemPriceFields({ id: 'missing', basePrice: 5 }, PRICE_MODES.PVP);
  const total = sumPurchasePrices([priced, missing], {
    includeTraderPrices: false,
    priceMode: PRICE_MODES.PVP,
  });

  assert.equal(total.value, null);
  assert.equal(total.hasMissingPrice, true);
});

test('normalizeItemPriceFields preserves raw item fields and cached normalized offers', () => {
  const raw = { id: 'preserved', shortName: 'P', buyFor: [flea(10_000), trader(9_000)] };
  const normalized = normalizeItemPriceFields(raw, PRICE_MODES.PVP);

  assert.notEqual(normalized, raw);
  assert.equal(normalized.shortName, 'P');
  assert.equal(normalized.buyFor, raw.buyFor);
  assert.equal(normalized.purchaseOffers.fleaMarket.value, 10_000);
  assert.equal(normalized.purchaseOffers.traderOffers.length, 1);
  assert.equal(normalized.price.value, 9_000);
});
