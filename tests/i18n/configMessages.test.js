import test from 'node:test';
import assert from 'node:assert/strict';

import { configMessages } from '../../src/i18n/configMessages.js';
import { uiMessages } from '../../src/i18n/uiMessages.js';

test('uses compact recoil labels only in the Russian configurator', () => {
  assert.equal(configMessages.ru['config.stat.verticalRecoil'], 'В. отдача');
  assert.equal(configMessages.ru['config.stat.horizontalRecoil'], 'Г. отдача');
  assert.equal(configMessages.en['config.stat.verticalRecoil'], 'Vertical recoil');
  assert.equal(configMessages.en['config.stat.horizontalRecoil'], 'Horizontal recoil');
});

test('provides localized Priority weighted-selection labels', () => {
  assert.equal(configMessages.en['config.prioritySelectionMode.ordered'], 'By order');
  assert.equal(configMessages.en['config.prioritySelectionMode.weighted'], 'Custom values');
  assert.equal(configMessages.en['config.priorityWeightInvalid'], 'Priority values must total 100%.');
  assert.equal(configMessages.ru['config.prioritySelectionMode.ordered'], 'По порядку');
  assert.equal(configMessages.ru['config.prioritySelectionMode.weighted'], 'Свои значения');
  assert.equal(configMessages.ru['config.priorityWeightInvalid'], 'Сумма приоритетов должна быть 100%.');
});

test('characteristic limits have no failure message of their own', () => {
  assert.equal(Object.hasOwn(configMessages.en, 'config.constraintsUnmet'), false);
  assert.equal(Object.hasOwn(configMessages.ru, 'config.constraintsUnmet'), false);
  assert.match(configMessages.ru['config.warning.requirementsUnmet'], /ближайшая найденная сборка/);
  assert.match(configMessages.en['config.warning.requirementsUnmet'], /closest build found/);
});

test('explains soft directional characteristic limits in both languages', () => {
  assert.match(uiMessages.en['ui.radar.help'], /weight and recoil at most, ergonomics at least/);
  assert.match(uiMessages.en['ui.radar.help'], /closest available build is chosen/);
  assert.match(uiMessages.ru['ui.radar.help'], /вес и отдача — не больше, эргономика — не меньше/);
  assert.match(uiMessages.ru['ui.radar.help'], /будет выбрана ближайшая доступная сборка/);
});
