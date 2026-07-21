import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRITICAL_MODULE_TOOLTIP,
  EMPTY_CRITICAL_MODULE_WARNING,
  getModuleDisplayState,
  isCriticalSlot,
  sortModuleDisplayItems,
} from '../../src/ui/criticalModules.js';

test('uses English copy for critical module states', () => {
  assert.equal(
    CRITICAL_MODULE_TOOLTIP,
    'This module is required for the weapon to function correctly.',
  );
  assert.equal(EMPTY_CRITICAL_MODULE_WARNING, 'Required module is not installed');
});

test('places critical modules before ordinary modules', () => {
  const ordinary = { id: 'ordinary', isCritical: false, isEmpty: false };
  const critical = { id: 'critical', isCritical: true, isEmpty: false };

  assert.deepEqual(
    sortModuleDisplayItems([ordinary, critical]).map(item => item.id),
    ['critical', 'ordinary'],
  );
});

test('places an empty critical slot before an installed critical module', () => {
  const installed = { id: 'installed', isCritical: true, isEmpty: false };
  const empty = { id: 'empty', isCritical: true, isEmpty: true };

  assert.deepEqual(
    sortModuleDisplayItems([installed, empty]).map(item => item.id),
    ['empty', 'installed'],
  );
});

test('preserves the existing order inside every criticality group', () => {
  const items = [
    { id: 'ordinary-b', isCritical: false, isEmpty: false },
    { id: 'critical-b', isCritical: true, isEmpty: false },
    { id: 'ordinary-a', isCritical: false, isEmpty: false },
    { id: 'critical-a', isCritical: true, isEmpty: false },
  ];

  assert.deepEqual(
    sortModuleDisplayItems(items).map(item => item.id),
    ['critical-b', 'critical-a', 'ordinary-b', 'ordinary-a'],
  );
});

test('does not mutate the source array while sorting', () => {
  const ordinary = { id: 'ordinary', isCritical: false, isEmpty: false };
  const critical = { id: 'critical', isCritical: true, isEmpty: false };
  const source = [ordinary, critical];
  const before = [...source];
  const sorted = sortModuleDisplayItems(source);

  assert.deepEqual(source, before);
  assert.notStrictEqual(sorted, source);
  assert.strictEqual(source[0], ordinary);
});

test('shows the critical badge state only for slots marked required by data', () => {
  const requiredSlot = { required: true };
  const optionalSlot = { required: false };

  assert.equal(isCriticalSlot(requiredSlot), true);
  assert.equal(isCriticalSlot(optionalSlot), false);
  assert.equal(getModuleDisplayState(requiredSlot, { id: 'installed' }).showCriticalBadge, true);
  assert.equal(getModuleDisplayState(optionalSlot, { id: 'installed' }).showCriticalBadge, false);
});

test('shows the warning only for an empty critical slot', () => {
  const emptyCritical = getModuleDisplayState({ required: true }, null);
  const installedCritical = getModuleDisplayState({ required: true }, { id: 'installed' });
  const emptyOptional = getModuleDisplayState({ required: false }, null);

  assert.equal(emptyCritical.emptyWarning, EMPTY_CRITICAL_MODULE_WARNING);
  assert.equal(installedCritical.emptyWarning, null);
  assert.equal(emptyOptional.emptyWarning, null);
});
