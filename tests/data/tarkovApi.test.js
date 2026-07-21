import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchTarkovJson, TarkovApiError } from '../../src/data/tarkovApi/client.js';
import {
  clearTarkovApiCache,
  getAllMods,
  getWeaponDetails,
  getWeapons,
  TARKOV_API_CACHE_TTL_MS,
} from '../../src/data/tarkovApi/repository.js';
import { PRICE_MODES } from '../../src/data/price/priceModes.js';
import { createTarkovJsonFixture } from '../fixtures/tarkovJson.js';

function createResponse(value, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    json: options.json ?? (async () => value),
  };
}

function createCatalogFetch(options = {}) {
  const calls = [];
  let failedItems = false;
  const mock = async (url, requestOptions) => {
    calls.push({ url, options: requestOptions });
    const path = new URL(url).pathname.slice(1);
    const language = path.endsWith('_ru') ? 'ru' : 'en';
    const fixture = createTarkovJsonFixture(language);

    if (options.failFirstItems && path.endsWith('/items') && !failedItems) {
      failedItems = true;
      throw new Error('offline');
    }
    if (path.endsWith('/items')) return createResponse(options.items ?? fixture.items);
    if (/\/items_(en|ru)$/.test(path)) return createResponse(fixture.itemTranslations);
    if (path.endsWith('/barters')) return createResponse(options.barters ?? fixture.barters);
    if (path.endsWith('/traders')) return createResponse(fixture.traders);
    if (/\/traders_(en|ru)$/.test(path)) return createResponse(fixture.traderTranslations);
    throw new Error(`Unexpected endpoint: ${path}`);
  };
  mock.calls = calls;
  return mock;
}

async function withFetchMock(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  clearTarkovApiCache();
  try {
    return await run();
  } finally {
    clearTarkovApiCache();
    globalThis.fetch = originalFetch;
  }
}

test('JSON client performs a bodyless GET with an Accept header', async () => {
  await withFetchMock(async (url, options) => {
    assert.equal(url, 'https://json.tarkov.dev/regular/items');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(Object.hasOwn(options, 'body'), false);
    return createResponse({ data: { items: { 'weapon-1': { id: 'weapon-1' } } } });
  }, async () => {
    const result = await fetchTarkovJson('regular/items');
    assert.equal(result.data.items['weapon-1'].id, 'weapon-1');
  });
});

test('JSON client maps HTTP, malformed JSON, missing data, and array data errors', async () => {
  await withFetchMock(async () => createResponse(null, {
    ok: false, status: 503, statusText: 'Service Unavailable',
  }), async () => {
    await assert.rejects(fetchTarkovJson('regular/items'), error => (
      error instanceof TarkovApiError && error.code === 'HTTP_ERROR' && error.status === 503
    ));
  });

  await withFetchMock(async () => createResponse(null, {
    json: async () => { throw new SyntaxError('bad JSON'); },
  }), async () => {
    await assert.rejects(fetchTarkovJson('regular/items'), { code: 'INVALID_RESPONSE' });
  });

  for (const invalid of [{}, { data: null }, { data: [] }]) {
    await withFetchMock(async () => createResponse(invalid), async () => {
      await assert.rejects(fetchTarkovJson('regular/items'), { code: 'INVALID_RESPONSE' });
    });
  }
});

test('JSON client distinguishes AbortSignal cancellation and timeout', async () => {
  const waitForAbort = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });

  await withFetchMock(waitForAbort, async () => {
    const controller = new AbortController();
    const request = fetchTarkovJson('regular/items', { signal: controller.signal, timeoutMs: 0 });
    controller.abort();
    await assert.rejects(request, { code: 'ABORTED' });
  });

  let preAbortedFetchCalls = 0;
  await withFetchMock(async () => {
    preAbortedFetchCalls += 1;
    return createResponse({ data: {} });
  }, async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchTarkovJson('regular/items', {
      signal: controller.signal,
      timeoutMs: 0,
    }), { code: 'ABORTED' });
    assert.equal(preAbortedFetchCalls, 0);
  });

  await withFetchMock(waitForAbort, async () => {
    await assert.rejects(fetchTarkovJson('regular/items', { timeoutMs: 1 }), {
      code: 'TIMEOUT',
    });
  });
});

