import { normalizeItemPriceFields } from '../price/priceMapper.js';

function toReference(value) {
  const id = typeof value === 'string' ? value : value?.id;
  return id ? { id } : null;
}

function normalizeReferences(values) {
  return Array.isArray(values) ? values.map(toReference).filter(Boolean) : [];
}

function normalizeTaskUnlock(value) {
  if (!value) return null;
  return typeof value === 'string' ? { id: value } : value;
}

function normalizeSlot(slot) {
  const filters = slot?.filters && typeof slot.filters === 'object'
    ? slot.filters
    : {};

  return {
    ...slot,
    name: slot?.name ?? slot?.nameId ?? '',
    nameId: slot?.nameId ?? slot?.id ?? '',
    required: Boolean(slot?.required),
    filters: {
      ...filters,
      allowedItems: normalizeReferences(filters.allowedItems),
    },
  };
}

function normalizeProperties(properties, rawItemsById) {
  if (!properties || typeof properties !== 'object') return properties ?? null;

  const presetId = typeof properties.defaultPreset === 'string'
    ? properties.defaultPreset
    : properties.defaultPreset?.id;
  const preset = presetId ? rawItemsById[presetId] : null;

  return {
    ...properties,
    slots: Array.isArray(properties.slots)
      ? properties.slots.map(normalizeSlot)
      : [],
    ...(Object.hasOwn(properties, 'allowedItems')
      ? { allowedItems: normalizeReferences(properties.allowedItems) }
      : {}),
    ...(presetId
      ? {
        defaultPreset: {
          id: presetId,
          name: preset?.name,
          shortName: preset?.shortName,
          image512pxLink: preset?.image512pxLink,
          iconLink: preset?.iconLink,
          gridImageLink: preset?.gridImageLink,
        },
      }
      : {}),
  };
}

function createCategoryIndex(data) {
  return {
    ...(data.handbookCategories || {}),
    ...(data.itemCategories || {}),
  };
}

function normalizeCategories(item, categoryIndex) {
  // The legacy API `categories` field represented the item-category
  // ancestry. Handbook categories are only a lookup fallback, not extra
  // calculator categories.
  const ids = item.categories || [];
  const seen = new Set();

  return ids.flatMap(value => {
    const id = typeof value === 'string' ? value : value?.id;
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const category = categoryIndex[id] || (typeof value === 'object' ? value : null);
    return category ? [{ ...category, id }] : [{ id, name: id }];
  });
}

function normalizeBuyFor(item, tradersById) {
  return (item.buyFromTrader || item.buyFor || []).flatMap(offer => {
    const traderId = typeof offer?.trader === 'string'
      ? offer.trader
      : offer?.trader?.id;
    const trader = tradersById[traderId] || offer?.trader;
    if (!offer || !trader) return [];

    const taskUnlock = normalizeTaskUnlock(offer.taskUnlock);
    return [{
      ...offer,
      taskUnlock,
      vendor: {
        __typename: 'TraderOffer',
        id: traderId,
        name: trader.name ?? traderId,
        normalizedName: trader.normalizedName ?? null,
        minTraderLevel: offer.minTraderLevel ?? null,
        buyLimit: offer.buyLimit ?? null,
        taskUnlock,
      },
    }];
  });
}

function normalizeBaseItem(item, rawItemsById, categoryIndex, tradersById) {
  const properties = normalizeProperties(item.properties, rawItemsById);
  return {
    ...item,
    categories: normalizeCategories(item, categoryIndex),
    conflictingItems: normalizeReferences(item.conflictingItems),
    buyFor: normalizeBuyFor(item, tradersById),
    bartersFor: [],
    properties,
    slots: properties?.slots || [],
    allowedItems: normalizeReferences(item.allowedItems),
    defaultPreset: properties?.defaultPreset ?? null,
    ergonomics: item.ergonomics ?? properties?.ergonomics ?? null,
    recoilVertical: item.recoilVertical ?? properties?.recoilVertical ?? null,
    recoilHorizontal: item.recoilHorizontal ?? properties?.recoilHorizontal ?? null,
  };
}

