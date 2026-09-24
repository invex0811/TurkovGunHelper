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

test('describes constraint failures as a bounded-search result', () => {
  assert.match(configMessages.en['config.constraintsUnmet'], /bounded search/i);
  assert.match(configMessages.ru['config.constraintsUnmet'], /Ограниченный поиск/i);
  assert.match(configMessages.en['config.constraintsUnmet'], /all selected limits/i);
  assert.match(configMessages.ru['config.constraintsUnmet'], /все заданные ограничения/i);
});

test('explains the direction of hard characteristic limits in both languages', () => {
  assert.match(uiMessages.en['ui.radar.help'], /Weight and recoil must be no higher/);
  assert.match(uiMessages.en['ui.radar.help'], /ergonomics must be no lower/);
  assert.match(uiMessages.ru['ui.radar.help'], /Вес и отдача — не больше/);
  assert.match(uiMessages.ru['ui.radar.help'], /эргономика — не меньше/);
});
