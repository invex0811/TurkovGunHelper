export function getRootSlotRouteKey(slot, rootSlots = []) {
  const baseKey = slot?.nameId || slot?.id || slot?.name || 'root-slot';
  const ordinal = Math.max(0, rootSlots.indexOf(slot));
  return `${baseKey}#${ordinal}`;
}

export function getNestedSlotRouteKey(parentPath, parentItem, slot, parentSlots = []) {
  const baseKey = slot?.nameId || slot?.id || slot?.name || 'nested-slot';
  const ordinal = Math.max(0, parentSlots.indexOf(slot));
  return `${parentPath}/${parentItem?.id || 'item'}:${baseKey}#${ordinal}`;
}
