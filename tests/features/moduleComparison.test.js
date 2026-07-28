import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARISON_METRICS, deselectComparedModules, filterComparisonRows, getCandidatesForCategory,
  getAvailableComparisonMetrics, getComparisonMetric, getMetricExtremes, getReachableModules,
  hasMetricValue, metricValue, normalizeComparisonSort, selectComparedModules, sortComparisonRows,
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
  const capacity = getComparisonMetric('capacity');
  assert.equal(metricValue(module('mag', 'Magazine', 'Magazine', [], { properties: { capacity: 60 } }), capacity), 60);
  assert.equal(metricValue(module('part', 'Part'), capacity), null);
});

test('available metrics are based on the full category data, not a filtered scope result', () => {
  const sightingRange = getComparisonMetric('sightingRange');
  const capacity = getComparisonMetric('capacity');
  const scopes = [
    { item: module('scope-a', 'Scope A', 'Scope', [], { properties: { sightingRange: 500 } }) },
    { item: module('scope-b', 'Scope B', 'Scope') },
  ];
  const magazines = [
    { item: module('mag-a', 'Magazine A', 'Magazine', [], { properties: { capacity: 30 } }) },
    { item: module('mag-b', 'Magazine B', 'Magazine') },
  ];
  const scopeMetrics = getAvailableComparisonMetrics(scopes);
  const magazineMetrics = getAvailableComparisonMetrics(magazines);
  assert.equal(scopeMetrics.includes(sightingRange), true);
  assert.equal(scopeMetrics.includes(capacity), false);
  assert.equal(magazineMetrics.includes(capacity), true);
  assert.equal(magazineMetrics.includes(sightingRange), false);
  assert.equal(getAvailableComparisonMetrics(magazines).includes(capacity), true);
});

test('zero and negative values are valid while empty numeric values are unavailable', () => {
  const ergonomics = getComparisonMetric('ergonomicsModifier');
  const recoil = getComparisonMetric('recoilModifier');
  const capacity = getComparisonMetric('capacity');
  const item = module('zero', 'Zero', 'Magazine', [], { ergonomicsModifier: 0, recoilModifier: -2, properties: { capacity: 0 } });
  assert.equal(hasMetricValue(item, ergonomics), true);
  assert.equal(metricValue(item, recoil), -2);
  assert.equal(hasMetricValue(item, capacity), true);
  assert.equal(hasMetricValue({ ergonomicsModifier: '', properties: { capacity: Number.NaN } }, ergonomics), false);
  assert.equal(hasMetricValue({ properties: { capacity: Number.NaN } }, capacity), false);
});

test('missing values sort last and structural API fields do not create metrics', () => {
  const rows = [
    { item: module('known', 'Known', 'Magazine', [], { properties: { capacity: 30 } }) },
    { item: module('missing', 'Missing', 'Magazine', [], { properties: { slots: [], allowedItems: [], defaultPreset: {} } }) },
  ];
  assert.deepEqual(sortComparisonRows(rows, 'capacity', 'asc').map(row => row.item.id), ['known', 'missing']);
  assert.deepEqual(sortComparisonRows(rows, 'capacity', 'desc').map(row => row.item.id), ['known', 'missing']);
  assert.equal(getAvailableComparisonMetrics(rows).some(metric => ['slots', 'allowedItems', 'defaultPreset'].includes(metric.key)), false);
});

test('price is only available when the category contains a valid normalized price', () => {
  const price = getComparisonMetric('price');
  const withoutPrices = [{ item: module('none', 'No price', 'Scope', [], { price: { value: null } }) }];
  const zeroPrice = [{ item: module('free', 'Zero price', 'Scope', [], { price: { value: 0 } }) }];
  assert.equal(getAvailableComparisonMetrics(withoutPrices).includes(price), false);
  assert.equal(getAvailableComparisonMetrics(zeroPrice).includes(price), true);
  assert.deepEqual(filterComparisonRows(zeroPrice, { withPrice: true }).map(row => row.item.id), ['free']);
});

test('all-zero scope modifiers are not informative comparison columns', () => {
  const scopes = [
    { item: module('scope-a', 'Scope A', 'Scope', [], { accuracyModifier: 0, velocity: 0, loudness: 0, properties: { sightingRange: 300 } }) },
    { item: module('scope-b', 'Scope B', 'Scope', [], { accuracyModifier: 0, velocity: 0, loudness: 0, properties: { sightingRange: 500 } }) },
  ];
  const keys = new Set(getAvailableComparisonMetrics(scopes).map(metric => metric.key));
  assert.equal(keys.has('accuracyModifier'), false);
  assert.equal(keys.has('velocity'), false);
  assert.equal(keys.has('loudness'), false);
  assert.equal(keys.has('sightingRange'), true);
});

test('a non-zero modifier makes its column available while zero remains a displayed value', () => {
  const accuracy = getComparisonMetric('accuracyModifier');
  const scopes = [
    { item: module('scope-zero', 'Scope zero', 'Scope', [], { accuracyModifier: 0 }) },
    { item: module('scope-accuracy', 'Scope accuracy', 'Scope', [], { accuracyModifier: -2 }) },
  ];
  assert.equal(getAvailableComparisonMetrics(scopes).includes(accuracy), true);
  assert.equal(metricValue(scopes[0].item, accuracy), 0);
});

test('absolute zero values remain informative and searches cannot change category metrics', () => {
  const weight = getComparisonMetric('weight');
  const price = getComparisonMetric('price');
  const capacity = getComparisonMetric('capacity');
  const magazines = [
    { item: module('mag-zero', 'Zero', 'Magazine', [], { weight: 0, price: { value: 0 }, properties: { capacity: 0 } }) },
    { item: module('mag-full', 'Full', 'Magazine', [], { weight: 0.2, price: { value: 42 }, properties: { capacity: 30 } }) },
  ];
  const available = getAvailableComparisonMetrics(magazines);
  assert.equal(available.includes(weight), true);
  assert.equal(available.includes(price), true);
  assert.equal(available.includes(capacity), true);
  assert.deepEqual(filterComparisonRows(magazines, { search: 'zero' }).map(row => row.item.id), ['mag-zero']);
  assert.equal(getAvailableComparisonMetrics(magazines).includes(capacity), true);
});

test('sorting by a modifier that disappears with the category resets to name ascending', () => {
  const capacity = getComparisonMetric('capacity');
  const sightingRange = getComparisonMetric('sightingRange');
  assert.deepEqual(normalizeComparisonSort('capacity', 'desc', [sightingRange]), { sortKey: 'name', sortDirection: 'asc' });
  assert.deepEqual(normalizeComparisonSort('capacity', 'desc', [capacity]), { sortKey: 'capacity', sortDirection: 'desc' });
});
