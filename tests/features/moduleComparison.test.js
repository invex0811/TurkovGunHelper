import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARISON_METRICS, deselectComparedModules, filterComparisonRows, getCandidatesForCategory,
  getMetricExtremes, getReachableModules, metricValue, selectComparedModules, sortComparisonRows,
  toggleComparedModule,
} from '../../src/features/moduleComparison/comparison.js';

const module = (id, name, category = 'Grip', slots = [], values = {}) => ({
  id, name, shortName: name, categories: [{ id: category, name: category }], properties: { slots }, ...values,
});
const slot = (...ids) => ({ filters: { allowedItems: ids.map(id => ({ id })) } });

test('finds direct and attachment-chain compatible modules', () => {
  const weapon = { id: 'weapon', properties: { slots: [slot('grip', 'adapter')] } };
  const allMods = { grip: module('grip', 'Direct'), adapter: module('adapter', 'Adapter', 'Mount', [slot('scope')]), scope: module('scope', 'Scope', 'Scope'), unrelated: module('unrelated', 'No') };
  const candidates = getReachableModules(weapon, allMods);
  assert.deepEqual(candidates.map(entry => entry.item.id).sort(), ['adapter', 'grip', 'scope']);
  assert.equal(candidates.find(entry => entry.item.id === 'scope').compatibilityKind, 'viaAdapter');
});

test('selects more than eight modules without duplicates and can clear them', () => {
  const items = Array.from({ length: 12 }, (_, index) => module(String(index), `M${index}`));
  const selected = selectComparedModules([], items);
  assert.equal(selected.length, 12);
  assert.equal(selectComparedModules(selected, items).length, 12);
  assert.equal(toggleComparedModule(selected, items[0]).length, 11);
  assert.equal(deselectComparedModules(selected, items.map(item => item.id)).length, 0);
});

test('compare all uses the whole category rather than a search-filtered subset', () => {
  const candidates = [module('one', 'Alpha'), module('two', 'Bravo'), module('three', 'Scope', 'Scope')].map(item => ({ item, compatibilityKind: 'direct' }));
  const category = getCandidatesForCategory(candidates, 'grip');
  assert.deepEqual(category.map(row => row.item.id), ['one', 'two']);
  assert.deepEqual(filterComparisonRows(category, { search: 'alpha' }).map(row => row.item.id), ['one']);
  assert.equal(selectComparedModules([], category.map(row => row.item)).length, 2);
});

test('filters display rows without changing selection and supports compatibility, selected, and price filters', () => {
  const selectedIds = new Set(['one']);
  const rows = [
    { item: module('one', 'Alpha', 'Grip', [], { price: { value: 0 } }), compatibilityKind: 'direct' },
    { item: module('two', 'Bravo', 'Grip'), compatibilityKind: 'viaAdapter' },
  ];
  assert.deepEqual(filterComparisonRows(rows, { selectedIds, selectedOnly: true }).map(row => row.item.id), ['one']);
  assert.deepEqual(filterComparisonRows(rows, { compatibility: 'viaAdapter' }).map(row => row.item.id), ['two']);
  assert.deepEqual(filterComparisonRows(rows, { withPrice: true }).map(row => row.item.id), ['one']);
  assert.deepEqual([...selectedIds], ['one']);
});

test('sorting does not mutate input and keeps missing values last in both directions', () => {
  const rows = [
    { item: module('one', 'Bravo', 'Grip', [], { ergonomicsModifier: -2, price: { value: null } }) },
    { item: module('two', 'Alpha', 'Grip', [], { ergonomicsModifier: 0, price: { value: 40 } }) },
    { item: module('three', 'Charlie', 'Grip', [], { ergonomicsModifier: 4, price: { value: 100 } }) },
  ];
  assert.deepEqual(sortComparisonRows(rows, 'name').map(row => row.item.id), ['two', 'one', 'three']);
  assert.deepEqual(sortComparisonRows(rows, 'price', 'desc').map(row => row.item.id), ['three', 'two', 'one']);
  assert.deepEqual(sortComparisonRows(rows, 'ergonomicsModifier', 'desc').map(row => row.item.id), ['three', 'two', 'one']);
  assert.deepEqual(rows.map(row => row.item.id), ['one', 'two', 'three']);
});

test('metric extremes honor direction, ties, and missing values', () => {
  const price = COMPARISON_METRICS.find(metric => metric.key === 'price');
  const ergonomics = COMPARISON_METRICS.find(metric => metric.key === 'ergonomicsModifier');
  assert.deepEqual(getMetricExtremes([{ price: { value: 100 } }, { price: { value: 40 } }, { price: { value: null } }], price), { best: 40, worst: 100 });
  assert.deepEqual(getMetricExtremes([{ ergonomicsModifier: 3 }, { ergonomicsModifier: 3 }], ergonomics), { best: null, worst: null });
});

test('magazine capacity uses the normalized item properties', () => {
  const capacity = COMPARISON_METRICS.find(metric => metric.key === 'capacity');
  assert.equal(metricValue(module('mag', 'Magazine', 'Magazine', [], { properties: { capacity: 60 } }), capacity), 60);
  assert.equal(metricValue(module('part', 'Part'), capacity), null);
});
