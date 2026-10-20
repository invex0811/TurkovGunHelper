// Builds the static HTML of one page from the built dist/index.html. Every
// replacement must match exactly once, so a changed template fails the build
// instead of shipping pages with the home page's title.
import { getCanonicalUrl, SITE_NAME, SITE_URL } from '../../src/features/seo/pageMeta.js';
import { interpolateMessage } from '../../src/i18n/interpolate.js';
import { messages } from '../../src/i18n/messages.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ESCAPES[character]);
}

function replaceOnce(html, pattern, replacement, label) {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
  if (matches?.length !== 1) {
    throw new Error(`Expected one ${label} in dist/index.html, found ${matches?.length ?? 0}.`);
  }
  return html.replace(pattern, () => replacement);
}

function setMeta(html, attribute, key, content) {
  return replaceOnce(
    html,
    new RegExp(`<meta ${attribute}="${key}" content="[^"]*"\\s*/?>`),
    `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`,
    `${key} meta tag`,
  );
}

// The static pages are in English, with the app's own English texts, so a
// heading or intro reads the same before and after the app renders.
export function appText(key, values) {
  const message = messages.en[key];
  if (message === undefined) throw new Error(`No English message "${key}".`);
  return interpolateMessage(message, values, 'en');
}

function renderJsonLd(data) {
  // "<" as a JSON escape, so text from the catalog cannot close the script.
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `\n    <script type="application/ld+json">\n${json.replace(/^/gm, '      ')}\n    </script>`;
}

// Relative asset paths would break on nested pages such as /weapon/<slug>/.
export function assertAbsoluteAssetPaths(html, file = 'dist/index.html') {
  const relative = html.match(/\s(?:src|href)="\.{1,2}\/[^"]*"/);
  if (relative) throw new Error(`${file} references a relative path:${relative[0]}`);
}

// jsonLd: the page's structured data, replacing the home page's block; the
// block is dropped when there is none.
export function renderPage(template, { meta, body, jsonLd = null }) {
  const url = getCanonicalUrl(meta.path);
  let html = template;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`, 'title');
  html = setMeta(html, 'name', 'description', meta.description);
  const robots = meta.noindex ? '<meta name="robots" content="noindex" />\n    ' : '';
  html = replaceOnce(
    html,
    /<link rel="canonical" href="[^"]*"\s*\/?>/,
    `${robots}<link rel="canonical" href="${escapeHtml(url)}" />`,
    'canonical link',
  );
  html = setMeta(html, 'property', 'og:title', meta.title);
  html = setMeta(html, 'property', 'og:description', meta.description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'name', 'twitter:title', meta.title);
  html = setMeta(html, 'name', 'twitter:description', meta.description);
  html = replaceOnce(
    html,
    /\s*<!--json-ld-->[\s\S]*?<!--\/json-ld-->/,
    jsonLd ? `\n    <!--json-ld-->${renderJsonLd(jsonLd)}\n    <!--/json-ld-->` : '',
    'JSON-LD block',
  );
  return replaceOnce(
    html,
    /<!--prerender-->[\s\S]*?<!--\/prerender-->/,
    `<!--prerender-->${body}<!--/prerender-->`,
    'prerender block',
  );
}

// The same header and layout classes as the app, see .prerender__main.
// headingHtml: a ready <h1>, for a heading with inner markup.
export function renderStaticBody({ eyebrow, heading, headingHtml, paragraphs, links }) {
  const linkHtml = links
    .map(link => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join(' · ');
  return [
    '<div class="prerender">',
    '      <header class="topbar">',
    `        <a href="/" class="brand"><img class="brand__mark" src="/tgh-logo-96.png" alt="" width="36" height="36" /><span class="brand__name">${escapeHtml(SITE_NAME)}</span></a>`,
    '      </header>',
    '      <main class="app__main prerender__main">',
    `        <p class="eyebrow-mono">${escapeHtml(eyebrow)}</p>`,
    headingHtml ? `        ${headingHtml}` : `        <h1 class="page-title">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map(text => `        <p>${escapeHtml(text)}</p>`),
    `        <p>${linkHtml}</p>`,
    '      </main>',
    '    </div>',
  ].join('\n');
}

// "Assault rifle" → "assault rifle", "SMG" stays as is.
function lowerTypeName(type) {
  return type.split(' ').map(word => (word === word.toUpperCase() ? word : word.toLowerCase())).join(' ');
}

// The heading is the app's one (ConfiguratorHero): the short name large,
// then "<full name> build" in the same <h1>, with the same classes.
export function renderWeaponHeading({ name, shortName }) {
  const fullName = name || shortName;
  return '<h1 class="config-hero__title">'
    + `<span class="config-hero__short-name">${escapeHtml(shortName || fullName)}</span> `
    + `<span class="config-hero__full-name">${escapeHtml(appText('config.heroHeading', { weapon: fullName }))}</span>`
    + '</h1>';
}

export function renderWeaponBody({ name, shortName, caliber, type }) {
  const subject = type ? `This ${lowerTypeName(type)}` : 'This weapon';
  const ammo = caliber ? `${subject} is chambered in ${caliber}. ` : '';
  return renderStaticBody({
    eyebrow: [type, caliber].filter(Boolean).join(' · ') || 'Escape from Tarkov weapon',
    headingHtml: renderWeaponHeading({ name, shortName }),
    paragraphs: [
      appText('config.heroIntro', { weapon: shortName || name }),
      `${ammo}On this page you can generate a build, swap any module by hand, compare recoil, `
        + 'ergonomics, weight and price, save the build in your browser and share it as a link.',
    ],
    links: [
      { href: '/', label: 'All weapons' },
      { href: '/builds/', label: 'Saved builds' },
    ],
  });
}

const UNTYPED_GROUP = 'Other weapons';

// Links to every weapon page for the static home page, one <h2> per weapon
// type. Weapons: { name, type, path }.
export function renderWeaponLinks(weapons) {
  const groups = new Map();
  for (const weapon of weapons) {
    const type = weapon.type || UNTYPED_GROUP;
    groups.set(type, [...(groups.get(type) || []), weapon]);
  }
  const types = [...groups.keys()].sort((a, b) => {
    if (a === UNTYPED_GROUP || b === UNTYPED_GROUP) return a === UNTYPED_GROUP ? 1 : -1;
    return a.localeCompare(b, 'en');
  });
  const sections = types.map(type => {
    const items = groups.get(type)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map(weapon => `            <li><a href="${escapeHtml(weapon.path)}">${escapeHtml(weapon.name)}</a></li>`);
    return [
      '          <section class="prerender__group">',
      `            <h2>${escapeHtml(type)}</h2>`,
      '            <ul>',
      ...items,
      '            </ul>',
      '          </section>',
    ].join('\n');
  });
  return ['<div class="prerender__weapons">', ...sections, '        </div>'].join('\n');
}

export function insertWeaponLinks(template, linksHtml) {
  return replaceOnce(template, /<!--weapon-links-->/, linksHtml, 'weapon links marker');
}

// Pages: a path, or { path, lastmod } with lastmod as YYYY-MM-DD.
export function renderSitemap(pages) {
  const entries = pages.map(page => {
    const { path, lastmod } = typeof page === 'string' ? { path: page } : page;
    const lastmodTag = lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : '';
    return `  <url><loc>${escapeHtml(getCanonicalUrl(path))}</loc>${lastmodTag}</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}
