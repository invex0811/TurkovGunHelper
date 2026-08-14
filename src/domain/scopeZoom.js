import { hasItemCategory } from './itemCategories.js';

function normalizeZoomLevels(zoomLevels) {
  if (!Array.isArray(zoomLevels)) return [];

  return Array.from(new Set(
    zoomLevels
      .flat(Infinity)
      .filter(zoom => typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0),
  )).sort((left, right) => left - right);
}

export function getScopeZoomLevels(item) {
  const zoomLevels = normalizeZoomLevels(item?.properties?.zoomLevels);
  if (zoomLevels.length > 0) return zoomLevels;

  return hasItemCategory(item, 'Reflex sight') || hasItemCategory(item, 'Compact reflex sight')
    ? [1]
    : [];
}

export function scopeSupportsZoom(scope, zoom) {
  return getScopeZoomLevels(scope).includes(zoom);
}
