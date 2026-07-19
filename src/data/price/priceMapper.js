import {
  DEFAULT_PRICE_MODE,
  PRICE_CONFIDENCE,
  PRICE_CURRENCY,
  PRICE_SOURCE,
  PRICE_SOURCE_TYPE,
} from './priceModes.js';

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getLegacyFleaCandidates(item) {
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
  ];
}

function getRequirementValue(requirements, type) {
  const requirement = (requirements || []).find(entry => entry?.type === type);
  const value = Number(requirement?.value ?? requirement?.stringValue);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isFleaVendor(vendor) {
  return vendor?.__typename === 'FleaMarket'
    || vendor?.normalizedName === 'flea-market'
    || vendor?.name === 'Flea Market';
}

function normalizeBuyOffer(offer) {
  if (!isPositiveNumber(offer?.priceRUB) || !offer?.vendor) return null;

  const sourceType = isFleaVendor(offer.vendor)
    ? PRICE_SOURCE_TYPE.FLEA_MARKET
    : PRICE_SOURCE_TYPE.TRADER;
  const traderLevel = sourceType === PRICE_SOURCE_TYPE.TRADER
    ? (isPositiveNumber(offer.vendor.minTraderLevel)
      ? offer.vendor.minTraderLevel
      : getRequirementValue(offer.requirements || offer.vendor.requirements, 'loyaltyLevel'))
    : null;
  const questRequired = sourceType === PRICE_SOURCE_TYPE.TRADER
    ? Boolean(
      offer.vendor.taskUnlock
      || (offer.requirements || offer.vendor.requirements || []).some(requirement => (
        requirement?.type === 'quest' || requirement?.type === 'task'
      )),
    )
    : false;

  return {
    value: offer.priceRUB,
    currency: PRICE_CURRENCY.RUB,
    sourceType,
    vendorName: offer.vendor.name ?? null,
    vendorNormalizedName: offer.vendor.normalizedName ?? null,
    traderLevel,
    questRequired,
    originalCurrency: offer.currency ?? null,
    originalPrice: isPositiveNumber(offer.price) ? offer.price : null,
    offer,
  };
}

function createLegacyFleaOffer(item) {
  const selectedPrice = getLegacyFleaCandidates(item)
    .find(candidate => isPositiveNumber(candidate.value));

  if (!selectedPrice) return null;

  return {
    value: selectedPrice.value,
    currency: PRICE_CURRENCY.RUB,
    sourceType: PRICE_SOURCE_TYPE.FLEA_MARKET,
    vendorName: 'Flea Market',
    vendorNormalizedName: 'flea-market',
    traderLevel: null,
    questRequired: false,
    originalCurrency: PRICE_CURRENCY.RUB,
    originalPrice: selectedPrice.value,
    field: selectedPrice.field,
    fallbackUsed: selectedPrice.fallbackUsed,
    confidence: selectedPrice.confidence,
    offer: null,
  };
}

function getDirectPurchaseOffers(item) {
  const normalizedOffers = (item?.buyFor || [])
    .map(normalizeBuyOffer)
    .filter(Boolean);
  const fleaMarket = normalizedOffers
    .filter(offer => offer.sourceType === PRICE_SOURCE_TYPE.FLEA_MARKET)
    .reduce((selected, offer) => (
      !selected || offer.value < selected.value ? offer : selected
    ), null) ?? createLegacyFleaOffer(item);
  const traderOffers = normalizedOffers.filter(offer => (
    offer.sourceType === PRICE_SOURCE_TYPE.TRADER
  ));

  return {
    fleaMarket,
    traderOffers,
  };
}

function selectCheapestOffer(offers) {
  return offers
    .filter(offer => isPositiveNumber(offer?.value))
    .reduce((selected, offer) => (
      !selected || offer.value < selected.value ? offer : selected
    ), null);
}

function normalizeBarterOffer(item, barter) {
  if (!barter?.trader || !Array.isArray(barter.requiredItems) || barter.requiredItems.length === 0) {
    return null;
  }

  let totalValue = 0;
  const requiredItems = [];

  for (const requirement of barter.requiredItems) {
    const count = Number(requirement?.count);
    if (!isPositiveNumber(count) || !requirement?.item) return null;

    const directOffers = getDirectPurchaseOffers(requirement.item);
    const selectedPrice = selectCheapestOffer([
      directOffers.fleaMarket,
      ...directOffers.traderOffers,
    ]);
    if (!selectedPrice) return null;

    totalValue += selectedPrice.value * count;
    requiredItems.push({
      count,
      item: requirement.item,
      priceInfo: selectedPrice,
    });
  }

  const rewardCount = Number(
    (barter.rewardItems || []).find(reward => reward?.item?.id === item?.id)?.count ?? 1,
  );
  const normalizedRewardCount = isPositiveNumber(rewardCount) ? rewardCount : 1;

  return {
    value: totalValue / normalizedRewardCount,
    currency: PRICE_CURRENCY.RUB,
    sourceType: PRICE_SOURCE_TYPE.TRADER,
    vendorName: barter.trader.name ?? null,
    vendorNormalizedName: barter.trader.normalizedName ?? null,
    traderLevel: isPositiveNumber(barter.level) ? barter.level : null,
    questRequired: Boolean(barter.taskUnlock),
    originalCurrency: null,
    originalPrice: null,
    field: 'bartersFor',
    fallbackUsed: false,
    confidence: PRICE_CONFIDENCE.HIGH,
    isBarter: true,
    requiredItems,
    offer: barter,
  };
}

export function normalizePurchaseOffers(item, mode = DEFAULT_PRICE_MODE) {
  const directOffers = getDirectPurchaseOffers(item);
  const hasDirectOffer = Boolean(
    directOffers.fleaMarket || directOffers.traderOffers.length > 0,
  );
  const barterOffers = (item?.bartersFor || [])
    .map(barter => normalizeBarterOffer(item, barter))
    .filter(Boolean)
    .map(offer => ({
      ...offer,
      barterOnly: !hasDirectOffer,
    }));

  return {
    mode,
    fleaMarket: directOffers.fleaMarket,
    traderOffers: [...directOffers.traderOffers, ...barterOffers],
  };
}

function createMissingPrice(mode, item, offers = null) {
  return {
    value: null,
    currency: PRICE_CURRENCY.RUB,
    mode,
    source: PRICE_SOURCE.TARKOV_DEV,
    sourceType: PRICE_SOURCE_TYPE.MISSING,
    vendorName: null,
    vendorNormalizedName: null,
    traderLevel: null,
    questRequired: false,
    field: null,
    offer: null,
    fallbackUsed: false,
    updatedAt: item?.updated ?? null,
    confidence: PRICE_CONFIDENCE.MISSING,
    isBarter: false,
    barterOnly: false,
    offers,
  };
}

export function selectPurchasePrice(item, options = {}) {
  const mode = options.priceMode ?? item?.purchaseOffers?.mode ?? item?.price?.mode ?? DEFAULT_PRICE_MODE;
  const includeTraderPrices = options.includeTraderPrices !== false;
  let offers = item?.purchaseOffers;

  // Keep supporting objects normalized by older repository versions and focused
  // calculator fixtures. Raw API items never get their basePrice promoted here.
  if (!offers && !Array.isArray(item?.buyFor) && isPositiveNumber(item?.price?.value)) {
    const legacyPriceMode = item.price.mode ?? DEFAULT_PRICE_MODE;
    if (legacyPriceMode === mode) {
      const sourceType = item.price.sourceType === PRICE_SOURCE_TYPE.TRADER
        ? PRICE_SOURCE_TYPE.TRADER
        : PRICE_SOURCE_TYPE.FLEA_MARKET;
      const legacyOffer = {
        value: item.price.value,
        currency: PRICE_CURRENCY.RUB,
        sourceType,
        vendorName: item.price.vendorName
          ?? (sourceType === PRICE_SOURCE_TYPE.FLEA_MARKET ? 'Flea Market' : null),
        vendorNormalizedName: item.price.vendorNormalizedName
          ?? (sourceType === PRICE_SOURCE_TYPE.FLEA_MARKET ? 'flea-market' : null),
        traderLevel: item.price.traderLevel ?? null,
        questRequired: Boolean(item.price.questRequired),
        field: item.price.field ?? null,
        fallbackUsed: Boolean(item.price.fallbackUsed),
        confidence: item.price.confidence ?? PRICE_CONFIDENCE.HIGH,
        isBarter: Boolean(item.price.isBarter),
        barterOnly: Boolean(item.price.barterOnly),
        offer: item.price.offer ?? null,
      };

      offers = {
        mode,
        fleaMarket: sourceType === PRICE_SOURCE_TYPE.FLEA_MARKET ? legacyOffer : null,
        traderOffers: sourceType === PRICE_SOURCE_TYPE.TRADER ? [legacyOffer] : [],
      };
    }
  }

  if (!offers || offers.mode !== mode) {
    if (offers?.mode && offers.mode !== mode) {
      return createMissingPrice(mode, item, offers);
    }
    offers = normalizePurchaseOffers(item, mode);
  }

  const candidates = [offers.fleaMarket];
  if (includeTraderPrices) candidates.push(...offers.traderOffers);

  const selectedOffer = selectCheapestOffer(candidates);

  if (!selectedOffer) return createMissingPrice(mode, item, offers);

  return {
    value: selectedOffer.value,
    currency: PRICE_CURRENCY.RUB,
    mode,
    source: PRICE_SOURCE.TARKOV_DEV,
    sourceType: selectedOffer.sourceType,
    vendorName: selectedOffer.vendorName,
    vendorNormalizedName: selectedOffer.vendorNormalizedName,
    traderLevel: selectedOffer.traderLevel,
    questRequired: selectedOffer.questRequired,
    field: selectedOffer.field ?? 'buyFor',
    offer: selectedOffer.offer,
    fallbackUsed: Boolean(selectedOffer.fallbackUsed),
    updatedAt: item?.updated ?? null,
    confidence: selectedOffer.confidence ?? PRICE_CONFIDENCE.HIGH,
    isBarter: Boolean(selectedOffer.isBarter),
    barterOnly: Boolean(selectedOffer.barterOnly),
    requiredItems: selectedOffer.requiredItems ?? null,
    offers,
  };
}

export function normalizeItemPrice(item, mode = DEFAULT_PRICE_MODE) {
  return selectPurchasePrice(item, {
    includeTraderPrices: true,
    priceMode: mode,
  });
}

export function getPurchasePriceValue(item, options = {}, missingValue = null) {
  const value = selectPurchasePrice(item, options).value;
  return isPositiveNumber(value) ? value : missingValue;
}

export function sumPurchasePrices(items, options = {}) {
  const priceInfos = (items || []).map(item => selectPurchasePrice(item, options));
  const hasMissingPrice = priceInfos.some(priceInfo => !isPositiveNumber(priceInfo.value));

  return {
    value: hasMissingPrice
      ? null
      : priceInfos.reduce((total, priceInfo) => total + priceInfo.value, 0),
    currency: PRICE_CURRENCY.RUB,
    priceInfos,
    hasMissingPrice,
  };
}

export function normalizeItemPriceFields(item, mode = DEFAULT_PRICE_MODE) {
  if (!item) return item;

  const purchaseOffers = normalizePurchaseOffers(item, mode);
  const normalizedItem = {
    ...item,
    purchaseOffers,
  };

  return {
    ...normalizedItem,
    price: normalizeItemPrice(normalizedItem, mode),
  };
}
