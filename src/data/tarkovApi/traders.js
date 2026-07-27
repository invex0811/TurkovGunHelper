export function getCatalogTraders(catalog) {
  if (Array.isArray(catalog?.traders) && catalog.traders.length > 0) {
    return catalog.traders;
  }

  const traders = new Map();
  for (const item of catalog?.items || []) {
    const offers = item.purchaseOffers?.traderOffers || [];
    for (const offer of offers) {
      const traderId = offer.traderId
        ?? offer.offer?.vendor?.id
        ?? offer.offer?.trader?.id
        ?? null;
      if (!traderId) continue;
      const current = traders.get(traderId);
      const requiredLevel = Number(offer.traderLevel) || 1;
      traders.set(traderId, {
        id: traderId,
        name: offer.vendorName ?? current?.name ?? traderId,
        imageUrl: current?.imageUrl ?? null,
        maxLevel: Math.max(current?.maxLevel || 4, requiredLevel),
      });
    }
  }

  return [...traders.values()].sort((a, b) => a.name.localeCompare(b.name));
}
