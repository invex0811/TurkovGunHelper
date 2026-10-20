import { expect, test } from '@playwright/test';
import { mockTarkovApi } from './fixtures/tarkovApi.js';

const SITE_URL = 'https://tarkovgunhelper.com';
const WEAPON_TITLE = 'TW Build – Tarkov Meta & Budget Builds | Tarkov Gun Helper';

test.beforeEach(async ({ page }) => {
  await mockTarkovApi(page);
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('e2e:saved-builds-cleared')) {
      window.localStorage.removeItem('tarkov-gun-helper:saved-builds');
      window.sessionStorage.setItem('e2e:saved-builds-cleared', '1');
    }
    if (!window.localStorage.getItem('tarkovGunHelper.language')) {
      window.localStorage.setItem('tarkovGunHelper.language', 'en');
    }
    if (!window.localStorage.getItem('tarkovGunHelper.priceMode')) {
      window.localStorage.setItem('tarkovGunHelper.priceMode', 'pvp');
    }
  });
});

function getCanonical(html) {
  return html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
}

function getDescription(html) {
  return html.match(/<meta name="description" content="([^"]*)"/)?.[1];
}

test('opens a weapon page directly and after a reload', async ({ page }) => {
  await page.goto('/weapon/test-weapon/');
  await expect(page.getByRole('button', { name: 'Generate Build', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(WEAPON_TITLE);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_URL}/weapon/test-weapon/`);
  await expect(page.getByRole('link', { name: 'Weapons', exact: true })).toHaveClass(/is-active/);

  await page.reload();
  await expect(page).toHaveURL(/\/weapon\/test-weapon\/$/);
  await expect(page.getByRole('button', { name: 'Generate Build', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(WEAPON_TITLE);
});

test('the title follows client-side navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Tarkov Gun Helper - Optimal Weapon Builds');
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'TW', exact: true }) }).click();
  await expect(page).toHaveURL(/\/weapon\/test-weapon\/$/);
  await expect(page).toHaveTitle(WEAPON_TITLE);

  await page.getByRole('link', { name: 'Builds', exact: true }).click();
  await expect(page).toHaveURL(/\/builds\/$/);
  await expect(page).toHaveTitle(/^Saved Weapon Builds/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_URL}/builds/`);

  // A direct load: the app must not put the home title back.
  await page.goto('/module-comparison/');
  await expect(page.getByRole('link', { name: 'Compare modules', exact: true })).toHaveClass(/is-active/);
  await expect(page).toHaveTitle(/^Weapon Mod Comparison/);
  await page.goto('/builds');
  await expect(page).toHaveTitle(/^Saved Weapon Builds/);
  await expect(page.getByRole('link', { name: 'Builds', exact: true })).toHaveClass(/is-active/);
});

test('the old configurator route redirects to the weapon page and keeps the query', async ({ page }) => {
  await page.goto('/configure/weapon-1?build=missing-build');
  await expect(page).toHaveURL(/\/weapon\/test-weapon\/\?build=missing-build$/);
  await expect(page.getByRole('button', { name: 'Generate Build', exact: true })).toBeVisible();

  await page.goto('/#/configure/weapon-2');
  await expect(page).toHaveURL(/\/weapon\/second-test-weapon\/$/);
  await expect(page.getByRole('button', { name: 'Generate Build', exact: true })).toBeVisible();
});

test('an unknown address and an unknown weapon show "not found" with a way back', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Page Not Found | Tarkov Gun Helper');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

  await page.goto('/weapon/no-such-weapon/');
  await expect(page.getByText('Weapon not found', { exact: true })).toBeVisible();
  await expect(page.getByText('Weapon loading failed')).toHaveCount(0);
  await expect(page).toHaveTitle('Page Not Found | Tarkov Gun Helper');

  await page.getByRole('link', { name: 'Go to the weapon catalog', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('Tarkov Gun Helper - Optimal Weapon Builds');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_URL}/`);
});

test('old hash links open the same page on a real path', async ({ page }) => {
  await page.goto('/#/settings#traders');
  await expect(page).toHaveURL(/\/settings\/#traders$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.goto('/#/module-comparison');
  await expect(page).toHaveURL(/\/module-comparison\/$/);
  await expect(page.getByRole('link', { name: 'Compare modules', exact: true })).toHaveClass(/is-active/);
});

test('an old #/builds?share= link still imports the build', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/weapon/test-weapon/');
  await page.getByRole('button', { name: 'Generate Build', exact: true }).click();
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })).toBeVisible();
  await page.getByLabel('Build name').fill('Legacy link build');
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByText('Link copied', { exact: true })).toBeVisible();
  const shareLink = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const legacyLink = `${shareLink.origin}/#/builds${shareLink.search}`;

  await page.goto(legacyLink);
  await expect(page).toHaveURL(/\/builds\/\?share=1\.[A-Za-z0-9_-]+$/);
  const sharedDialog = page.getByRole('dialog', { name: 'Shared build', exact: true });
  await expect(sharedDialog.getByText('Ready to import', { exact: true })).toBeVisible();
  await sharedDialog.getByRole('button', { name: 'Save to my builds', exact: true }).click();
  await sharedDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('article[role="link"]').filter({ hasText: 'Legacy link build' })).toBeVisible();
});

test('the home and weapon pages carry their meta in the HTML itself', async ({ request }) => {
  const home = await (await request.get('/')).text();
  expect(home).toContain('<title>Tarkov Gun Helper - Optimal Weapon Builds</title>');
  expect(getDescription(home)).toMatch(/Escape from Tarkov weapon builds/);
  expect(getCanonical(home)).toBe(`${SITE_URL}/`);
  expect(home).toContain('"@type": "WebApplication"');
  expect(home).toMatch(/<div id="root"><!--prerender-->[\s\S]*<h1[^>]*>/);
  const homeWeaponLinks = home.match(/<a href="\/weapon\/[^"]+\/">/g) ?? [];

  const sitemap = await (await request.get('/sitemap.xml')).text();
  const weaponUrl = sitemap.match(/<loc>(https:\/\/tarkovgunhelper\.com\/weapon\/[^<]+\/)<\/loc>/)?.[1];
  expect(weaponUrl).toBeTruthy();
  expect(sitemap).toContain(`<loc>${SITE_URL}/builds/</loc>`);
  expect(homeWeaponLinks.length).toBe(sitemap.match(/<loc>[^<]+\/weapon\//g).length);
  expect(home).toContain(`<a href="${new URL(weaponUrl).pathname}">`);

  const weaponResponse = await request.get(new URL(weaponUrl).pathname);
  expect(weaponResponse.status()).toBe(200);
  const weaponPage = await weaponResponse.text();
  expect(weaponPage).toMatch(/<title>[^<]+ Build – Tarkov Meta &amp; Budget Builds \| Tarkov Gun Helper<\/title>/);
  expect(getDescription(weaponPage)).toMatch(/^Optimal .+ builds for Escape from Tarkov/);
  expect(getCanonical(weaponPage)).toBe(weaponUrl);
  expect(weaponPage).toContain(`<meta property="og:url" content="${weaponUrl}" />`);
  expect(weaponPage).toMatch(/<h1 class="page-title">[^<]+ build<\/h1>/);
  expect(weaponPage).not.toMatch(/(?:src|href)="\.\//);
  expect(weaponPage).toMatch(/<script type="module" crossorigin src="\/assets\//);

  // The fallback for unknown paths stays the plain shell, without the list.
  const notFound = await (await request.get('/404.html')).text();
  expect(notFound).not.toContain('prerender__weapons');
  expect(notFound).toContain('<h1 class="page-title">');

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
});
