import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeWeapon,
  getStaticRouteMeta,
  getWeaponPageMeta,
  HOME_META,
  STATIC_PAGE_META,
} from '../../src/features/seo/pageMeta.js';

test('the weapon title and description name the weapon and its caliber', () => {
  const meta = getWeaponPageMeta({ name: 'Colt M4A1 5.56x45 assault rifle', caliber: '5.56x45 NATO', slug: 'colt-m4a1' });
  assert.equal(meta.path, '/weapon/colt-m4a1/');
  assert.equal(meta.title, 'Colt M4A1 5.56x45 assault rifle Build – Meta & Budget Builds | Tarkov Gun Helper');
  assert.match(meta.description, /^Optimal Colt M4A1 5\.56x45 assault rifle \(5\.56x45 NATO\) builds/);
  assert.match(meta.description, /flea market and trader/);
  assert.match(meta.description, /PvP and PvE/);
});

test('a catalog weapon is described with readable labels', () => {
  const weapon = {
    name: 'Colt M4A1 5.56x45 assault rifle',
    shortName: 'M4A1',
    properties: { caliber: 'Caliber556x45NATO' },
    categories: [{ id: 'x', name: 'Assault rifle', normalizedName: 'assault-rifle' }],
  };
  assert.deepEqual(describeWeapon(weapon), {
    name: 'Colt M4A1 5.56x45 assault rifle',
    shortName: 'M4A1',
    caliber: '5.56x45 NATO',
    type: 'Assault rifle',
  });
});

test('section pages have their own meta with or without the trailing slash', () => {
  assert.equal(getStaticRouteMeta('/'), HOME_META);
  assert.equal(getStaticRouteMeta('/builds'), STATIC_PAGE_META['/builds/']);
  assert.equal(getStaticRouteMeta('/builds/'), STATIC_PAGE_META['/builds/']);
  assert.equal(getStaticRouteMeta('/settings/'), STATIC_PAGE_META['/settings/']);
  assert.equal(getStaticRouteMeta('/module-comparison'), STATIC_PAGE_META['/module-comparison/']);
});

test('weapon routes wait for the weapon; unknown paths use the home meta', () => {
  assert.equal(getStaticRouteMeta('/weapon/colt-m4a1/'), null);
  assert.equal(getStaticRouteMeta('/configure/5447a9cd'), null);
  assert.equal(getStaticRouteMeta('/no-such-page'), HOME_META);
});
