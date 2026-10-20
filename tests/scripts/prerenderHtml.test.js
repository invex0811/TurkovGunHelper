import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertAbsoluteAssetPaths,
  escapeHtml,
  renderPage,
  renderRobots,
  renderSitemap,
  renderWeaponBody,
} from '../../scripts/lib/prerenderHtml.mjs';
import { getWeaponPageMeta, HOME_META } from '../../src/features/seo/pageMeta.js';

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

test('a weapon page replaces the title, meta, canonical and static text', () => {
  const meta = getWeaponPageMeta({ ...weapon, slug: 'colt-m4a1-556x45-assault-rifle' });
  const html = renderPage(template, { meta, body: renderWeaponBody(weapon) });
  const url = 'https://tarkovgunhelper.com/weapon/colt-m4a1-556x45-assault-rifle/';
  assert.ok(html.includes(`<title>${escapeHtml(meta.title)}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${escapeHtml(meta.description)}" />`));
  assert.ok(html.includes(`<link rel="canonical" href="${url}" />`));
  assert.ok(html.includes(`<meta property="og:url" content="${url}" />`));
  assert.ok(html.includes(`<meta property="og:title" content="${escapeHtml(meta.title)}" />`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  assert.ok(html.includes('<h1 class="page-title">Colt M4A1 5.56x45 assault rifle build</h1>'));
  assert.ok(html.includes('This assault rifle is chambered in 5.56x45 NATO.'));
  assert.ok(!html.includes('application/ld+json'), 'the WebApplication data stays on the home page');
  assert.ok(!html.includes('Escape from Tarkov weapon build generator'), 'the home text is gone');
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
