import { normalizeCategoryIdentifier } from '../../domain/itemCategories.js';

export const MAX_COMPARE_MODULES = 8;

export const COMPARISON_METRICS = [
  { key: 'ergonomicsModifier', labelKey: 'moduleComparison.metric.ergonomics', betterDirection: 'higher', format: 'number' },
  { key: 'recoilModifier', labelKey: 'moduleComparison.metric.recoil', betterDirection: 'lower', format: 'percent' },
  { key: 'recoilVertical', labelKey: 'moduleComparison.metric.verticalRecoil', betterDirection: 'lower', format: 'number' },
  { key: 'recoilHorizontal', labelKey: 'moduleComparison.metric.horizontalRecoil', betterDirection: 'lower', format: 'number' },
  { key: 'accuracyModifier', labelKey: 'moduleComparison.metric.accuracy', betterDirection: 'higher', format: 'percent' },
  { key: 'weight', labelKey: 'moduleComparison.metric.weight', betterDirection: 'lower', format: 'weight' },
  { key: 'price', labelKey: 'moduleComparison.metric.price', betterDirection: 'lower', format: 'price' },
];

function categoryFor(item) {
  const category = (item.categories || []).find(entry => entry?.name || entry?.normalizedName || entry?.id);
  const label = category?.name || category?.normalizedName || category?.id || 'Other';
  return { key: normalizeCategoryIdentifier(category?.normalizedName || category?.id || label) || 'other', label };
}

export function getReachableModules(weapon, allMods, maxDepth = 5) {
  if (!weapon || !allMods) return [];
  const candidates = new Map();
  const queue = (weapon.properties?.slots || []).flatMap(slot =>
    (slot.filters?.allowedItems || []).map(allowed => ({ id: allowed.id, depth: 0, path: [weapon.id] })),
  );
  const visited = new Map();

  while (queue.length) {
    const current = queue.shift();
    if (!current?.id || current.depth > maxDepth) continue;
    const seenAt = visited.get(current.id);
    if (seenAt !== undefined && seenAt <= current.depth) continue;
    visited.set(current.id, current.depth);
    const item = allMods[current.id];
    if (!item) continue;
    if (!candidates.has(item.id)) candidates.set(item.id, {
      item,
      compatibilityKind: current.depth === 0 ? 'direct' : 'viaAdapter',
      path: current.path,
    });
    if (current.depth === maxDepth) continue;
    for (const slot of item.properties?.slots || []) {
      for (const allowed of slot.filters?.allowedItems || []) {
        queue.push({ id: allowed.id, depth: current.depth + 1, path: [...current.path, item.id] });
      }
    }
  }
  return [...candidates.values()];
}

export function getModuleCategories(candidates) {
  const categories = new Map();
  for (const candidate of candidates) {
    const category = categoryFor(candidate.item);
    if (!categories.has(category.key)) categories.set(category.key, category);
  }
  return [...categories.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterModulesByCategory(candidates, categoryKey, search = '') {
  const query = search.trim().toLocaleLowerCase();
  return candidates.filter(candidate => {
    const category = categoryFor(candidate.item);
    const matchesSearch = !query || [candidate.item.name, candidate.item.shortName]
      .some(value => String(value || '').toLocaleLowerCase().includes(query));
    return category.key === categoryKey && matchesSearch;
  }).sort((a, b) => (a.item.name || '').localeCompare(b.item.name || ''));
}

export function toggleComparedModule(selected, item) {
  if (selected.some(entry => entry.id === item.id)) return selected.filter(entry => entry.id !== item.id);
  if (selected.length >= MAX_COMPARE_MODULES) return selected;
  return [...selected, item];
}

export function metricValue(item, metric) {
  if (metric.key === 'price') return Number.isFinite(item?.price?.value) ? item.price.value : null;
  const value = Number(item?.[metric.key] ?? item?.properties?.[metric.key]);
  return Number.isFinite(value) ? value : null;
}

export function getMetricExtremes(items, metric) {
  if (metric.betterDirection === 'neutral') return { best: null, worst: null };
  const values = items.map(item => metricValue(item, metric)).filter(value => value !== null);
  if (values.length < 2 || new Set(values).size < 2) return { best: null, worst: null };
  return metric.betterDirection === 'higher'
    ? { best: Math.max(...values), worst: Math.min(...values) }
    : { best: Math.min(...values), worst: Math.max(...values) };
}

export function formatMetric(value, metric, locale) {
  if (value === null) return '—';
  if (metric.format === 'price') return new Intl.NumberFormat(locale, { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
  if (metric.format === 'weight') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value)} kg`;
  if (metric.format === 'percent') return `${value > 0 ? '+' : ''}${value}%`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
