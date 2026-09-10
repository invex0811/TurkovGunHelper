export function normalizeBuildMaxPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function resolveSharedMaxPrice(settings = {}) {
  if (Object.hasOwn(settings, 'sharedMaxPrice')) {
    return normalizeBuildMaxPrice(settings.sharedMaxPrice);
  }

  const legacyPrices = [
    settings.customProfile?.price,
    settings.customMaxPrice,
    settings.maxPrice,
    settings.priorityMaxPrice,
  ]
    .map(normalizeBuildMaxPrice)
    .filter(price => price > 0);

  return legacyPrices.length > 0 ? Math.min(...legacyPrices) : 0;
}

export function migrateSharedMaxPriceSettings(settings = {}) {
  const maxPrice = resolveSharedMaxPrice(settings);
  const customProfile = settings.customProfile && typeof settings.customProfile === 'object'
    ? { ...settings.customProfile, price: maxPrice }
    : settings.customProfile;

  return {
    ...settings,
    ...(customProfile ? { customProfile } : {}),
    sharedMaxPrice: maxPrice,
    maxPrice,
    customMaxPrice: maxPrice,
    priorityMaxPrice: maxPrice,
  };
}
