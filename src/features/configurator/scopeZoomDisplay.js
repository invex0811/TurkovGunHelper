import { getScopeZoomLevels } from '../../domain/scopeZoom.js';

export const PRIMARY_SCOPE_ZOOMS = Object.freeze([1, 4, 6, 8]);

// Lists the same discrete levels the zoom filter matches, e.g. "1/6x".
export function formatScopeZoomBadge(scope) {
  const zoomLevels = getScopeZoomLevels(scope);
  return zoomLevels.length > 0 ? `${zoomLevels.join('/')}x` : null;
}

export function getPrimaryScopeZoomLevels(scopeZoomLevels) {
  return PRIMARY_SCOPE_ZOOMS.filter(zoom => scopeZoomLevels.includes(zoom));
}

export function getAdditionalScopeZoomLevels(scopeZoomLevels) {
  return scopeZoomLevels.filter(zoom => !PRIMARY_SCOPE_ZOOMS.includes(zoom));
}

export function getCompactScopeZoomLevels(scopeZoomLevels, selectedZoom, isExpanded) {
  const primaryZooms = getPrimaryScopeZoomLevels(scopeZoomLevels);
  if (isExpanded || selectedZoom === null || primaryZooms.includes(selectedZoom)) {
    return primaryZooms;
  }
  return [...primaryZooms, selectedZoom];
}
