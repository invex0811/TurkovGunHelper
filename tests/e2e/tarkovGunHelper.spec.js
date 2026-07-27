import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockTarkovApi } from './fixtures/tarkovApi.js';

const SAVED_BUILDS_KEY = 'tarkov-gun-helper:saved-builds';
const LANGUAGE_KEY = 'tarkovGunHelper.language';
const PRICE_MODE_KEY = 'tarkovGunHelper.priceMode';

test.beforeEach(async ({ page }) => {
  await mockTarkovApi(page);
  await page.addInitScript(({ languageKey, priceModeKey, savedBuildsKey }) => {
    window.localStorage.removeItem(savedBuildsKey);
    if (!window.localStorage.getItem(languageKey)) {
      window.localStorage.setItem(languageKey, 'en');
    }
    if (!window.localStorage.getItem(priceModeKey)) {
      window.localStorage.setItem(priceModeKey, 'pvp');
    }
  }, {
    languageKey: LANGUAGE_KEY,
    priceModeKey: PRICE_MODE_KEY,
    savedBuildsKey: SAVED_BUILDS_KEY,
  });
});

async function createBuild(page) {
  await page.goto('/');
  await page.getByRole('link').filter({
    has: page.getByRole('heading', { name: 'TW', exact: true }),
  }).click();

  await expect(page).toHaveURL(/#\/configure\/weapon-1$/);
  await page.getByRole('button', { name: 'Generate Build', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save build', exact: true })).toBeVisible();
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })).toBeVisible();
}

async function saveBuild(page, name) {
  await page.getByLabel('Build name').fill(name);
  await page.getByRole('button', { name: 'Save build', exact: true }).click();
  await expect(page.getByText('Build saved locally.', { exact: true })).toBeVisible();
}

async function openSavedBuild(page, name) {
  await page.getByRole('link', { name: 'Builds', exact: true }).click();
  const card = page.locator('article[role="link"]').filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.focus();
  await card.press('Enter');
  await expect(page.getByLabel('Build name')).toHaveValue(name);
}

test('creates a weapon build from the catalog', async ({ page }) => {
  await createBuild(page);

  await expect(page.getByRole('heading', { name: 'TW', exact: true })).toBeVisible();
  await expect(page.getByText('Est. Build Price', { exact: true })).toBeVisible();
});

test('settings page persists interface and separate trader level profiles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open settings' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Trader levels for PvP', { exact: true })).toBeVisible();

  const praporLevel = page.getByRole('combobox', { name: 'Prapor: Loyalty level' });
  await praporLevel.selectOption('3');
  await page.locator('header').getByRole('group', { name: 'Price mode' })
    .getByRole('button', { name: 'PvE', exact: true }).click();
  await expect(page.getByText('Trader levels for PvE', { exact: true })).toBeVisible();
  await expect(praporLevel).toHaveValue('1');

  await page.getByRole('group', { name: 'Theme' })
    .getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('group', { name: 'Language' })
    .getByRole('button', { name: 'RU', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  const storedProfiles = await page.evaluate(() => (
    JSON.parse(localStorage.getItem('tarkovGunHelper.traderLevels')).profiles
  ));
  expect(storedProfiles.pvp['trader-1']).toBe(3);
  expect(storedProfiles.pve['trader-1']).toBeUndefined();
});

test('header price switch persists without resetting Home or the current build', async ({ page }) => {
  let regularItemsRequests = 0;
  page.on('request', request => {
    if (request.url().endsWith('/regular/items')) regularItemsRequests += 1;
  });
  await page.goto('/');
  const priceModeGroup = page.locator('header').getByRole('group', { name: 'Price mode' });
  await expect(priceModeGroup.getByRole('button', { name: 'PvP', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('searchbox', { name: 'Search weapons' }).fill('TW');
  const homeUrl = page.url();
  const requestsBeforeSwitch = regularItemsRequests;
  await priceModeGroup.getByRole('button', { name: 'PvE', exact: true }).click();
  await expect(priceModeGroup.getByRole('button', { name: 'PvE', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox', { name: 'Search weapons' })).toHaveValue('TW');
  await expect(page.getByRole('heading', { name: 'TW', exact: true })).toBeVisible();
  expect(page.url()).toBe(homeUrl);
  expect(regularItemsRequests).toBe(requestsBeforeSwitch);

  await page.getByRole('link').filter({
    has: page.getByRole('heading', { name: 'TW', exact: true }),
  }).click();
  await page.getByRole('button', { name: 'Generate Build', exact: true }).click();
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })).toBeVisible();
  const priceBefore = await page.locator('.price-amount').innerText();
  const statsBefore = await page.locator('.stat-compare').innerText();
  await priceModeGroup.getByRole('button', { name: 'PvP', exact: true }).click();
  await expect(page.getByText('Price mode changed', { exact: true })).toBeVisible();
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })).toBeVisible();
  await expect(page.locator('.price-amount')).not.toHaveText(priceBefore);
  expect(await page.locator('.stat-compare').innerText()).toBe(statsBefore);
  await expect(page.locator('.config').getByText('Price Mode', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(priceModeGroup.getByRole('button', { name: 'PvP', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'TW', exact: true })).toBeVisible();
});

test('provides an installable manifest and restores the catalog offline', async ({ page, context, request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: 'Tarkov Gun Helper',
    display: 'standalone',
    start_url: './',
    scope: './',
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512' }),
  ]));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TW', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBeTruthy();
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tarkov-gun-helper', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('catalogs', 'readwrite');
    const store = transaction.objectStore('catalogs');
    const records = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    records.forEach(record => store.put({ ...record, expiresAt: 0 }));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tarkov-gun-helper', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('catalogs', 'readonly');
    const records = await new Promise((resolve, reject) => {
      const request = transaction.objectStore('catalogs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records.every(record => record.expiresAt === 0);
  })).toBeTruthy();

  await page.unroute('https://json.tarkov.dev/**');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'TW', exact: true })).toBeVisible();
  await expect(page.getByText(/Previously saved data is in use|Data may be outdated|Saved data is in use/)).toBeVisible();
  await context.setOffline(false);
});

test('replaces a part, saves the build, and restores it', async ({ page }) => {
  await createBuild(page);

  const starterPart = page.locator('.part-card').filter({ hasText: 'Starter Grip' });
  await starterPart.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Replace Part', exact: true })).toBeVisible();
  await page.getByText('Alternative Grip', { exact: true }).click();
  await expect(page.locator('.part-card').filter({ hasText: 'Alternative Grip' })).toBeVisible();

  await saveBuild(page, 'Replacement build');
  await openSavedBuild(page, 'Replacement build');

  await expect(page.locator('.part-card').filter({ hasText: 'Alternative Grip' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update saved build', exact: true })).toBeVisible();
});

test('exports, deletes, imports, and opens a saved build', async ({ page }) => {
  await createBuild(page);
  await saveBuild(page, 'Portable build');

  await page.getByRole('link', { name: 'Builds', exact: true }).click();
  const card = page.locator('article[role="link"]').filter({ hasText: 'Portable build' });
  await expect(card).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const exportedBuild = await readFile(await download.path());

  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: /Delete “Portable build”/ });
  await deleteDialog.getByRole('button', { name: 'Delete build', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No saved builds yet', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('#buildImportFiles').setInputFiles({
    name: 'portable-build.json',
    mimeType: 'application/json',
    buffer: exportedBuild,
  });
  await expect(page.getByText('Ready to import', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1', exact: true }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await openSavedBuild(page, 'Portable build');
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })).toBeVisible();
});
