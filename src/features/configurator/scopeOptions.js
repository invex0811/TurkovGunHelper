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

// Compares zoom levels level by level, so 1x < 1/4x < 1/6x < 1.5x < 4x.
// Sights without zoom data go last.
function compareZoomLevels(left, right) {
  if (left.length === 0 || right.length === 0) return right.length - left.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function getScopeName(scope) {
  return scope.name || scope.shortName || scope.id;
}

export function getScopeOptions(allMods) {
  if (!allMods) return [];

  return Object.values(allMods)
    .filter(isSelectableScope)
    // Within one zoom, sort by the full name, because that is what the picker displays.
    .sort((left, right) => compareZoomLevels(getScopeZoomLevels(left), getScopeZoomLevels(right))
      || getScopeName(left).localeCompare(getScopeName(right)));
}

export function getScopeZoomOptions(scopes) {
  return Array.from(new Set(scopes.flatMap(getScopeZoomLevels))).sort((left, right) => left - right);
}
