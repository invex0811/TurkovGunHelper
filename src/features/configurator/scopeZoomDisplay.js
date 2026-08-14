export const PRIMARY_SCOPE_ZOOMS = Object.freeze([1, 4, 6, 8]);

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
