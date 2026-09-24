import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CONFIGURATOR_MESSAGE_TYPES,
  createConfiguratorNotifications,
  dedupeConfiguratorNotifications,
  getBuildResultWarningMessage,
  getLocalizedBuildWarnings,
  getInlineMessageA11y,
  localizeBuildWarning,
  normalizeConfiguratorNotification,
} from '../../src/features/configurator/configuratorNotifications.js';
import { interpolateMessage } from '../../src/i18n/interpolate.js';
import { messages } from '../../src/i18n/messages.js';

function translator(language) {
  return (key, values = {}) => interpolateMessage(
    messages[language]?.[key] ?? messages.en[key] ?? key,
    values,
    language,
  );
}

test('build warning keeps its real fallback text in Russian and English', () => {
  const result = { warning: 'A required adapter could not be installed.' };

  assert.equal(
    getBuildResultWarningMessage(result, translator('ru')),
    result.warning,
  );
  assert.equal(
    getBuildResultWarningMessage(result, translator('en')),
    result.warning,
  );
});

test('known warning code uses the localized message', () => {
  const result = {
    warningCode: 'SAVED_MODULES_SKIPPED',
    warningParams: { count: 2 },
    warning: 'Fallback text',
  };

  assert.equal(
    getBuildResultWarningMessage(result, translator('ru')),
    'Сохранённые модули (2) больше недоступны и были пропущены.',
  );
  assert.equal(
    getBuildResultWarningMessage(result, translator('en')),
    '2 saved module(s) are no longer available and were skipped.',
  );
});

test('price warning code is localized in Russian and English instead of using fallback', () => {
  const result = {
    warningCode: 'PRICE_ITEMS_UNAVAILABLE',
    warningParams: { count: 2 },
    warning: 'One or more selected items have no available price under the active price policy.',
  };

  const russian = getBuildResultWarningMessage(result, translator('ru'));
  const english = getBuildResultWarningMessage(result, translator('en'));

  assert.equal(
    russian,
    'Для одного или нескольких предметов сборки нет доступной цены при текущих настройках цен.',
  );
  assert.doesNotMatch(russian, /active price policy/i);
  assert.equal(
    english,
    'One or more build items have no available price under the current price settings.',
  );
});

test('legacy English price warning is mapped to the active language', () => {
  const result = {
    warning: '  One or more selected items have no available price under the active price policy.  ',
  };

  assert.equal(
    getBuildResultWarningMessage(result, translator('ru')),
    'Для одного или нескольких предметов сборки нет доступной цены при текущих настройках цен.',
  );
});

test('legacy closest-build warning uses neutral constraint copy in Russian and English', () => {
  const warning = {
    code: 'REQUIREMENTS_UNMET_CLOSEST_BUILD',
    fallback: "It's physically impossible to meet your exact requirements with the current available parts. Showing the closest balanced build possible.",
  };

  assert.equal(
    localizeBuildWarning(warning, translator('ru')),
    'Не удалось выполнить выбранные требования с доступными модулями.',
  );
  assert.equal(
    localizeBuildWarning(warning, translator('en')),
    'The selected requirements could not be satisfied with the available modules.',
  );
});

test('structured warning arrays preserve order, ignore empty entries, and remove duplicates', () => {
  const warnings = getLocalizedBuildWarnings({
    warnings: [
      {
        code: 'PRICE_ITEMS_UNAVAILABLE',
        params: { count: 2 },
        fallback: 'Fallback price warning',
      },
      null,
      {
        code: 'REQUIREMENTS_UNMET_CLOSEST_BUILD',
        fallback: 'Fallback requirements warning',
      },
      {
        code: 'PRICE_ITEMS_UNAVAILABLE',
        params: { count: 2 },
        fallback: 'Duplicate fallback',
      },
    ],
  }, translator('ru'));

  assert.deepEqual(warnings, [
    'Для одного или нескольких предметов сборки нет доступной цены при текущих настройках цен.',
    'Не удалось выполнить выбранные требования с доступными модулями.',
  ]);
});

