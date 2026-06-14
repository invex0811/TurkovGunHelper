import {
  DEFAULT_PRICE_MODE,
  PRICE_MODES,
  isSupportedPriceMode,
} from './priceModes.js';

export const TARKOV_DEV_GAME_MODES = {
  REGULAR: 'regular',
  PVE: 'pve',
};

export function getEffectivePriceMode(priceMode) {
  return isSupportedPriceMode(priceMode) ? priceMode : DEFAULT_PRICE_MODE;
}

export function getTarkovDevGameMode(priceMode) {
  const effectivePriceMode = getEffectivePriceMode(priceMode);

  if (effectivePriceMode === PRICE_MODES.PVE) {
    return TARKOV_DEV_GAME_MODES.PVE;
  }

  return TARKOV_DEV_GAME_MODES.REGULAR;
}