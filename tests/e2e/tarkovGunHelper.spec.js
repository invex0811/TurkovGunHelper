import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockTarkovApi } from './fixtures/tarkovApi.js';

const SAVED_BUILDS_KEY = 'tarkov-gun-helper:saved-builds';
const LANGUAGE_KEY = 'tarkovGunHelper.language';

test.beforeEach(async ({ page }) => {
  await mockTarkovApi(page);
  await page.addInitScript(({ languageKey, savedBuildsKey }) => {
    window.localStorage.removeItem(savedBuildsKey);
    window.localStorage.setItem(languageKey, 'en');
  }, {
    languageKey: LANGUAGE_KEY,
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
