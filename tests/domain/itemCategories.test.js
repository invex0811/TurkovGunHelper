import test from 'node:test';
import assert from 'node:assert/strict';

import { hasItemCategory } from '../../src/domain/itemCategories.js';

test('stable category fields classify localized API category names', () => {
  const item = {
    categories: [
      { id: 'category-sights', name: 'Прицелы', normalizedName: 'sights' },
      { id: 'category-reflex', name: 'Коллиматорные прицелы', normalizedName: 'reflex-sight' },
    ],
  };

  assert.equal(hasItemCategory(item, 'Sights'), true);
  assert.equal(hasItemCategory(item, 'Reflex sight'), true);
  assert.equal(hasItemCategory(item, 'Scope'), false);
});

test('category name fallback supports legacy English fixture data', () => {
  assert.equal(hasItemCategory({ categories: [{ name: 'Silencer' }] }, 'Silencer'), true);
});
