import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  describeWeapon,
  getAmbiguousShortNames,
  getStaticRouteMeta,
  getWeaponPageMeta,
  HOME_META,
  STATIC_PAGE_META,
} from '../../src/features/seo/pageMeta.js';

test('the weapon title uses the short name; the description names the weapon and its caliber', () => {
  const meta = getWeaponPageMeta({
    name: 'Colt M4A1 5.56x45 assault rifle',
    shortName: 'M4A1',
    caliber: '5.56x45 NATO',
    slug: 'colt-m4a1',
  });
  assert.equal(meta.path, '/weapon/colt-m4a1/');
  assert.equal(meta.title, 'M4A1 Build – Tarkov Meta & Budget Builds | Tarkov Gun Helper');
  assert.equal(meta.title.length, 60);
  assert.match(meta.description, /^Optimal Colt M4A1 5\.56x45 assault rifle \(5\.56x45 NATO\) builds/);
  assert.match(meta.description, /flea market and trader/);
  assert.match(meta.description, /PvP and PvE/);
});

test('a short name several weapons share falls back to the full name', () => {
  const weapons = [
    { name: 'Desert Tech MDR 5.56x45 assault rifle', shortName: 'MDR' },
    { name: 'Desert Tech MDR 7.62x51 assault rifle', shortName: 'mdr ' },
    { name: 'Colt M4A1 5.56x45 assault rifle', shortName: 'M4A1' },
  ];
  const ambiguousShortNames = getAmbiguousShortNames(weapons);
  assert.deepEqual([...ambiguousShortNames], ['mdr']);
  assert.equal(
    getWeaponPageMeta({ ...weapons[0], slug: 'mdr' }, { ambiguousShortNames }).title,
    'Desert Tech MDR 5.56x45 assault rifle Build – Tarkov Meta & Budget Builds | Tarkov Gun Helper',
  );
  assert.match(getWeaponPageMeta({ ...weapons[2], slug: 'm4' }, { ambiguousShortNames }).title, /^M4A1 Build/);
});

test('a weapon without a short name is titled by its full name', () => {
  assert.match(getWeaponPageMeta({ name: 'Some gun', shortName: '', slug: 'x' }).title, /^Some gun Build/);
});

test('every weapon in the snapshot gets its own title', async () => {
  const { weapons } = JSON.parse(await readFile(new URL('../../scripts/data/weapons-snapshot.json', import.meta.url), 'utf8'));
  const ambiguousShortNames = getAmbiguousShortNames(weapons);
  const titles = weapons.map((weapon, index) => getWeaponPageMeta({ ...weapon, slug: String(index) }, { ambiguousShortNames }).title);
  assert.equal(new Set(titles).size, weapons.length);
  const lengths = titles.map(title => title.length).sort((a, b) => a - b);
  assert.ok(lengths[Math.floor(lengths.length / 2)] <= 62, 'a typical title stays near 60 characters');
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

test('weapon routes wait for the weapon; unknown paths leave the meta to the not-found page', () => {
  assert.equal(getStaticRouteMeta('/weapon/colt-m4a1/'), null);
  assert.equal(getStaticRouteMeta('/configure/5447a9cd'), null);
  assert.equal(getStaticRouteMeta('/no-such-page'), null);
});
