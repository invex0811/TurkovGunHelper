import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_SHARE_LIMITS,
  BUILD_SHARE_VERSION,
  BuildImportError,
  copyTextToClipboard,
  createBuildShareUrl,
  decodeBuildShareParam,
  encodeBuildShareParam,
  exportBuild,
  getBuildFingerprint,
  prepareImportedBuilds,
} from '../../src/features/buildTransfer/index.js';
import { createM4a1TransferFixture } from '../fixtures/buildTransferM4a1.js';

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function deflate(text) {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function assertRejectsWithCode(promise, code) {
  await assert.rejects(promise, error => error instanceof BuildImportError && error.code === code);
}

test('a share link round-trips the build hierarchy and settings', async () => {
  const fixture = createM4a1TransferFixture();
  const param = await encodeBuildShareParam(fixture.savedBuild, { catalog: fixture });
  assert.match(param, new RegExp(`^${BUILD_SHARE_VERSION}\\.[A-Za-z0-9_-]+$`));

  const decoded = await decodeBuildShareParam(param);
  assert.equal(decoded.builds.length, 1);
  const [build] = decoded.builds;
  assert.equal(build.name, fixture.savedBuild.name);
  assert.equal(build.gameMode, 'regular');
  assert.equal(
    getBuildFingerprint(build),
    getBuildFingerprint(exportBuild(fixture.savedBuild, { catalog: fixture })),
  );

  const [prepared] = prepareImportedBuilds({ builds: decoded.builds, catalogs: { regular: fixture } });
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.snapshot.parts.length, fixture.savedBuild.parts.length);
});

test('a share link keeps the PvE game mode', async () => {
  const fixture = createM4a1TransferFixture('-pve');
  const decoded = await decodeBuildShareParam(
    await encodeBuildShareParam(fixture.savedBuild, { catalog: fixture }),
  );
  assert.equal(decoded.builds[0].gameMode, 'pve');
});

test('a share link never carries the sender owned items', async () => {
  const fixture = createM4a1TransferFixture();
  const savedBuild = {
    ...fixture.savedBuild,
    ownedItems: [{ key: 'scope', itemId: fixture.ids.scope }],
  };
  const decoded = await decodeBuildShareParam(await encodeBuildShareParam(savedBuild, { catalog: fixture }));
  assert.deepEqual(decoded.builds[0].ownedItems, []);
});

test('a share link stays short enough for chat messages', async () => {
  const fixture = createM4a1TransferFixture();
  const param = await encodeBuildShareParam(fixture.savedBuild, { catalog: fixture });
  assert.ok(param.length < 1000, `expected a short link, got ${param.length} characters`);
});

test('decoding rejects malformed links', async () => {
  await assertRejectsWithCode(decodeBuildShareParam(''), 'INVALID_SHARE_LINK');
  await assertRejectsWithCode(decodeBuildShareParam('abc'), 'UNSUPPORTED_SHARE_VERSION');
  await assertRejectsWithCode(decodeBuildShareParam('9.abc'), 'UNSUPPORTED_SHARE_VERSION');
  await assertRejectsWithCode(decodeBuildShareParam('1.a+b/c'), 'INVALID_SHARE_LINK');
  await assertRejectsWithCode(decodeBuildShareParam('1.bm90LWRlZmxhdGU'), 'INVALID_SHARE_LINK');
});

test('decoding rejects a valid payload that is not a build export', async () => {
  const param = `1.${toBase64Url(await deflate(JSON.stringify({ format: 'other', version: 1, builds: [] })))}`;
  await assertRejectsWithCode(decodeBuildShareParam(param), 'INVALID_FORMAT');
});

test('decoding rejects links with more than one build', async () => {
  const fixture = createM4a1TransferFixture();
  const build = exportBuild(fixture.savedBuild, { catalog: fixture });
  const payload = { format: 'tarkov-gun-helper-builds', version: 1, builds: [build, build] };
  const param = `1.${toBase64Url(await deflate(JSON.stringify(payload)))}`;
  await assertRejectsWithCode(decodeBuildShareParam(param), 'INVALID_SHARE_LINK');
});

test('decoding stops a payload that inflates past the size limit', async () => {
  const bomb = ' '.repeat(BUILD_SHARE_LIMITS.maxJsonBytes + 1);
  const param = `1.${toBase64Url(await deflate(bomb))}`;
  assert.ok(param.length < BUILD_SHARE_LIMITS.maxParamLength);
  await assertRejectsWithCode(decodeBuildShareParam(param), 'SHARE_LINK_TOO_LARGE');
});

test('decoding rejects links longer than the parameter limit', async () => {
  await assertRejectsWithCode(
    decodeBuildShareParam(`1.${'a'.repeat(BUILD_SHARE_LIMITS.maxParamLength)}`),
    'SHARE_LINK_TOO_LARGE',
  );
});

test('the share URL points at the builds route of the current deployment', () => {
  const url = createBuildShareUrl('1.abc', {
    origin: 'https://example.github.io',
    pathname: '/TarkovGunHelper/',
  });
  assert.equal(url, 'https://example.github.io/TarkovGunHelper/#/builds?share=1.abc');
});

test('copying prefers the async clipboard API', async () => {
  const written = [];
  await copyTextToClipboard('link', {
    navigator: { clipboard: { writeText: async text => { written.push(text); } } },
  });
  assert.deepEqual(written, ['link']);
});

test('copying falls back to a selection copy when the clipboard API fails', async () => {
  const appended = [];
  const documentObject = {
    body: { append: element => appended.push(element) },
    createElement: () => ({
      style: {},
      setAttribute() {},
      select() {},
      remove() { this.removed = true; },
    }),
    execCommand: command => command === 'copy',
  };
  await copyTextToClipboard('link', {
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
    document: documentObject,
  });
  assert.equal(appended[0].value, 'link');
  assert.equal(appended[0].removed, true);
});

test('copying hands a pending link to ClipboardItem so the click gesture is kept', async () => {
  const written = [];
  class FakeClipboardItem {
    constructor(items) { this.items = items; }
  }
  let resolveLink;
  const link = new Promise(resolve => { resolveLink = resolve; });
  const copying = copyTextToClipboard(link, {
    ClipboardItem: FakeClipboardItem,
    navigator: { clipboard: { write: async items => { written.push(...items); } } },
  });
  assert.equal(written.length, 1, 'the clipboard write starts before the link is ready');
  resolveLink('https://example.test/#/builds?share=1.abc');
  await copying;
  assert.equal(await written[0].items['text/plain'].then(blob => blob.text()), 'https://example.test/#/builds?share=1.abc');
});
