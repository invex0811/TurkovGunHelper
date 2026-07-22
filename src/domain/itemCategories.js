export function normalizeCategoryIdentifier(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getItemCategoryKeys(item) {
  const keys = new Set();

  (item?.categories || []).forEach(category => {
    if (typeof category === 'string') {
      keys.add(normalizeCategoryIdentifier(category));
      return;
    }

    [category?.normalizedName, category?.id, category?.name].forEach(value => {
      const key = normalizeCategoryIdentifier(value);
      if (key) keys.add(key);
    });
  });

  return keys;
}

export function hasItemCategory(item, categoryName) {
  return getItemCategoryKeys(item).has(normalizeCategoryIdentifier(categoryName));
}

export function categoryMatches(category, categoryName) {
  return hasItemCategory({ categories: [category] }, categoryName);
}
