import test from 'node:test';
import assert from 'node:assert/strict';

import { interpolateMessage } from '../../src/i18n/interpolate.js';

test('interpolates English one/other plural forms', () => {
  const message = '{count, plural, one {module} other {modules}}';
  assert.equal(interpolateMessage(message, { count: 1 }, 'en'), 'module');
  assert.equal(interpolateMessage(message, { count: 2 }, 'en'), 'modules');
});

test('interpolates Russian plural categories', () => {
  const message = '{count, plural, one {модуль} few {модуля} many {модулей} other {модуля}}';
  assert.equal(interpolateMessage(message, { count: 1 }, 'ru'), 'модуль');
  assert.equal(interpolateMessage(message, { count: 2 }, 'ru'), 'модуля');
  assert.equal(interpolateMessage(message, { count: 5 }, 'ru'), 'модулей');
  assert.equal(interpolateMessage(message, { count: 21 }, 'ru'), 'модуль');
});

test('interpolates regular and unknown placeholders', () => {
  assert.equal(interpolateMessage('Hello, {name}!', { name: 'Scav' }), 'Hello, Scav!');
  assert.equal(interpolateMessage('Value: {missing}', {}), 'Value: {missing}');
});