function normalizeTraders(tradersById, items) {
  const requiredLevels = new Map();
  for (const item of items) {
    for (const offer of item.buyFor || []) {
      const traderId = offer.vendor?.id;
      if (!traderId) continue;
      requiredLevels.set(traderId, Math.max(
        requiredLevels.get(traderId) || 1,
        Number(offer.vendor.minTraderLevel) || 1,
      ));
    }
    for (const barter of item.bartersFor || []) {
      const traderId = barter.trader?.id;
      if (!traderId) continue;
      requiredLevels.set(traderId, Math.max(
        requiredLevels.get(traderId) || 1,
        Number(barter.level) || 1,
      ));
    }
  }

  return [...requiredLevels].flatMap(([id, requiredLevel]) => {
    const trader = tradersById[id];
    if (!trader) return [];
    const apiMaxLevel = Array.isArray(trader.levels) ? trader.levels.length : null;
    return [{
      id,
      name: trader.name ?? id,
      imageUrl: trader.imageLink ?? trader.image4xLink ?? null,
      maxLevel: Math.max(apiMaxLevel || 4, requiredLevel),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function createRequiredItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    normalizedName: item.normalizedName,
    updated: item.updated,
    basePrice: item.basePrice,
    avg24hPrice: item.avg24hPrice,
    lastLowPrice: item.lastLowPrice,
    low24hPrice: item.low24hPrice,
    high24hPrice: item.high24hPrice,
    lastOfferCount: item.lastOfferCount,
    buyFor: item.buyFor,
  };
}

function normalizeBarter(barter, baseItemsById, tradersById) {
  const offeredItemId = typeof barter?.offeredItem?.item === 'string'
    ? barter.offeredItem.item
    : barter?.offeredItem?.item?.id;
  if (!offeredItemId) return null;

  const traderId = typeof barter.trader === 'string' ? barter.trader : barter.trader?.id;
  const trader = tradersById[traderId] || barter.trader;
  return {
    offeredItemId,
    value: {
      id: barter.id,
      level: barter.minTraderLevel ?? barter.level ?? null,
      buyLimit: barter.buyLimit ?? null,
      taskUnlock: normalizeTaskUnlock(barter.taskUnlock),
      trader: trader ? {
        id: traderId,
        name: trader.name ?? traderId,
        normalizedName: trader.normalizedName ?? null,
      } : null,
      requiredItems: (barter.requiredItems || []).map(requirement => {
        const id = typeof requirement?.item === 'string'
          ? requirement.item
          : requirement?.item?.id;
        const item = createRequiredItem(baseItemsById[id]) || (id ? { id } : null);
        return { ...requirement, item };
      }),
      rewardItems: [{
        count: barter.offeredItem?.count ?? 1,
        item: { id: offeredItemId },
      }],
    },
  };
}

export function normalizeItemsCatalog(data, barters, tradersById, priceMode) {
  if (!data?.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new TypeError('items must be an object keyed by item ID');
  }

  const rawItemsById = Object.fromEntries(
    Object.entries(data.items)
      .filter(([, item]) => item && typeof item === 'object')
      .map(([id, item]) => [id, item.id ? item : { ...item, id }]),
  );
  const categoryIndex = createCategoryIndex(data);
  const baseItemsById = Object.fromEntries(
    Object.entries(rawItemsById).map(([id, item]) => [
      id,
      normalizeBaseItem(item, rawItemsById, categoryIndex, tradersById),
    ]),
  );
  const bartersByItemId = new Map();

  for (const barter of barters || []) {
    const normalized = normalizeBarter(barter, baseItemsById, tradersById);
    if (!normalized) continue;
    const values = bartersByItemId.get(normalized.offeredItemId) || [];
    values.push(normalized.value);
    bartersByItemId.set(normalized.offeredItemId, values);
  }

  const normalizedItems = Object.values(baseItemsById).map(item => normalizeItemPriceFields({
    ...item,
    bartersFor: bartersByItemId.get(item.id) || [],
  }, priceMode));
  const normalizedItemsById = Object.fromEntries(
    normalizedItems.map(item => [item.id, item]),
  );
  const items = normalizedItems.map(item => {
    const presetId = item.properties?.defaultPreset?.id;
    const defaultPresetItem = presetId ? normalizedItemsById[presetId] : null;
    return defaultPresetItem ? { ...item, defaultPresetItem } : item;
  });
  const itemsById = Object.fromEntries(items.map(item => [item.id, item]));
  const weapons = items.filter(item => item.types?.includes('gun'));
  const mods = items.filter(item => item.types?.includes('mods'));

  return {
    items,
    itemsById,
    weapons,
    mods,
    modsById: Object.fromEntries(mods.map(item => [item.id, item])),
    traders: normalizeTraders(tradersById, items),
  };
}
