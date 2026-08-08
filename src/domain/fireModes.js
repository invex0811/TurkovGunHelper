export function formatWeaponFireModes(weapon) {
  const fireModes = weapon?.properties?.propertiesType === 'ItemPropertiesWeapon'
    && Array.isArray(weapon.properties.fireModes)
    ? weapon.properties.fireModes
    : [];

  return fireModes
    .filter(mode => typeof mode === 'string')
    .map(mode => mode.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .join(' · ');
}
