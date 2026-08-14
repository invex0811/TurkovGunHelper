import { hasItemCategory } from '../../domain/itemCategories.js';
import { getScopeZoomLevels } from '../../domain/scopeZoom.js';

export { getScopeZoomLevels, scopeSupportsZoom } from '../../domain/scopeZoom.js';

export function isSelectableScope(item) {
  return Boolean(item?.id)
    && hasItemCategory(item, 'Sights')
    && !hasItemCategory(item, 'Ironsight')
    && !hasItemCategory(item, 'Thermal Vision')
    && !hasItemCategory(item, 'Night Vision')
    && !hasItemCategory(item, 'Special scope');
}

export function getScopeOptions(allMods) {
  if (!allMods) return [];

  return Object.values(allMods)
    .filter(isSelectableScope)
    .sort((left, right) => (left.shortName || left.name || left.id)
      .localeCompare(right.shortName || right.name || right.id));
}

export function getScopeZoomOptions(scopes) {
  return Array.from(new Set(scopes.flatMap(getScopeZoomLevels))).sort((left, right) => left - right);
}
