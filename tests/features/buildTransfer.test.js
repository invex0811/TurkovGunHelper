import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_EXPORT_FORMAT,
  BUILD_EXPORT_VERSION,
  BUILD_IMPORT_LIMITS,
  BuildImportError,
  createImportedBuildSnapshot,
  createSafeBuildFilename,
  downloadBuildJson,
  exportBuild,
  exportBuilds,
  getBuildFingerprint,
  parseBuildImport,
  prepareImportedBuilds,
  restoreImportedBuild,
  validateBuildImport,
} from '../../src/features/buildTransfer/index.js';
import { restoreBuildParts } from '../../src/data/savedBuilds.js';

function slot(id, name, allowedItems, required = false) {
  return { id, nameId: id, name, required, filters: { allowedItems: allowedItems.map(itemId => ({ id: itemId })) } };
}

function item(id, overrides = {}) {
  return {
    id,
    name: id,
    shortName: id,
    types: ['mods'],
    conflictingItems: [],
    properties: { slots: [], ergonomics: 0, recoilModifier: 0, weight: 0.1 },
    ...overrides,
  };
}

function createCatalog(suffix = '') {
  const sight = item(`sight${suffix}`);
  const stock = item(`stock${suffix}`, {
    properties: { slots: [slot('slot-sight', 'Sight', [sight.id])], ergonomics: 2, recoilModifier: -3, weight: 0.3 },
  });
  const mount = item(`mount${suffix}`);
  const conflict = item(`conflict${suffix}`, { conflictingItems: [{ id: stock.id }] });
  const weapon = item(`weapon${suffix}`, {
    types: ['gun'],
    properties: {
      slots: [
        slot('slot-stock', 'Stock', [stock.id], true),
        slot('slot-mount', 'Mount', [mount.id, conflict.id]),
      ],
      ergonomics: 40,
      recoilVertical: 80,
      recoilHorizontal: 200,
      weight: 3,
    },
  });
  const items = [weapon, stock, sight, mount, conflict];
  return {
    weapon,
    stock,
    sight,
    mount,
    conflict,
    itemsById: Object.fromEntries(items.map(value => [value.id, value])),
    modsById: Object.fromEntries(items.filter(value => !value.types.includes('gun')).map(value => [value.id, value])),
    weapons: [weapon],
  };
}

function importedBuild(catalog = createCatalog(), overrides = {}) {
  return {
    name: 'Test build',
    gameMode: 'regular',
    weaponId: catalog.weapon.id,
    settings: { targetType: 'meta', includeTraderPrices: false },
    configuration: {
      itemId: catalog.weapon.id,
      slotId: null,
      children: [{
        itemId: catalog.stock.id,
        slotId: 'slot-stock:0',
        children: [{ itemId: catalog.sight.id, slotId: 'slot-sight:0', children: [] }],
      }],
    },
    ...overrides,
  };
}