test('catalog rejects an item response without data.items', async () => {
  const mock = createCatalogFetch({ items: { data: {} } });
  await withFetchMock(mock, async () => {
    await assert.rejects(getWeapons(), { code: 'INVALID_RESPONSE' });
  });
});

test('catalog rejects malformed barter data instead of silently losing prices', async () => {
  const mock = createCatalogFetch({ barters: { data: {} } });
  await withFetchMock(mock, async () => {
    await assert.rejects(getAllMods(), { code: 'INVALID_RESPONSE' });
  });
});

test('parallel weapon calls share one catalog pipeline and one items GET', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const [first, second] = await Promise.all([getWeapons(), getWeapons()]);
    assert.strictEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(mock.calls.filter(call => call.url.endsWith('/regular/items')).length, 1);
    assert.equal(mock.calls.length, 5);
    await getWeapons();
    assert.equal(mock.calls.length, 5);
  });
});

test('catalog expires after its TTL and forceRefresh bypasses a fresh value', async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const mock = createCatalogFetch();
    await withFetchMock(mock, async () => {
      await getWeapons();
      now += TARKOV_API_CACHE_TTL_MS - 1;
      await getWeapons();
      assert.equal(mock.calls.length, 5);
      now += 1;
      await getWeapons();
      assert.equal(mock.calls.length, 10);
      await getWeapons({ forceRefresh: true });
      assert.equal(mock.calls.length, 15);
    });
  } finally {
    Date.now = originalNow;
  }
});

test('a failed catalog request is removed from cache and can be retried', async () => {
  const mock = createCatalogFetch({ failFirstItems: true });
  await withFetchMock(mock, async () => {
    await assert.rejects(getWeapons(), { code: 'NETWORK_ERROR' });
    const weapons = await getWeapons();
    assert.equal(weapons.length, 1);
    assert.equal(mock.calls.filter(call => call.url.endsWith('/regular/items')).length, 2);
  });
});

test('PvP and PvE load their own endpoints and caches without eager loading', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    await getAllMods(PRICE_MODES.PVP);
    assert.equal(mock.calls.some(call => call.url.endsWith('/regular/items')), true);
    assert.equal(mock.calls.some(call => call.url.endsWith('/pve/items')), false);

    const pve = await getAllMods(PRICE_MODES.PVE);
    assert.equal(mock.calls.some(call => call.url.endsWith('/pve/items')), true);
    assert.equal(pve['mod-1'].price.mode, PRICE_MODES.PVE);
    assert.equal(mock.calls.filter(call => call.url.endsWith('/regular/items')).length, 1);
    assert.equal(mock.calls.filter(call => call.url.endsWith('/pve/items')).length, 1);
  });
});

test('mods and weapon details reuse the same per-mode catalog', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const mods = await getAllMods(PRICE_MODES.PVP);
    const weapon = await getWeaponDetails('weapon-1', PRICE_MODES.PVP);
    assert.equal(mods['mod-1'].id, 'mod-1');
    assert.equal(weapon.id, 'weapon-1');
    assert.equal(mock.calls.length, 5);
    await assert.rejects(getWeaponDetails('missing', PRICE_MODES.PVP), { code: 'NOT_FOUND' });
    await assert.rejects(getWeaponDetails('toString', PRICE_MODES.PVP), { code: 'NOT_FOUND' });
    assert.equal(mock.calls.length, 5);
  });
});

test('object-keyed items are normalized and filtered by actual types', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const weapons = await getWeapons();
    const mods = await getAllMods();
    assert.deepEqual(weapons.map(item => item.id), ['weapon-1']);
    assert.deepEqual(Object.keys(mods), ['mod-1']);
    assert.equal(Object.hasOwn(mods, 'other-1'), false);
  });
});