test('unknown warning code uses safe original text and rejects technical payloads', () => {
  const t = translator('en');

  assert.equal(
    getBuildResultWarningMessage({
      warningCode: 'UNKNOWN_INTERNAL_CODE',
      warning: 'The selected stock is unavailable.',
    }, t),
    'The selected stock is unavailable.',
  );
  assert.equal(
    getBuildResultWarningMessage({
      warningCode: 'UNKNOWN_INTERNAL_CODE',
      warning: '{"stack":"Error at internalWorker"}',
    }, t),
    'The build was created with a warning, but its reason is unavailable.',
  );
});

test('notification types include error, warning, info, and success', () => {
  assert.deepEqual(
    CONFIGURATOR_MESSAGE_TYPES,
    ['error', 'warning', 'info', 'success'],
  );
  assert.equal(normalizeConfiguratorNotification({
    type: 'success',
    message: 'Saved',
  }).type, 'success');
});

test('configurator notifications classify and order errors, warnings, and price information', () => {
  const notifications = createConfiguratorNotifications({
    generationError: 'Generation failed',
    calculationError: 'Constraints failed',
    replacementError: 'Replacement failed',
    buildWarnings: ['Build warning'],
    pricePolicyWarning: 'Budget exceeded',
    priceWarnings: ['Missing A', 'Missing B'],
    priceInfos: ['Fallback C', 'Mixed sources'],
    hasFallbackPrice: true,
    priceModeNotice: 'Recalculate',
  }, translator('en'));

  assert.deepEqual(
    notifications.map(({ id, type }) => [id, type]),
    [
      ['generation-error', 'error'],
      ['calculation-error', 'error'],
      ['replacement-error', 'error'],
      ['build-warning', 'warning'],
      ['price-policy-warning', 'warning'],
      ['price-warnings', 'warning'],
      ['price-infos', 'info'],
      ['price-mode-notice', 'info'],
    ],
  );
  assert.deepEqual(notifications[5].details, ['Missing A', 'Missing B']);
  assert.deepEqual(notifications[6].details, ['Fallback C', 'Mixed sources']);
});

test('valid fallback prices are informational while incomplete totals are warnings', () => {
  const notifications = createConfiguratorNotifications({
    priceWarnings: ['No price for the mount'],
    priceInfos: ['Fallback price for the base weapon'],
    hasFallbackPrice: true,
  }, translator('en'));

  assert.equal(notifications.find(item => item.id === 'price-warnings').type, 'warning');
  assert.equal(notifications.find(item => item.id === 'price-infos').type, 'info');
});

test('empty notifications are removed and duplicate content is shown once', () => {
  assert.deepEqual(createConfiguratorNotifications({}, translator('en')), []);

  const notifications = dedupeConfiguratorNotifications([
    { id: 'first', type: 'warning', title: 'First', message: 'Same problem' },
    { id: 'second', type: 'info', title: 'Second', message: '  Same   problem ' },
    { id: 'third', type: 'info', title: 'Third', message: 'Different problem' },
  ]);

  assert.deepEqual(notifications.map(item => item.id), ['first', 'third']);
});

test('inline message accessibility semantics match message severity', () => {
  assert.deepEqual(getInlineMessageA11y('error'), {
    role: 'alert',
    ariaLive: 'assertive',
  });
  assert.deepEqual(getInlineMessageA11y('warning'), {
    role: 'status',
    ariaLive: 'polite',
  });
  assert.deepEqual(getInlineMessageA11y('info'), {
    role: 'status',
    ariaLive: 'polite',
  });
});

test('InlineMessage uses shared CSS, decorative icons, and unified price-mode rendering', async () => {
  const [primitives, buildWarnings] = await Promise.all([
    readFile(new URL('../../src/features/configurator/components/ConfiguratorPrimitives.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/configurator/components/BuildWarnings.jsx', import.meta.url), 'utf8'),
  ]);
  const inlineMessageSource = primitives.slice(
    primitives.indexOf('export function InlineMessage'),
    primitives.indexOf('export function StatMeterRow'),
  );

  assert.doesNotMatch(inlineMessageSource, /style=\{\{/);
  assert.match(inlineMessageSource, /inline-message__icon/);
  assert.match(inlineMessageSource, /inline-message__list/);
  assert.match(primitives, /aria-hidden="true"/);
  assert.match(buildWarnings, /priceModeNotice/);
  assert.match(buildWarnings, /<InlineMessage/);
});
