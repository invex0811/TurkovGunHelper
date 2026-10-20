import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertAbsoluteAssetPaths,
  escapeHtml,
  insertWeaponLinks,
  renderPage,
  renderRobots,
  renderSitemap,
  renderWeaponBody,
  renderWeaponLinks,
} from '../../scripts/lib/prerenderHtml.mjs';
import { getWeaponPageMeta, HOME_META } from '../../src/features/seo/pageMeta.js';
import { messages } from '../../src/i18n/messages.js';

const template = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const weapon = {
  name: 'Colt M4A1 5.56x45 assault rifle',
  shortName: 'M4A1',
  caliber: '5.56x45 NATO',
  type: 'Assault rifle',
};

test('index.html carries the home meta the app sets', () => {
  assert.match(template, new RegExp(`<title>${HOME_META.title}</title>`));
  assert.ok(template.includes(`<meta name="description" content="${HOME_META.description}" />`));
  assert.ok(template.includes('<link rel="canonical" href="https://tarkovgunhelper.com/" />'));
  assert.ok(template.includes('"@type": "WebApplication"'));
  assert.match(template, /<div id="root"><!--prerender-->[\s\S]*<h1 class="page-title">/);
});

test('the static home heading and intro are the ones the app shows', () => {
  const block = template.match(/<!--prerender-->([\s\S]*)<!--\/prerender-->/)[1];
  assert.equal(block.match(/<h1 class="page-title">([^<]+)<\/h1>/)[1], messages.en['home.selectWeapon']);
  assert.equal(block.match(/<\/h1>\s*<p>([^<]+)<\/p>/)[1], messages.en['home.intro']);
});

test('a weapon page replaces the title, meta, canonical and static text', () => {
  const meta = getWeaponPageMeta({ ...weapon, slug: 'colt-m4a1-556x45-assault-rifle' });
  assert.equal(meta.title, 'M4A1 Build – Tarkov Meta & Budget Builds | Tarkov Gun Helper');
  const html = renderPage(template, { meta, body: renderWeaponBody(weapon) });
  const url = 'https://tarkovgunhelper.com/weapon/colt-m4a1-556x45-assault-rifle/';
  assert.ok(html.includes(`<title>${escapeHtml(meta.title)}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${escapeHtml(meta.description)}" />`));
  assert.ok(html.includes(`<link rel="canonical" href="${url}" />`));
  assert.ok(html.includes(`<meta property="og:url" content="${url}" />`));
  assert.ok(html.includes(`<meta property="og:title" content="${escapeHtml(meta.title)}" />`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  // The same heading and intro as the app's ConfiguratorHero.
  assert.ok(html.includes(
    '<h1 class="config-hero__title"><span class="config-hero__short-name">M4A1</span> '
      + '<span class="config-hero__full-name">Colt M4A1 5.56x45 assault rifle build</span></h1>',
  ));
  assert.ok(html.includes(`<p>${messages.en['config.heroIntro'].replace('{weapon}', 'M4A1')}</p>`));
  assert.ok(html.includes('This assault rifle is chambered in 5.56x45 NATO.'));
  assert.ok(!html.includes('application/ld+json'), 'the WebApplication data stays on the home page');
  assert.ok(!html.includes(messages.en['home.intro']), 'the home text is gone');
  assert.ok(!html.includes('<!--weapon-links-->'), 'the weapon list marker belongs to the home text');
});

test('the home page lists every weapon page grouped by type', () => {
  const links = renderWeaponLinks([
    { name: 'Glock 17 9x19 pistol', type: 'Handgun', path: '/weapon/glock-17/' },
    { name: 'Colt M4A1 5.56x45 assault rifle', type: 'Assault rifle', path: '/weapon/colt-m4a1/' },
    { name: 'AK-74N 5.45x39 assault rifle', type: 'Assault rifle', path: '/weapon/ak-74n/' },
    { name: 'Toy <gun> & "co"', type: '', path: '/weapon/toy/' },
  ]);
  const html = insertWeaponLinks(template, links);
  const block = html.match(/<!--prerender-->([\s\S]*)<!--\/prerender-->/)[1];
  assert.ok(!html.includes('<!--weapon-links-->'));
  assert.deepEqual([...block.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]), ['Assault rifle', 'Handgun', 'Other weapons']);
  assert.deepEqual([...block.matchAll(/<a href="(\/weapon\/[^"]+)">/g)].map(match => match[1]), [
    '/weapon/ak-74n/',
    '/weapon/colt-m4a1/',
    '/weapon/glock-17/',
    '/weapon/toy/',
  ]);
  assert.ok(block.includes('<a href="/weapon/toy/">Toy &lt;gun&gt; &amp; &quot;co&quot;</a>'));
  assert.ok(block.indexOf('prerender__weapons') > block.indexOf('<h1'), 'the list follows the intro');
});

test('text from the catalog is escaped', () => {
  const body = renderWeaponBody({ ...weapon, name: '<b>"Gun" & co</b>' });
  assert.ok(body.includes('&lt;b&gt;&quot;Gun&quot; &amp; co&lt;/b&gt; build'));
});

test('a changed template fails instead of producing wrong pages', () => {
  assert.throws(
    () => renderPage(template.replace(/<link rel="canonical"[^>]*>/, ''), { meta: HOME_META, body: '' }),
    /canonical link/,
  );
});

test('relative asset paths are rejected', () => {
  assert.throws(() => assertAbsoluteAssetPaths('<script src="./assets/index.js"></script>'), /relative path/);
  assert.doesNotThrow(() => assertAbsoluteAssetPaths('<script src="/assets/index.js"></script>'));
});

test('the sitemap lists canonical URLs and robots.txt points at it', () => {
  assert.equal(
    renderSitemap(['/', '/weapon/a/']),
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + '  <url><loc>https://tarkovgunhelper.com/</loc></url>\n'
      + '  <url><loc>https://tarkovgunhelper.com/weapon/a/</loc></url>\n'
      + '</urlset>\n',
  );
  assert.equal(renderRobots(), 'User-agent: *\nAllow: /\n\nSitemap: https://tarkovgunhelper.com/sitemap.xml\n');
});