function savedBuild(catalog = createCatalog()) {
  const rootId = `weapon:${catalog.weapon.id}`;
  const stockSlotInstanceId = `${rootId}/slot:slot-stock_3A0`;
  const stockInstanceId = `${stockSlotInstanceId}/item:${catalog.stock.id}`;
  return {
    id: 'saved-1',
    version: 1,
    name: 'Saved test build',
    weapon: { id: catalog.weapon.id, name: catalog.weapon.name, shortName: catalog.weapon.shortName, imageUrl: 'ignored.png' },
    parts: [
      {
        itemId: catalog.stock.id,
        itemName: catalog.stock.name,
        slotName: 'Stock',
        slotId: 'slot-stock:0',
        slotIndex: 0,
        slotInstanceId: stockSlotInstanceId,
        parentItemId: catalog.weapon.id,
        parentInstanceId: rootId,
      },
      {
        itemId: catalog.sight.id,
        itemName: catalog.sight.name,
        slotName: 'Sight',
        slotId: 'slot-sight:0',
        slotIndex: 0,
        slotInstanceId: `${stockInstanceId}/slot:slot-sight_3A0`,
        parentItemId: catalog.stock.id,
        parentInstanceId: stockInstanceId,
      },
    ],
    stats: { ergonomics: 42, recoilVertical: 77, recoilHorizontal: 200, weight: 3.4, price: 0 },
    settings: { targetType: 'meta', priceMode: 'pvp', includeTraderPrices: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function envelope(builds) {
  return { format: BUILD_EXPORT_FORMAT, version: BUILD_EXPORT_VERSION, exportedAt: '2026-01-01T00:00:00.000Z', builds };
}

test('export one build uses the versioned format', () => {
  const result = exportBuilds([savedBuild()], { exportedAt: 'now' });
  assert.equal(result.format, BUILD_EXPORT_FORMAT);
  assert.equal(result.version, BUILD_EXPORT_VERSION);
  assert.equal(result.exportedAt, 'now');
  assert.equal(result.builds.length, 1);
});

test('export multiple builds preserves every build in order', () => {
  const first = savedBuild();
  const second = { ...savedBuild(), id: 'saved-2', name: 'Second' };
  assert.deepEqual(exportBuilds([first, second]).builds.map(build => build.name), [first.name, second.name]);
});

test('export excludes dynamic stats, images, prices and full item objects', () => {
  const serialized = JSON.stringify(exportBuild(savedBuild()));
  assert.equal(serialized.includes('stats'), false);
  assert.equal(serialized.includes('imageUrl'), false);
  assert.equal(serialized.includes('price'), false);
  assert.equal(serialized.includes('itemName'), false);
});

test('nested modules serialize into their parent configuration node', () => {
  const result = exportBuild(savedBuild());
  assert.equal(result.configuration.children[0].itemId, 'stock');
  assert.equal(result.configuration.children[0].children[0].itemId, 'sight');
});

test('serialize then parse preserves the normalized tree', () => {
  const payload = exportBuilds([savedBuild()]);
  const parsed = parseBuildImport(JSON.stringify(payload));
  assert.deepEqual(parsed.builds[0].configuration, payload.builds[0].configuration);
});

test('invalid JSON is rejected', () => {
  assert.throws(() => parseBuildImport('{bad'), error => error.code === 'INVALID_JSON');
});

test('wrong format is rejected', () => {
  assert.throws(() => validateBuildImport({ ...envelope([]), format: 'other' }), error => error.code === 'INVALID_FORMAT');
});

test('unknown version is rejected explicitly', () => {
  assert.throws(() => validateBuildImport({ ...envelope([]), version: 99 }), error => error.code === 'UNSUPPORTED_VERSION');
});

test('missing builds array is rejected', () => {
  assert.throws(() => validateBuildImport({ format: BUILD_EXPORT_FORMAT, version: 1 }), error => error.code === 'MISSING_BUILDS');
});

test('empty weaponId is rejected', () => {
  assert.throws(() => validateBuildImport(envelope([importedBuild(createCatalog(), { weaponId: '' })])), error => error.code === 'INVALID_WEAPON_ID');
});

test('empty itemId is rejected', () => {
  const build = importedBuild();
  build.configuration.children[0].itemId = '';
  assert.throws(() => validateBuildImport(envelope([build])), error => error.code === 'INVALID_ITEM_ID');
});

test('trees deeper than the limit are rejected', () => {
  const build = importedBuild();
  let node = build.configuration;
  for (let depth = 0; depth <= BUILD_IMPORT_LIMITS.maxDepth; depth += 1) {
    const child = { itemId: `item-${depth}`, slotId: `slot-${depth}`, children: [] };
    node.children = [child];
    node = child;
  }
  assert.throws(() => validateBuildImport(envelope([build])), error => error.code === 'MAX_DEPTH');
});

test('trees larger than the node limit are rejected', () => {
  const build = importedBuild();
  build.configuration.children = Array.from({ length: BUILD_IMPORT_LIMITS.maxNodesPerBuild }, (_, index) => ({
    itemId: `item-${index}`,
    slotId: `slot-${index}`,
    children: [],
  }));
  assert.throws(() => validateBuildImport(envelope([build])), error => error.code === 'MAX_NODES');
});

test('dangerous object keys are rejected without polluting prototypes', () => {
  const text = `{"format":"${BUILD_EXPORT_FORMAT}","version":1,"builds":[],"__proto__":{"polluted":true}}`;
  assert.throws(() => parseBuildImport(text), error => error.code === 'UNSAFE_KEY');
  assert.equal({}.polluted, undefined);
});

test('cyclic object graphs are rejected', () => {
  const data = envelope([]);
  data.self = data;
  assert.throws(() => validateBuildImport(data), error => error.code === 'CYCLIC_DATA');
});

test('identical builds have identical fingerprints', () => {
  const build = importedBuild();
  assert.equal(getBuildFingerprint(build), getBuildFingerprint(structuredClone(build)));
});

test('game mode participates in the fingerprint', () => {
  const build = importedBuild();
  assert.notEqual(getBuildFingerprint(build), getBuildFingerprint({ ...build, gameMode: 'pve' }));
});

test('installed modules participate in the fingerprint', () => {
  const build = importedBuild();
  const changed = structuredClone(build);
  changed.configuration.children[0].itemId = 'other-stock';
  assert.notEqual(getBuildFingerprint(build), getBuildFingerprint(changed));
});

test('child and object property order do not affect fingerprint', () => {
  const build = importedBuild();
  build.configuration.children.push({ itemId: 'mount', slotId: 'slot-mount:1', children: [] });
  const reordered = {
    configuration: { children: [...build.configuration.children].reverse(), slotId: null, itemId: build.weaponId },
    weaponId: build.weaponId,
    gameMode: build.gameMode,
  };
  assert.equal(getBuildFingerprint(build), getBuildFingerprint(reordered));
});

test('restore resolves nested modules to exact slot instances', () => {
  const catalog = createCatalog();
  const result = restoreImportedBuild(importedBuild(catalog), catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.buildParts[1].parentItemId, catalog.stock.id);
  assert.equal(result.buildParts[1].slotId, 'slot-sight');
});

test('missing items are reported', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  build.configuration.children[0].itemId = 'missing';
  assert.match(restoreImportedBuild(build, catalog).errors[0], /missing/);
});

test('nonexistent slots are reported', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  build.configuration.children[0].slotId = 'no-slot:0';
  assert.match(restoreImportedBuild(build, catalog).errors[0], /was not found/);
});

test('modules not allowed by the selected slot are rejected', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  build.configuration.children[0].itemId = catalog.mount.id;
  assert.match(restoreImportedBuild(build, catalog).errors[0], /not allowed/);
});

