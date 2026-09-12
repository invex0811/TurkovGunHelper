import { createTarkovJsonFixture } from '../../fixtures/tarkovJson.js';

function createCatalogResponses(priceMultiplier = 1) {
  const fixture = createTarkovJsonFixture('en');
  const starterGrip = fixture.items.data.items['mod-1'];

  fixture.itemTranslations.data['mod-1 Name'] = 'Starter Grip';
  fixture.itemTranslations.data['mod-1 ShortName'] = 'Starter Grip';
  starterGrip.ergonomicsModifier = 8;
  starterGrip.recoilModifier = -5;

  fixture.items.data.items['mod-2'] = {
    ...structuredClone(starterGrip),
    id: 'mod-2',
    name: 'mod-2 Name',
    shortName: 'mod-2 ShortName',
    normalizedName: 'alternative-grip',
    image512pxLink: 'https://assets.test/alternative-grip-512.webp',
    avg24hPrice: 70,
    lastLowPrice: 65,
    ergonomicsModifier: 2,
    recoilModifier: -1,
    properties: { centerOfImpact: 0.07, deviationMax: 22, slots: [] },
  };
  fixture.itemTranslations.data['mod-2 Name'] = 'Alternative Grip';
  fixture.itemTranslations.data['mod-2 ShortName'] = 'Alternative Grip';
  fixture.items.data.items['weapon-1'].properties.slots[0].filters.allowedItems = [
    'mod-1',
    'mod-2',
  ];
  fixture.items.data.items['weapon-2'] = {
    ...structuredClone(fixture.items.data.items['weapon-1']),
    id: 'weapon-2',
    name: 'weapon-2 Name',
    shortName: 'weapon-2 ShortName',
    normalizedName: 'second-test-weapon',
  };
  fixture.itemTranslations.data['weapon-2 Name'] = 'Second test weapon';
  fixture.itemTranslations.data['weapon-2 ShortName'] = 'TW2';
  Object.values(fixture.items.data.items).forEach(item => {
    for (const field of ['avg24hPrice', 'lastLowPrice', 'low24hPrice', 'high24hPrice']) {
      if (Number.isFinite(item[field])) item[field] *= priceMultiplier;
    }
    item.buyFromTrader?.forEach(offer => {
      offer.price *= priceMultiplier;
      offer.priceRUB *= priceMultiplier;
    });
  });
  fixture.barters.data = [];

  return {
    items: fixture.items,
    items_en: fixture.itemTranslations,
    barters: fixture.barters,
    traders: fixture.traders,
    traders_en: fixture.traderTranslations,
  };
}

export async function mockTarkovApi(page) {
  const responsesByMode = {
    regular: createCatalogResponses(1),
    pve: createCatalogResponses(10),
  };

  await page.route('https://json.tarkov.dev/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/+/, '');
    const mode = path.startsWith('pve/') ? 'pve' : 'regular';
    const endpoint = path.replace(/^(regular|pve)\//, '');
    const response = responsesByMode[mode][endpoint];

    if (!response) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Unhandled fixture endpoint: ${endpoint}` }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('https://assets.test/**', route => route.abort());
}
