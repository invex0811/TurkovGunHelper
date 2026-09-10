import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockTarkovApi } from './fixtures/tarkovApi.js';

const SAVED_BUILDS_KEY = 'tarkov-gun-helper:saved-builds';
const LANGUAGE_KEY = 'tarkovGunHelper.language';
const PRICE_MODE_KEY = 'tarkovGunHelper.priceMode';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

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

async function expectOpenModalContract(page, dialog, trigger) {
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement)))
    .toBe(true);
  await expect.poll(() => trigger.evaluate(element => Boolean(element.closest('[inert]'))))
    .toBe(true);
  await expect.poll(() => dialog.evaluate(element => Boolean(element.closest('[inert]'))))
    .toBe(false);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .toBe('hidden');

  const focusable = dialog.locator(FOCUSABLE_SELECTOR);
  const focusableCount = await focusable.count();
  expect(focusableCount).toBeGreaterThan(0);
  const first = focusable.first();
  const last = focusable.last();

  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();

  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
}

async function expectEscapeRestoresModal(page, dialog, trigger, bodyOverflowBefore) {
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => trigger.evaluate(element => Boolean(element.closest('[inert]'))))
    .toBe(false);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .toBe(bodyOverflowBefore);
}

test('creates a weapon build from the catalog', async ({ page }) => {
  await createBuild(page);

  await expect(page.locator('.weapon').getByRole('heading', { name: 'TW', exact: true })).toBeVisible();
  await expect(page.getByText(/^Remaining to buy/)).toBeVisible();
  await expect(page.locator('.stat-compare').getByText('Accuracy', { exact: true })).toBeVisible();
  await expect(page.locator('.stat-compare').getByText('2.17 MOA', { exact: true })).toBeVisible();
  const accuracyRow = page.locator('.stat-compare .stat-row--lower-is-better.stat-row--inverted-fill').filter({
    hasText: 'Accuracy',
  });
  await expect(accuracyRow).toBeVisible();
  await expect(accuracyRow.locator('.bar__gradient')).toHaveAttribute(
    'style',
    /--meter-value: 91\.32%/,
  );
  await expect(page.locator('.stat-compare [role="meter"][aria-label="Accuracy"]'))
    .toHaveAttribute('aria-valuenow', '2.17');
});