test('adapter resolves presets, ID references, required slots, and categories', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const weapon = await getWeaponDetails('weapon-1');
    assert.deepEqual(weapon.conflictingItems, [{ id: 'conflict-1' }]);
    assert.deepEqual(weapon.properties.slots[0].filters.allowedItems, [{ id: 'mod-1' }]);
    assert.equal(weapon.properties.slots[0].required, true);
    assert.equal(weapon.properties.slots[0].nameId, 'mod_pistol_grip');
    assert.deepEqual(weapon.properties.defaultPreset, {
      id: 'preset-1',
      name: 'Test preset',
      shortName: 'PRESET',
      image512pxLink: 'https://assets.test/preset-512.webp',
      iconLink: 'https://assets.test/preset-icon.webp',
      gridImageLink: 'https://assets.test/preset-grid.webp',
    });
    assert.equal(weapon.categories[0].name, 'Weapon');
    assert.equal(weapon.ergonomics, 50);
    assert.equal(weapon.recoilVertical, 100);

    const nestedSlot = (await getAllMods())['mod-1'].properties.slots[0];
    assert.equal(nestedSlot.name, 'Mount');
    assert.deepEqual(nestedSlot.filters.allowedItems, [{ id: 'other-1' }]);
  });
});

test('adapter preserves trader offers and barter data for the price mapper', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const mod = (await getAllMods())['mod-1'];
    assert.equal(mod.buyFor[0].vendor.name, 'Prapor');
    assert.equal(mod.buyFor[0].vendor.__typename, 'TraderOffer');
    assert.equal(mod.buyFor[0].vendor.minTraderLevel, 1);
    assert.equal(mod.bartersFor[0].trader.name, 'Prapor');
    assert.equal(mod.bartersFor[0].level, 2);
    assert.equal(mod.bartersFor[0].requiredItems[0].item.avg24hPrice, 10);
    assert.deepEqual(mod.bartersFor[0].rewardItems, [{ count: 1, item: { id: 'mod-1' } }]);
    assert.equal(mod.purchaseOffers.mode, PRICE_MODES.PVP);
    assert.equal(mod.price.value, 20);
    assert.equal(mod.price.isBarter, true);
  });
});

test('a missing barter requirement is preserved and cannot underprice the barter', async () => {
  const barters = createTarkovJsonFixture().barters;
  barters.data[0].requiredItems.push({ item: 'missing-required', count: 3 });
  const mock = createCatalogFetch({ barters });

  await withFetchMock(mock, async () => {
    const mod = (await getAllMods())['mod-1'];
    assert.deepEqual(mod.bartersFor[0].requiredItems[1].item, { id: 'missing-required' });
    assert.equal(mod.purchaseOffers.traderOffers.some(offer => offer.isBarter), false);
  });
});

test('English translations apply to item, short name, slot, category, and trader', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const weapon = await getWeaponDetails('weapon-1');
    assert.equal(weapon.name, 'Test weapon');
    assert.equal(weapon.shortName, 'TW');
    assert.equal(weapon.properties.slots[0].name, 'Pistol Grip');
    assert.equal(weapon.categories[0].name, 'Weapon');
    assert.equal(weapon.buyFor[0].vendor.name, 'Prapor');
  });
});

test('language participates in the cache key and unsupported values fall back to English', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    const english = await getWeapons({ language: 'xx' });
    const russian = await getWeapons({ language: 'ru' });
    assert.equal(english[0].name, 'Test weapon');
    assert.equal(russian[0].name, 'Тестовое оружие');
    assert.equal(mock.calls.filter(call => call.url.endsWith('/regular/items')).length, 2);
  });
});

test('clearTarkovApiCache removes a completed catalog bundle', async () => {
  const mock = createCatalogFetch();
  await withFetchMock(mock, async () => {
    await getWeapons();
    clearTarkovApiCache();
    await getWeapons();
    assert.equal(mock.calls.filter(call => call.url.endsWith('/regular/items')).length, 2);
  });
});

test('one aborted consumer does not cancel a shared request, but the last one does', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const base = createCatalogFetch();
  const mock = async (url, options) => {
    await gate;
    return base(url, options);
  };
  mock.calls = base.calls;

  await withFetchMock(mock, async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = getWeapons({ signal: firstController.signal });
    const second = getWeapons({ signal: secondController.signal });
    await Promise.resolve();
    firstController.abort();
    await assert.rejects(first, { code: 'ABORTED' });
    release();
    assert.equal((await second).length, 1);
  });

  let catalogSignal;
  await withFetchMock((_url, options) => new Promise((_resolve, reject) => {
    catalogSignal = options.signal;
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  }), async () => {
    const controller = new AbortController();
    const request = getWeapons({ signal: controller.signal, timeoutMs: 0 });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(request, { code: 'ABORTED' });
    assert.equal(catalogSignal.aborted, true);
  });
});
