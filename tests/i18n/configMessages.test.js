import test from 'node:test';
import assert from 'node:assert/strict';

import { configMessages } from '../../src/i18n/configMessages.js';

test('uses compact recoil labels only in the Russian configurator', () => {
  assert.equal(configMessages.ru['config.stat.verticalRecoil'], 'В. отдача');
  assert.equal(configMessages.ru['config.stat.horizontalRecoil'], 'Г. отдача');
  assert.equal(configMessages.en['config.stat.verticalRecoil'], 'Vertical recoil');
  assert.equal(configMessages.en['config.stat.horizontalRecoil'], 'Horizontal recoil');
});
