import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchGraphQL,
  TarkovApiError,
} from '../../src/data/tarkovApi/client.js';
import {
  clearTarkovApiCache,
  getAllMods,
  getWeapons,
  TARKOV_API_CACHE_TTL_MS,
} from '../../src/data/tarkovApi/repository.js';
import { PRICE_MODES } from '../../src/data/price/priceModes.js';
import {
  GET_ALL_MODS_QUERY,
  GET_WEAPON_DETAILS_QUERY,
} from '../../src/data/tarkovApi/queries.js';

function createResponse(data, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => data,
  };
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

function createWeapon(id = 'weapon-1') {
  return {
    id,
    name: 'Test weapon',
    shortName: 'TW',
    categories: [{ name: 'Assault carbine' }],
  };
}

function createMod(id = 'mod-1') {
  return {
    id,
    name: 'Test mod',
    shortName: 'TM',
    avg24hPrice: 100,
  };
}

test('fetchGraphQL posts the query and returns GraphQL data', async () => {
  await withFetchMock(async (url, options) => {
    assert.equal(url, 'https://api.tarkov.dev/graphql');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      query: 'query Test',
      variables: { id: 'item-1' },
    });

    return createResponse({ data: { item: { id: 'item-1' } } });
  }, async () => {
    const data = await fetchGraphQL('query Test', { id: 'item-1' });

    assert.deepEqual(data, { item: { id: 'item-1' } });
  });
});

test('fetchGraphQL exposes HTTP and GraphQL failures as typed errors', async () => {
  await withFetchMock(async () => createResponse(null, {
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
  }), async () => {
    await assert.rejects(
      fetchGraphQL('query Test'),
      error => error instanceof TarkovApiError
        && error.code === 'HTTP_ERROR'
        && error.status === 503,
    );
  });

  await withFetchMock(async () => createResponse({
    errors: [{ message: 'Invalid query' }],
  }), async () => {
    await assert.rejects(
      fetchGraphQL('query Test'),
      error => error instanceof TarkovApiError
        && error.code === 'GRAPHQL_ERROR'
        && error.message === 'Invalid query',
    );
  });
});

test('fetchGraphQL distinguishes cancellation and timeout errors', async () => {
  await withFetchMock((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('Request aborted', 'AbortError'));
    }, { once: true });
  }), async () => {
    const controller = new AbortController();
    const request = fetchGraphQL('query Test', {}, {
      signal: controller.signal,
      timeoutMs: 0,
    });

    controller.abort();

    await assert.rejects(
      request,
      error => error instanceof TarkovApiError && error.code === 'ABORTED',
    );
  });

  await withFetchMock((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('Request timed out', 'AbortError'));
    }, { once: true });
  }), async () => {
    await assert.rejects(
      fetchGraphQL('query Test', {}, { timeoutMs: 1 }),
      error => error instanceof TarkovApiError && error.code === 'TIMEOUT',
    );
  });
});

test('getWeapons deduplicates in-flight requests and reuses a fresh cache entry', async () => {
  let requestCount = 0;
  let resolveRequest;
  const pendingResponse = new Promise(resolve => {
    resolveRequest = resolve;
  });

  await withFetchMock(async () => {
    requestCount += 1;
    await pendingResponse;
    return createResponse({ data: { items: [createWeapon()] } });
  }, async () => {
    const firstRequest = getWeapons();
    const secondRequest = getWeapons();

    await Promise.resolve();
    assert.equal(requestCount, 1);

    resolveRequest();
    const [firstWeapons, secondWeapons] = await Promise.all([firstRequest, secondRequest]);

    assert.strictEqual(firstWeapons, secondWeapons);
    assert.equal(firstWeapons.length, 1);

    const cachedWeapons = await getWeapons();
    assert.strictEqual(cachedWeapons, firstWeapons);
    assert.equal(requestCount, 1);
  });
});

test('getWeapons cancels an in-flight request when its last consumer aborts', async () => {
  let requestSignal;

  await withFetchMock((_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal;
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('Request aborted', 'AbortError'));
    }, { once: true });
  }), async () => {
    const controller = new AbortController();
    const request = getWeapons({ signal: controller.signal });

    await Promise.resolve();
    controller.abort();

    await assert.rejects(
      request,
      error => error instanceof TarkovApiError && error.code === 'ABORTED',
    );
    assert.equal(requestSignal.aborted, true);
  });
});

test('getWeapons expires stale cache entries and retries after a failed request', async () => {
  let requestCount = 0;
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    await withFetchMock(async () => {
      requestCount += 1;
      return createResponse({ data: { items: [createWeapon(`weapon-${requestCount}`)] } });
    }, async () => {
      const firstWeapons = await getWeapons();
      now += TARKOV_API_CACHE_TTL_MS - 1;
      const cachedWeapons = await getWeapons();
      now += 1;
      const refreshedWeapons = await getWeapons();

      assert.strictEqual(cachedWeapons, firstWeapons);
      assert.notStrictEqual(refreshedWeapons, firstWeapons);
      assert.equal(requestCount, 2);
    });
  } finally {
    Date.now = originalNow;
  }

  requestCount = 0;
  await withFetchMock(async () => {
    requestCount += 1;

    if (requestCount === 1) {
      throw new Error('Offline');
    }

    return createResponse({ data: { items: [createWeapon()] } });
  }, async () => {
    await assert.rejects(getWeapons(), error => error.code === 'NETWORK_ERROR');
    const weapons = await getWeapons();

    assert.equal(weapons.length, 1);
    assert.equal(requestCount, 2);
  });
});

test('getAllMods caches independently by effective price mode', async () => {
  const requestedGameModes = [];

  await withFetchMock(async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    requestedGameModes.push(variables.gameMode);

    return createResponse({ data: { items: [createMod(`mod-${variables.gameMode}`)] } });
  }, async () => {
    const [pvpFirst, pvpSecond] = await Promise.all([
      getAllMods(PRICE_MODES.PVP),
      getAllMods(PRICE_MODES.PVP),
    ]);
    const pveMods = await getAllMods(PRICE_MODES.PVE);

    assert.strictEqual(pvpFirst, pvpSecond);
    assert.equal(pvpFirst['mod-regular'].price.mode, PRICE_MODES.PVP);
    assert.equal(pveMods['mod-pve'].price.mode, PRICE_MODES.PVE);
    assert.deepEqual(requestedGameModes, ['regular', 'pve']);
  });
});

test('mod and weapon detail queries request monetary buyFor metadata', () => {
  for (const query of [GET_ALL_MODS_QUERY, GET_WEAPON_DETAILS_QUERY]) {
    assert.match(query, /buyFor\s*\{/);
    assert.match(query, /priceRUB/);
    assert.match(query, /currency/);
    assert.match(query, /__typename/);
    assert.match(query, /\.\.\. on TraderOffer/);
    assert.match(query, /minTraderLevel/);
    assert.match(query, /taskUnlock\s*\{\s*id\s*\}/);
    assert.doesNotMatch(query, /bartersFor/);
  }
});
