import test from 'node:test';
import assert from 'node:assert/strict';
import { getScopeAutoCopy } from '../../src/features/configurator/scopeAutoCopy.js';

function translate(key, values = {}) {
  const messages = {
    'config.tactical.autoSelect': 'Автовыбор',
    'config.tactical.autoDescription': 'Система сама выберет лучший вариант',
    'config.sight.autoZoomLabel': 'Автовыбор • {zoom}x',
    'config.sight.autoZoomDescription': 'Система выберет лучший совместимый прицел с кратностью {zoom}x',
  };
  return messages[key].replace('{zoom}', values.zoom ?? '');
}

test('automatic scope copy is unchanged without a zoom restriction', () => {
  assert.deepEqual(getScopeAutoCopy(translate, null), {
    label: 'Автовыбор',
    description: 'Система сама выберет лучший вариант',
  });
});

test('automatic scope copy describes the selected zoom in the label and option help', () => {
  assert.deepEqual(getScopeAutoCopy(translate, 4), {
    label: 'Автовыбор • 4x',
    description: 'Система выберет лучший совместимый прицел с кратностью 4x',
  });
});
