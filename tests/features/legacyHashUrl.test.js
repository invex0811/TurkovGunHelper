import test from 'node:test';
import assert from 'node:assert/strict';
import { getLegacyHashRedirect, redirectLegacyHashUrl } from '../../src/features/routing/legacyHashUrl.js';

const at = hash => ({ pathname: '/', search: '', hash });

test('a shared build link keeps its query on the builds page', () => {
  assert.equal(getLegacyHashRedirect(at('#/builds?share=1.ab_c-d')), '/builds/?share=1.ab_c-d');
});

test('the configurator link keeps the weapon id and the saved build', () => {
  assert.equal(
    getLegacyHashRedirect(at('#/configure/5447a9cd4bdc2dbd208b4567?build=abc')),
    '/configure/5447a9cd4bdc2dbd208b4567?build=abc',
  );
});

test('an anchor after the route survives', () => {
  assert.equal(getLegacyHashRedirect(at('#/settings#traders')), '/settings/#traders');
});

test('the catalog with filters stays on the home page', () => {
  assert.equal(getLegacyHashRedirect(at('#/?type=Handgun')), '/?type=Handgun');
  assert.equal(getLegacyHashRedirect(at('#/')), '/');
});

test('plain anchors and empty hashes are not legacy routes', () => {
  assert.equal(getLegacyHashRedirect(at('#traders')), null);
  assert.equal(getLegacyHashRedirect(at('')), null);
});

test('the target never leaves the site', () => {
  assert.equal(getLegacyHashRedirect(at('#//evil.example/builds')), '/builds/');
  assert.equal(getLegacyHashRedirect(at('#/.//evil.example')), '/evil.example');
});

test('the redirect replaces the history entry', () => {
  const calls = [];
  const win = {
    location: at('#/module-comparison'),
    history: { state: { idx: 0 }, replaceState: (...args) => calls.push(args) },
  };
  assert.equal(redirectLegacyHashUrl(win), true);
  assert.deepEqual(calls, [[{ idx: 0 }, '', '/module-comparison/']]);
  assert.equal(redirectLegacyHashUrl({ location: at('#traders'), history: win.history }), false);
});
