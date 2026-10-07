import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  createCategories,
  createSlot,
  createTestWeapon,
  createTestMod,
  createModMap,
  assertInstalled,
  assertNotInstalled,
  assertNoDuplicatePartsForResult,
  assertStatsMatchPartsForWeapon,
  defaultOptions,
} from './calculatorTestHelpers.js';

test('empty required modules skip reachability traversal in skipped tactical slots', () => {
  const skippedTacticalDescendant = createTestMod({
    id: 'skipped-tactical-descendant',
    categories: createCategories(['Comb. tact. device']),
  });
  Object.defineProperty(skippedTacticalDescendant, 'properties', {
    configurable: true,
    get() {
      throw new Error('reachability traversal should not inspect this descendant');
    },
  });

  const stock = createTestMod({
    id: 'stock-with-skipped-tactical-slot',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 5,
    slots: [createSlot('Tactical', [skippedTacticalDescendant.id], 'mod_tactical_000')],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [stock.id])],
  });

  const result = calculateBestBuild(
    testWeapon,
    'meta',
    70,
    50,
    createModMap(stock, skippedTacticalDescendant),
    { ...defaultOptions, requiredItemIds: [] },
  );

  assert.equal(result.error, undefined);
  assertInstalled(result, stock.id);
});


test('requiredItemIds force compatible modules into the build', () => {
  const bestStock = createTestMod({
    id: 'best-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 12,
    recoilModifier: -20,
  });
  const requiredStock = createTestMod({
    id: 'required-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 1,
    recoilModifier: -1,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [bestStock.id, requiredStock.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(bestStock, requiredStock), {
    ...defaultOptions,
    requiredItemIds: [requiredStock.id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, requiredStock.id);
  assertNotInstalled(result, bestStock.id);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});


test('requiredItemIds can force nested modules even when regular options would filter them', () => {
  const requiredSight = createTestMod({
    id: 'required-sight',
    categories: createCategories(['Sights', 'Reflex sight']),
    ergonomicsModifier: -4,
  });
  const receiver = createTestMod({
    id: 'receiver-with-scope-slot',
    categories: createCategories(['Receiver']),
    slots: [createSlot('Scope', [requiredSight.id], 'mod_scope')],
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Receiver', [receiver.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(receiver, requiredSight), {
    ...defaultOptions,
    requireSight: false,
    sightMode: 'none',
    requiredItemIds: [requiredSight.id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, receiver.id);
  assertInstalled(result, requiredSight.id);
  assertNoDuplicatePartsForResult(result);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});


test('requiredItemIds reports incompatible modules', () => {
  const compatibleStock = createTestMod({
    id: 'compatible-stock',
    categories: createCategories(['Stock']),
    ergonomicsModifier: 5,
  });
  const incompatibleGrip = createTestMod({
    id: 'incompatible-grip',
    name: 'Bad Required Grip',
    shortName: 'Bad Req',
    categories: createCategories(['Pistol grip']),
    ergonomicsModifier: 20,
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('Stock', [compatibleStock.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 70, 50, createModMap(compatibleStock, incompatibleGrip), {
    ...defaultOptions,
    requiredItemIds: [incompatibleGrip.id],
  });

  assert.match(result.error, /Required modules could not be installed/i);
  // The full name: short names repeat across a weapon's parts.
  assert.match(result.error, /Bad Required Grip/);
  assertNotInstalled(result, incompatibleGrip.id);
  assertStatsMatchPartsForWeapon(testWeapon, result);
});


test('requiredItemIds install a manually selected sight through its compatible mount chain', () => {
  const scopeSight = createTestMod({
    id: 'manual_scope_sight',
    name: 'Manual Scope',
    shortName: 'Manual Scope',
    categories: createCategories(['Scope', 'Sights']),
    properties: { zoomLevels: [[4]] },
  });
  const scopeMount = createTestMod({
    id: 'manual_scope_mount',
    name: 'Manual Scope Mount',
    shortName: 'Manual Mount',
    categories: createCategories(['Mount']),
    properties: { slots: [createSlot('mod_scope', [scopeSight.id])] },
  });
  const testWeapon = createTestWeapon({
    slots: [createSlot('mod_mount', [scopeMount.id])],
  });

  const result = calculateBestBuild(testWeapon, 'meta', 50, 50, createModMap(scopeMount, scopeSight), {
    magazineCapacity: 30,
    requireSight: true,
    sightMode: 'any',
    requiredItemIds: [scopeSight.id],
  });

  assert.equal(result.error, undefined);
  assertInstalled(result, scopeMount.id);
  assertInstalled(result, scopeSight.id);
});
