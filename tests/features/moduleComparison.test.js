import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARISON_METRICS, MAX_COMPARE_MODULES, filterModulesByCategory, getMetricExtremes,
  getModuleCategories, getReachableModules, metricValue, toggleComparedModule,
} from '../../src/features/moduleComparison/comparison.js';

const module = (id, name, category = 'Grip', slots = []) => ({
  id, name, shortName: name, categories: [{ id: category, name: category }], properties: { slots },
});
const slot = (...ids) => ({ filters: { allowedItems: ids.map(id => ({ id })) } });

test('finds direct and attachment-chain compatible modules and categories', () => {
  const weapon = { id: 'weapon', properties: { slots: [slot('grip', 'adapter')] } };
  const allMods = {
    grip: module('grip', 'Direct grip'),
    adapter: module('adapter', 'Adapter', 'Mount', [slot('scope')]),
    scope: module('scope', 'Scope', 'Scope'),
    unrelated: module('unrelated', 'Unrelated'),
  };
  const candidates = getReachableModules(weapon, allMods);
  assert.deepEqual(candidates.map(entry => entry.item.id).sort(), ['adapter', 'grip', 'scope']);
  assert.equal(candidates.find(entry => entry.item.id === 'scope').compatibilityKind, 'viaAdapter');
  assert.deepEqual(getModuleCategories(candidates).map(entry => entry.key).sort(), ['grip', 'mount', 'scope']);
  assert.deepEqual(filterModulesByCategory(candidates, 'scope').map(entry => entry.item.id), ['scope']);
});

test('selection does not duplicate modules and respects the comparison limit', () => {
  const items = Array.from({ length: MAX_COMPARE_MODULES + 1 }, (_, index) => module(String(index), `M${index}`));
  const selected = items.reduce((current, item) => toggleComparedModule(current, item), []);
  assert.equal(selected.length, MAX_COMPARE_MODULES);
  assert.equal(toggleComparedModule(selected, items[0]).length, MAX_COMPARE_MODULES - 1);
});

test('metric extremes honor direction and ignore missing or tied values', () => {
  const price = COMPARISON_METRICS.find(metric => metric.key === 'price');
  const ergonomics = COMPARISON_METRICS.find(metric => metric.key === 'ergonomicsModifier');
  const items = [{ price: { value: 100 }, ergonomicsModifier: 2 }, { price: { value: 40 }, ergonomicsModifier: 6 }, { price: { value: null } }];
  assert.deepEqual(getMetricExtremes(items, price), { best: 40, worst: 100 });
  assert.deepEqual(getMetricExtremes(items, ergonomics), { best: 6, worst: 2 });
  assert.deepEqual(getMetricExtremes([{ ergonomicsModifier: 3 }, { ergonomicsModifier: 3 }], ergonomics), { best: null, worst: null });
  assert.equal(metricValue({}, ergonomics), null);
});
