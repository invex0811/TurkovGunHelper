import { createTarkovJsonFixture } from '../../fixtures/tarkovJson.js';

function createCatalogResponses() {
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
    properties: { slots: [] },
  };
  fixture.itemTranslations.data['mod-2 Name'] = 'Alternative Grip';
  fixture.itemTranslations.data['mod-2 ShortName'] = 'Alternative Grip';
  fixture.items.data.items['weapon-1'].properties.slots[0].filters.allowedItems = [
    'mod-1',
    'mod-2',
  ];

  return {
    items: fixture.items,
    items_en: fixture.itemTranslations,
    barters: fixture.barters,
    traders: fixture.traders,
    traders_en: fixture.traderTranslations,
  };
}

export async function mockTarkovApi(page) {
  const responses = createCatalogResponses();

  await page.route('https://json.tarkov.dev/**', async route => {
    const endpoint = new URL(route.request().url()).pathname
      .replace(/^\/+/, '')
      .replace(/^(regular|pve)\//, '');
    const response = responses[endpoint];

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