test('build goal modes preserve their state and calculator settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link').filter({
    has: page.getByRole('heading', { name: 'TW', exact: true }),
  }).click();

  const config = page.locator('.config');
  const goalGroup = config.getByRole('group', { name: 'Build Goal' });
  const metaButton = goalGroup.getByRole('button', { name: 'Meta', exact: true });
  const constraintsButton = goalGroup.getByRole('button', { name: 'By constraints', exact: true });
  const prioritiesButton = goalGroup.getByRole('button', { name: 'By priorities', exact: true });
  const expectGenerateButtonGreen = async () => {
    const generateButton = config.getByRole('button', { name: 'Generate Build', exact: true });
    await expect(generateButton).toHaveCSS('background-color', 'rgb(92, 214, 138)');
    await generateButton.hover();
    await expect(generateButton).toHaveCSS('background-color', 'rgb(92, 214, 138)');
    await page.mouse.move(0, 0);
  };
  await expect(metaButton).toHaveAttribute('aria-pressed', 'true');
  await expect(config.getByRole('button', { name: 'Basic', exact: true })).toHaveCount(0);
  await expect(config.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0);
  await expect(config.getByRole('button', { name: 'Custom', exact: true })).toHaveCount(0);
  await expect(config.getByRole('searchbox', { name: 'Must Include Modules' })).toBeVisible();
  await expectGenerateButtonGreen();

  const metaMaxPrice = config.locator('[data-build-goal="meta"]').getByRole('spinbutton', {
    name: 'Maximum price',
    exact: true,
  });
  await expect(metaMaxPrice).toHaveValue('0');
  await expect(config.getByText('0 = no limit', { exact: true })).toBeVisible();
  await metaMaxPrice.fill('250000');
  await metaMaxPrice.press('Enter');

  const includeTraderPrices = config.getByRole('checkbox', { name: 'Include trader prices', exact: true });
  await includeTraderPrices.uncheck();
  await expect(metaMaxPrice).toHaveValue('250000');
  await includeTraderPrices.check();
  await expect(metaMaxPrice).toHaveValue('250000');

  const priceModeGroup = page.locator('header').getByRole('group', { name: 'Price mode' });
  await priceModeGroup.getByRole('button', { name: 'PvE', exact: true }).click();
  await expect(metaMaxPrice).toHaveValue('250000');
  await priceModeGroup.getByRole('button', { name: 'PvP', exact: true }).click();
  await expect(metaMaxPrice).toHaveValue('250000');

  await constraintsButton.click();
  await expect(constraintsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(config.getByText('0 = no limit', { exact: true })).toBeVisible();
  await expectGenerateButtonGreen();
  const characteristicSettings = page.locator('.custom-characteristic-settings');
  await expect(characteristicSettings).toBeVisible();
  await expect(characteristicSettings.locator('svg')).toHaveCount(4);
  await expect(characteristicSettings.locator('.custom-radar')).toHaveCount(0);
  await expect(characteristicSettings.getByRole('spinbutton')).toHaveCount(4);
  await expect(characteristicSettings.getByRole('spinbutton', { name: /Price value/ })).toHaveCount(0);
  await expect(characteristicSettings.getByRole('checkbox', { name: /Price/ })).toHaveCount(0);

  const ergonomicsInput = characteristicSettings.getByRole('spinbutton', {
    name: 'Ergonomics value',
    exact: true,
  });
  await ergonomicsInput.fill('51');
  await ergonomicsInput.press('Enter');
  const exactErgonomics = characteristicSettings.getByRole('checkbox', {
    name: 'Use exact target for Ergonomics',
    exact: true,
  });
  await exactErgonomics.evaluate(element => element.click());
  await expect(ergonomicsInput).toHaveValue('51');
  await expect(exactErgonomics).toBeChecked();

  const constraintBudget = config.locator('[data-build-goal="constraints"]').getByRole('spinbutton', {
    name: 'Maximum price',
    exact: true,
  });
  const magazineGroup = config.getByRole('group', { name: 'Magazine Capacity (rounds)' });
  await expect(constraintBudget).toBeVisible();
  await expect.poll(() => constraintBudget.evaluate(input => (
    input.closest('.config__section')?.nextElementSibling
      ?.querySelector('[aria-label="Magazine Capacity (rounds)"]') !== null
  ))).toBe(true);
  await expect(magazineGroup).toBeVisible();
  await expect(constraintBudget).toHaveValue('250000');
  await constraintBudget.fill('180000');
  await constraintBudget.press('Enter');

  await config.getByRole('group', { name: 'Suppressor Mode' })
    .getByRole('button', { name: 'Forbid', exact: true }).click();
  const moduleSearch = config.getByRole('searchbox', { name: 'Must Include Modules' });
  await moduleSearch.fill('Alternative Grip');
  await config.locator('.module-search-item').filter({ hasText: 'Alternative Grip' }).click();
  await expect(config.locator('.required-module').filter({ hasText: 'Alternative Grip' })).toBeVisible();

  await prioritiesButton.click();
  await expect(prioritiesButton).toHaveAttribute('aria-pressed', 'true');
  await expect(config.getByText('0 = no limit', { exact: true })).toBeVisible();
  await expectGenerateButtonGreen();
  await expect(characteristicSettings).toHaveCount(0);
  const prioritiesPanel = config.locator('[data-build-goal="priorities"]');
  const priorityMaxPrice = prioritiesPanel.getByRole('spinbutton', {
    name: 'Maximum price',
    exact: true,
  });
  await expect(priorityMaxPrice).toHaveValue('180000');
  await priorityMaxPrice.fill('250000');
  await priorityMaxPrice.press('Enter');
  await expect(priorityMaxPrice).toHaveValue('250000');

  const verticalRecoil = prioritiesPanel.getByRole('button', { name: 'Vertical recoil', exact: true });
  const horizontalRecoil = prioritiesPanel.getByRole('button', { name: 'Horizontal recoil', exact: true });
  const ergonomics = prioritiesPanel.getByRole('button', { name: 'Ergonomics', exact: true });
  const weight = prioritiesPanel.getByRole('button', { name: 'Weight', exact: true });
  await ergonomics.click();
  await verticalRecoil.click();
  await horizontalRecoil.click();
  await expect(prioritiesPanel.locator('.custom-priority-attributes__count')).toHaveText('3/4');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(0))
    .toContainText('Rank 1Ergonomics');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(1))
    .toContainText('Rank 2Vertical recoil');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__selected')).not.toContainText('%');

  await weight.click();
  await expect(weight).toHaveAttribute('aria-pressed', 'true');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__count')).toHaveText('4/4');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(0))
    .toContainText('Rank 1Ergonomics');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(3))
    .toContainText('Rank 4Weight');
  await prioritiesPanel.getByRole('button', { name: 'Move Vertical recoil up', exact: true }).click();
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(0))
    .toContainText('Rank 1Vertical recoil');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(1))
    .toContainText('Rank 2Ergonomics');
  await expect(prioritiesPanel.getByRole('button', { name: 'Move Vertical recoil up', exact: true })).toBeDisabled();
  await expect(prioritiesPanel.getByRole('button', { name: 'Move Weight down', exact: true })).toBeDisabled();
  await expect(config.locator('.required-module').filter({ hasText: 'Alternative Grip' })).toBeVisible();
  await expect(config.getByRole('button', { name: 'Forbid', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await constraintsButton.click();
  await expect(page.getByRole('spinbutton', { name: 'Ergonomics value', exact: true })).toHaveValue('51');
  await expect(page.getByRole('checkbox', { name: 'Use exact target for Ergonomics', exact: true })).toBeChecked();
  await expect(config.getByRole('spinbutton', { name: 'Maximum price', exact: true })).toHaveValue('250000');
  await expect(config.locator('.required-module').filter({ hasText: 'Alternative Grip' })).toBeVisible();

  await metaButton.click();
  await expect(metaButton).toHaveAttribute('aria-pressed', 'true');
  await expect(metaMaxPrice).toHaveValue('250000');
  await expect(config.getByRole('button', { name: 'Forbid', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(config.locator('.required-module').filter({ hasText: 'Alternative Grip' })).toBeVisible();

  await prioritiesButton.click();
  await expect(priorityMaxPrice).toHaveValue('250000');
  await expect(verticalRecoil).toHaveAttribute('aria-pressed', 'true');
  await expect(ergonomics).toHaveAttribute('aria-pressed', 'true');
  await expect(horizontalRecoil).toHaveAttribute('aria-pressed', 'true');
  await expect(weight).toHaveAttribute('aria-pressed', 'true');
  await expect(prioritiesPanel.locator('.custom-priority-attributes__item').nth(0))
    .toContainText('Rank 1Vertical recoil');

  await page.getByRole('button', { name: 'Generate Build', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save build', exact: true })).toBeVisible();

  await includeTraderPrices.uncheck();
  await expect(priorityMaxPrice).toHaveValue('250000');
  const currentPrice = Number((await page.locator('.price-amount').innerText()).replace(/\D/g, ''));
  const warningBudget = currentPrice - 1;
  await priorityMaxPrice.fill(String(warningBudget));
  await priorityMaxPrice.press('Enter');
  await includeTraderPrices.check();
  await includeTraderPrices.uncheck();
  await expect(priorityMaxPrice).toHaveValue(String(warningBudget));
  await expect(page.getByText(
    `The current build exceeds the ${warningBudget} RUB budget under this price policy.`,
    { exact: true },
  )).toBeVisible();

  const replacementBudget = currentPrice + 10;
  await priorityMaxPrice.fill(String(replacementBudget));
  await priorityMaxPrice.press('Enter');
  const alternativePart = page.locator('.part-card').filter({ hasText: 'Alternative Grip' });
  await alternativePart.getByRole('button', { name: 'Replace', exact: true }).click();
  await page.getByRole('button', { name: /Replace: Starter Grip/ }).click();
  await expect(page.getByText(
    `This replacement exceeds the ${replacementBudget} RUB budget limit.`,
    { exact: false },
  )).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Build Diagram', exact: true }).click();
  const diagram = page.getByRole('dialog', { name: 'Build Diagram', exact: true });
  await diagram.getByRole('button', { name: 'Replace module Alternative Grip', exact: true }).click();
  await diagram.getByRole('button', { name: 'Install Starter Grip', exact: true }).click();
  await expect(diagram.getByText(
    `This replacement exceeds the ${replacementBudget} RUB budget limit.`,
    { exact: false },
  )).toBeVisible();
  await diagram.getByRole('button', { name: 'Close build diagram', exact: true }).click();

  await priorityMaxPrice.fill('250000');
  await priorityMaxPrice.press('Enter');
  await includeTraderPrices.check();
  await expect(priorityMaxPrice).toHaveValue('250000');

  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect.poll(() => config.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
  })).toBe(true);

  await saveBuild(page, 'Priority build');
  const savedSettings = await page.evaluate(savedBuildsKey => (
    JSON.parse(localStorage.getItem(savedBuildsKey))[0].settings
  ), SAVED_BUILDS_KEY);
  expect(savedSettings.targetType).toBe('custom');
  expect(savedSettings.characteristicMode).toBe('priorities');
  expect(savedSettings.priorityAttributes).toEqual([
    'verticalRecoil',
    'ergonomics',
    'horizontalRecoil',
    'weight',
  ]);
  expect(savedSettings.sharedMaxPrice).toBe(250000);
  expect(savedSettings.maxPrice).toBe(250000);
  expect(savedSettings.priorityMaxPrice).toBe(250000);
  expect(savedSettings.customProfile.price).toBe(250000);
  expect(savedSettings.requiredModuleIds).toContain('mod-2');
  expect(savedSettings.customExactTargets.price).toBe(false);

  await openSavedBuild(page, 'Priority build');
  await expect(page.getByRole('group', { name: 'Build Goal' })
    .getByRole('button', { name: 'By priorities', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', {
    name: 'Maximum price',
    exact: true,
  })).toHaveValue('250000');
  await expect(page.getByRole('button', { name: 'Horizontal recoil', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Weight', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.custom-priority-attributes__item').nth(0))
    .toContainText('Rank 1Vertical recoil');
  await expect(page.locator('.required-module').filter({ hasText: 'Alternative Grip' })).toBeVisible();
});

test('keeps loading indicators visible and static when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ))).toBe(true);

  const styles = await page.evaluate(() => {
    const ring = document.createElement('span');
    ring.className = 'loader-ring';
    const text = document.createElement('span');
    text.className = 'loader-text';
    text.textContent = 'Loading';
    document.body.append(ring, text);
    const ringStyle = getComputedStyle(ring);
    const textStyle = getComputedStyle(text);
    const result = {
      ringAnimation: ringStyle.animationName,
      ringOpacity: ringStyle.opacity,
      ringWidth: ringStyle.width,
      textAnimation: textStyle.animationName,
      textOpacity: textStyle.opacity,
      textDisplay: textStyle.display,
    };
    ring.remove();
    text.remove();
    return result;
  });

  expect(styles).toMatchObject({
    ringAnimation: 'none',
    ringOpacity: '1',
    ringWidth: '80px',
    textAnimation: 'none',
    textOpacity: '1',
  });
  expect(styles.textDisplay).not.toBe('none');
});

test('owned items update costs, support mass actions, and persist with a saved build', async ({ page }) => {
  await createBuild(page);

  const remainingPrice = page.locator('.price-box .price-amount');
  const baseWeaponGroup = page.locator('.parts-group').filter({
    has: page.getByRole('heading', { name: 'Base weapon', exact: true }),
  });
  const baseWeaponCard = baseWeaponGroup.locator('.part-card');
  const partOwned = page.locator('.part-card').filter({ hasText: 'Starter Grip' })
    .getByRole('checkbox', { name: 'Mark Starter Grip as owned', exact: true });
  const weaponOwned = baseWeaponCard.getByRole('checkbox', {
    name: 'Mark Test weapon as owned',
    exact: true,
  });
  const initialRemainingPrice = await remainingPrice.innerText();

  await expect(page.getByText(/^Remaining to buy/)).toBeVisible();
  await expect(page.getByText(/^Market value:/)).toBeVisible();
  await expect(baseWeaponGroup).toBeVisible();
  await expect(baseWeaponCard.getByText('TW', { exact: true })).toBeVisible();
  await expect(baseWeaponCard.locator('.item-price')).toBeVisible();
  await expect(page.locator('.weapon').getByRole('checkbox', {
    name: 'Mark Test weapon as owned',
  })).toHaveCount(0);
  await expect(page.getByText(/^Owned total:/)).toHaveCount(0);
  await expect(partOwned).not.toBeChecked();
  await expect(weaponOwned).not.toBeChecked();

  await weaponOwned.check();
  await expect(weaponOwned).toBeChecked();
  await expect(baseWeaponCard).toHaveClass(/part-card--owned/);
  await expect(remainingPrice).not.toHaveText(initialRemainingPrice);
  await expect(page.getByText(/^Market value:/)).toBeVisible();

  await partOwned.check();
  await expect(partOwned).toBeChecked();
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' }))
    .toHaveClass(/part-card--owned/);
  await expect(page.getByText(/^To pay:/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark all owned', exact: true }).click();
  await expect(partOwned).toBeChecked();
  await expect(weaponOwned).toBeChecked();
  await expect(remainingPrice).toHaveText('All purchased');

  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(partOwned).not.toBeChecked();
  await expect(weaponOwned).not.toBeChecked();
  await expect(remainingPrice).toHaveText(initialRemainingPrice);

  await partOwned.check();
  await weaponOwned.check();
  await saveBuild(page, 'Owned parts build');
  await openSavedBuild(page, 'Owned parts build');
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })
    .getByRole('checkbox', {
      name: 'Mark Starter Grip as owned',
      exact: true,
    })).toBeChecked();
  await expect(page.locator('.parts-group').filter({
    has: page.getByRole('heading', { name: 'Base weapon', exact: true }),
  }).getByRole('checkbox', {
    name: 'Mark Test weapon as owned',
    exact: true,
  })).toBeChecked();

  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('strict trader settings expand, persist, and appear once in Configurator', async ({ page }) => {
  await page.goto('/#/settings#traders');

  const strictTraderLevels = page.getByRole('checkbox', {
    name: /Strict(?:ly enforce)? trader levels/,
  });
  const traderLevelSettings = page.locator('#trader-level-settings');
  const praporLevel = page.getByRole('combobox', { name: 'Prapor: Loyalty level' });

  await expect(strictTraderLevels).not.toBeChecked();
  await expect(strictTraderLevels).toHaveAttribute('aria-expanded', 'false');
  await expect(traderLevelSettings).toHaveCount(0);
  await expect(praporLevel).toHaveCount(0);

  await strictTraderLevels.check();
  await expect(strictTraderLevels).toHaveAttribute('aria-expanded', 'true');
  await expect(traderLevelSettings).toHaveCount(1);
  await expect(praporLevel).toBeVisible();
  await praporLevel.selectOption('3');

  await strictTraderLevels.uncheck();
  await expect(strictTraderLevels).toHaveAttribute('aria-expanded', 'false');
  await expect(traderLevelSettings).toHaveCount(0);
  await expect(praporLevel).toHaveCount(0);
  await strictTraderLevels.check();
  await expect(traderLevelSettings).toHaveCount(1);
  await expect(praporLevel).toBeVisible();
  await expect(praporLevel).toHaveValue('3');

  await page.reload();
  await expect(page.getByRole('checkbox', {
    name: /Strict(?:ly enforce)? trader levels/,
  })).toBeChecked();
  await expect(page.locator('#trader-level-settings')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Prapor: Loyalty level' })).toHaveValue('3');

  await createBuild(page);
  await expect(page.getByRole('checkbox', {
    name: /Strict(?:ly enforce)? trader levels/,
  })).toHaveCount(0);
  const strictBadgeLink = page.getByRole('link', {
    name: /Strict trader levels (?:active|enabled).*?(?:Manage in settings|Configure)/,
  });
  await expect(strictBadgeLink).toBeVisible();
  await expect(strictBadgeLink).toHaveAttribute('href', '#/settings#traders');
  await expect(page.locator('.part-card').filter({ hasText: 'Starter Grip' })).toBeVisible();
  await expect(page.getByText('Trader offer unavailable', { exact: true })).toHaveCount(0);
});

test('settings page persists interface and separate trader level profiles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open settings' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Trader levels for PvP', { exact: true })).toHaveCount(0);

  await page.getByRole('checkbox', {
    name: /Strict(?:ly enforce)? trader levels/,
  }).check();
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
  await starterPart.getByRole('checkbox', {
    name: 'Mark Starter Grip as owned',
    exact: true,
  }).check();
  const replaceStarter = starterPart.getByRole('button', { name: 'Replace', exact: true });
  const bodyOverflowBefore = await page.evaluate(() => getComputedStyle(document.body).overflow);
  await replaceStarter.focus();
  await replaceStarter.press('Enter');

  const replacementDialog = page.getByRole('dialog', { name: 'Replace Part', exact: true });
  await expect(replacementDialog).toHaveAttribute('aria-modal', 'true');
  await expectOpenModalContract(page, replacementDialog, replaceStarter);
  await expectEscapeRestoresModal(
    page,
    replacementDialog,
    replaceStarter,
    bodyOverflowBefore,
  );

  await replaceStarter.press('Enter');
  const alternativeChoice = page.getByRole('button', { name: /Replace: Alternative Grip/ });
  await expect(alternativeChoice).toBeVisible();
  expect(await alternativeChoice.evaluate(element => element.tagName)).toBe('BUTTON');
  await expect(alternativeChoice.locator('a, button, input, select, textarea')).toHaveCount(0);
  await alternativeChoice.focus();
  await alternativeChoice.press('Space');
  const alternativePart = page.locator('.part-card').filter({ hasText: 'Alternative Grip' });
  await expect(alternativePart).toBeVisible();
  await expect(alternativePart.getByRole('checkbox', {
    name: 'Mark Alternative Grip as owned',
    exact: true,
  })).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .toBe(bodyOverflowBefore);

  const replaceAlternative = alternativePart.getByRole('button', { name: 'Replace', exact: true });
  await replaceAlternative.focus();
  await replaceAlternative.press('Enter');
  const starterChoice = page.getByRole('button', { name: /Replace: Starter Grip/ });
  await starterChoice.focus();
  await starterChoice.press('Enter');
  await expect(starterPart).toBeVisible();

  await replaceStarter.focus();
  await replaceStarter.press('Enter');
  await page.getByRole('button', { name: /Replace: Alternative Grip/ }).press('Space');
  await expect(alternativePart).toBeVisible();

  await saveBuild(page, 'Replacement build');
  await openSavedBuild(page, 'Replacement build');

  await expect(page.locator('.part-card').filter({ hasText: 'Alternative Grip' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update saved build', exact: true })).toBeVisible();
});

test('import and comparison dialogs trap focus and restore their triggers', async ({ page }) => {
  await page.goto('/#/builds');
  const importTrigger = page.getByRole('button', { name: 'Import', exact: true });
  const bodyOverflowBefore = await page.evaluate(() => getComputedStyle(document.body).overflow);

  await importTrigger.focus();
  await importTrigger.press('Enter');
  const importDialog = page.getByRole('dialog', { name: 'Import builds', exact: true });
  await expectOpenModalContract(page, importDialog, importTrigger);
  await expectEscapeRestoresModal(page, importDialog, importTrigger, bodyOverflowBefore);

  await createBuild(page);
  await saveBuild(page, 'Comparison Alpha');
  await page.evaluate(savedBuildsKey => {
    const savedBuilds = JSON.parse(localStorage.getItem(savedBuildsKey));
    const copy = structuredClone(savedBuilds[0]);
    copy.id = `${copy.id}-comparison-copy`;
    copy.name = 'Comparison Bravo';
    copy.createdAt = new Date(Date.parse(copy.createdAt) + 1000).toISOString();
    copy.updatedAt = copy.createdAt;
    localStorage.setItem(savedBuildsKey, JSON.stringify([...savedBuilds, copy]));
  }, SAVED_BUILDS_KEY);
  await page.goto('/#/builds');

  await page.getByRole('button', {
    name: 'Add Comparison Alpha to comparison',
    exact: true,
  }).click();
  await page.getByRole('button', {
    name: 'Add Comparison Bravo to comparison',
    exact: true,
  }).click();
  const compareTrigger = page.getByRole('button', { name: 'Compare builds', exact: true });
  await compareTrigger.focus();
  await compareTrigger.press('Enter');

  const comparisonDialog = page.getByRole('dialog', { name: 'Comparison', exact: true });
  await expectOpenModalContract(page, comparisonDialog, compareTrigger);
  await expectEscapeRestoresModal(
    page,
    comparisonDialog,
    compareTrigger,
    bodyOverflowBefore,
  );
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

  const deleteTrigger = card.getByRole('button', { name: 'Delete', exact: true });
  const bodyOverflowBefore = await page.evaluate(() => getComputedStyle(document.body).overflow);
  await deleteTrigger.focus();
  await deleteTrigger.press('Enter');
  const deleteDialog = page.getByRole('alertdialog', { name: /Delete “Portable build”/ });
  await expect(deleteDialog).toHaveAttribute('aria-modal', 'true');
  await expectOpenModalContract(page, deleteDialog, deleteTrigger);
  await expectEscapeRestoresModal(page, deleteDialog, deleteTrigger, bodyOverflowBefore);

  await deleteTrigger.press('Enter');
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