test('conflicting installed items are rejected by existing build validation', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  build.configuration.children.push({ itemId: catalog.conflict.id, slotId: 'slot-mount:1', children: [] });
  assert.match(restoreImportedBuild(build, catalog).errors.join(' '), /conflicts/);
});

test('required slots must remain populated', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  build.configuration.children = [];
  assert.match(restoreImportedBuild(build, catalog).errors[0], /required slot/);
});

test('regular and pve builds use their respective catalogs', () => {
  const regular = createCatalog();
  const pve = createCatalog('-pve');
  const results = prepareImportedBuilds({
    builds: [importedBuild(regular), importedBuild(pve, { gameMode: 'pve' })],
    catalogs: new Map([['regular', regular], ['pve', pve]]),
  });
  assert.deepEqual(results.map(result => result.weaponName), ['weapon', 'weapon-pve']);
  assert.deepEqual(results.map(result => result.status), ['ready', 'ready']);
});

test('catalog validation does not mutate imported JSON', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  const before = JSON.stringify(build);
  createImportedBuildSnapshot(build, catalog);
  assert.equal(JSON.stringify(build), before);
});

test('one invalid build does not hide other preview results', () => {
  const catalog = createCatalog();
  const broken = importedBuild(catalog);
  broken.configuration.children[0].itemId = 'missing';
  const results = prepareImportedBuilds({ builds: [broken, importedBuild(catalog)], catalogs: { regular: catalog } });
  assert.deepEqual(results.map(result => result.status), ['error', 'ready']);
});

test('existing identical builds are marked as duplicates and default to skip', () => {
  const catalog = createCatalog();
  const results = prepareImportedBuilds({
    builds: [exportBuild(savedBuild(catalog))],
    catalogs: { regular: catalog },
    existingBuilds: [savedBuild(catalog)],
  });
  assert.equal(results[0].status, 'duplicate');
  assert.equal(results[0].strategy, 'skip');
  assert.equal(results[0].duplicateOf.id, 'saved-1');
});

test('identical builds in the same selected import batch are also duplicates', () => {
  const catalog = createCatalog();
  const build = importedBuild(catalog);
  const results = prepareImportedBuilds({
    builds: [build, structuredClone(build)],
    catalogs: { regular: catalog },
  });
  assert.deepEqual(results.map(result => result.status), ['ready', 'duplicate']);
  assert.equal(results[1].duplicateOf.pendingImport, true);
});

test('an imported snapshot opens through the existing configurator restore path', () => {
  const catalog = createCatalog();
  const imported = createImportedBuildSnapshot(importedBuild(catalog), catalog);
  const restored = restoreBuildParts(imported.snapshot, catalog.modsById);
  assert.deepEqual(restored.missingItemIds, []);
  assert.deepEqual(restored.build.map(part => part.item.id), [catalog.stock.id, catalog.sight.id]);
  assert.equal(restored.build[1].parentItemId, catalog.stock.id);
});

test('safe filenames remove reserved characters and stay bounded', () => {
  const filename = createSafeBuildFilename(`${'A'.repeat(100)}:/?*`);
  assert.ok(filename.endsWith('.json'));
  assert.ok(filename.length <= 85);
  assert.equal(/[<>:"/\\|?*]/.test(filename), false);
});

test('download uses application/json and always revokes the object URL', () => {
  let blob;
  let revoked;
  let clicked = false;
  const link = { style: {}, click: () => { clicked = true; }, remove() {} };
  const environment = {
    document: { createElement: () => link, body: { append() {} } },
    URL: {
      createObjectURL(value) { blob = value; return 'blob:test'; },
      revokeObjectURL(value) { revoked = value; },
    },
  };
  downloadBuildJson(envelope([]), 'build.json', environment);
  assert.equal(blob.type, 'application/json');
  assert.equal(clicked, true);
  assert.equal(revoked, 'blob:test');
});

test('BuildImportError retains a machine-readable error code', () => {
  const error = new BuildImportError('Bad', 'BAD');
  assert.equal(error.code, 'BAD');
});
