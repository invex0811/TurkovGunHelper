import { DEFAULT_PRICE_MODE } from '../price/priceModes.js';
import { normalizeItemPriceFields } from '../price/priceMapper.js';
import {
  getEffectivePriceMode,
  getTarkovDevGameMode,
} from '../price/priceProvider.js';
import { fetchGraphQL } from './client.js';
import {
  GET_ALL_MODS_QUERY,
  GET_WEAPONS_QUERY,
  GET_WEAPON_DETAILS_QUERY,
} from './queries.js';

export async function getWeapons() {
  const data = await fetchGraphQL(GET_WEAPONS_QUERY);
  return data.items.filter(item => item.name && item.shortName);
}

const cachedModsByPriceMode = new Map();

export async function getAllMods(priceMode = DEFAULT_PRICE_MODE) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);

  if (cachedModsByPriceMode.has(effectivePriceMode)) {
    return cachedModsByPriceMode.get(effectivePriceMode);
  }

  const gameMode = getTarkovDevGameMode(effectivePriceMode);
  const data = await fetchGraphQL(GET_ALL_MODS_QUERY, { gameMode });
  const modMap = {};

  data.items.forEach(item => {
    const normalizedItem = normalizeItemPriceFields(item, effectivePriceMode);
    modMap[normalizedItem.id] = normalizedItem;
  });

  cachedModsByPriceMode.set(effectivePriceMode, modMap);
  return modMap;
}

export async function getWeaponDetails(id, priceMode = DEFAULT_PRICE_MODE) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);
  const gameMode = getTarkovDevGameMode(effectivePriceMode);

  const data = await fetchGraphQL(GET_WEAPON_DETAILS_QUERY, {
    id,
    gameMode,
  });

  return normalizeItemPriceFields(data.item, effectivePriceMode);
}