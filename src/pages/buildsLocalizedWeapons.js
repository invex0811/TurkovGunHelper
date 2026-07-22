export function getBuildGameMode(build) {
  return build?.settings?.priceMode === 'pve' ? 'pve' : 'regular';
}

export function getLocalizedBuildWeapon(build, catalogsByMode) {
  const fallbackWeapon = build?.weapon || {};
  const catalog = catalogsByMode?.get?.(getBuildGameMode(build));
  const localizedWeapon = catalog?.itemsById?.[fallbackWeapon.id];

  return localizedWeapon || fallbackWeapon;
}
