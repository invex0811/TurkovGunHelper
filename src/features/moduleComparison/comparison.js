import { normalizeCategoryIdentifier } from '../../domain/itemCategories.js';

export const COMPARISON_METRICS = [
  { key: 'ergonomicsModifier', labelKey: 'moduleComparison.metric.ergonomics', betterDirection: 'higher', format: 'number', source: 'item', valueKind: 'modifier' },
  { key: 'recoilModifier', labelKey: 'moduleComparison.metric.recoil', betterDirection: 'lower', format: 'percent', source: 'item', valueKind: 'modifier' },
  { key: 'accuracyModifier', labelKey: 'moduleComparison.metric.accuracy', betterDirection: 'higher', format: 'percent', source: 'item', valueKind: 'modifier' },
  { key: 'velocity', labelKey: 'moduleComparison.metric.velocity', betterDirection: 'higher', format: 'number', source: 'item', valueKind: 'modifier' },
  { key: 'loudness', labelKey: 'moduleComparison.metric.loudness', betterDirection: 'lower', format: 'number', source: 'item', valueKind: 'modifier' },
  { key: 'weight', labelKey: 'moduleComparison.metric.weight', betterDirection: 'lower', format: 'weight', source: 'item', valueKind: 'absolute' },
  { key: 'capacity', labelKey: 'moduleComparison.metric.capacity', betterDirection: 'higher', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'loadModifier', labelKey: 'moduleComparison.metric.loadModifier', betterDirection: 'lower', format: 'percent', source: 'properties', valueKind: 'modifier' },
  { key: 'ammoCheckModifier', labelKey: 'moduleComparison.metric.ammoCheckModifier', betterDirection: 'lower', format: 'percent', source: 'properties', valueKind: 'modifier' },
  { key: 'malfunctionChance', labelKey: 'moduleComparison.metric.malfunctionChance', betterDirection: 'lower', format: 'percent', source: 'properties', valueKind: 'absolute' },
  { key: 'sightingRange', labelKey: 'moduleComparison.metric.sightingRange', betterDirection: 'higher', format: 'distance', source: 'properties', valueKind: 'absolute' },
  { key: 'zoomLevels', labelKey: 'moduleComparison.metric.magnification', betterDirection: 'higher', format: 'zoom', source: 'derived', valueKind: 'absolute' },
  { key: 'centerOfImpact', labelKey: 'moduleComparison.metric.centerOfImpact', betterDirection: 'lower', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'deviationCurve', labelKey: 'moduleComparison.metric.deviationCurve', betterDirection: 'lower', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'deviationMax', labelKey: 'moduleComparison.metric.deviationMax', betterDirection: 'lower', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'durabilityBurnFactor', labelKey: 'moduleComparison.metric.durabilityBurn', betterDirection: 'lower', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'heatFactor', labelKey: 'moduleComparison.metric.heatFactor', betterDirection: 'lower', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'coolingFactor', labelKey: 'moduleComparison.metric.coolingFactor', betterDirection: 'higher', format: 'number', source: 'properties', valueKind: 'absolute' },
  { key: 'price', labelKey: 'moduleComparison.metric.price', betterDirection: 'lower', format: 'price', source: 'price', valueKind: 'absolute' },
];

export function getComparisonMetric(key) {
  return COMPARISON_METRICS.find(metric => metric.key === key) || null;
}

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

export function getCandidatesForCategory(candidates, categoryKey) {
  return candidates.filter(candidate => categoryFor(candidate.item).key === categoryKey);
}

export function toggleComparedModule(selected, item) {
  if (selected.some(entry => entry.id === item.id)) return selected.filter(entry => entry.id !== item.id);
  return [...selected, item];
}

export function selectComparedModules(selected, items) {
  const selectedById = new Map(selected.map(item => [item.id, item]));
  items.forEach(item => selectedById.set(item.id, item));
  return [...selectedById.values()];
}

export function deselectComparedModules(selected, ids) {
  const idsToRemove = new Set(ids);
  return selected.filter(item => !idsToRemove.has(item.id));
}

export function filterComparisonRows(candidates, options = {}) {
  const query = String(options.search || '').trim().toLocaleLowerCase();
  const selectedIds = options.selectedIds || new Set();
  return candidates.filter(candidate => {
    const item = candidate.item;
    if (query && ![item.name, item.shortName].some(value => String(value || '').toLocaleLowerCase().includes(query))) return false;
    if (options.compatibility && candidate.compatibilityKind !== options.compatibility) return false;
    if (options.selectedOnly && !selectedIds.has(item.id)) return false;
    if (options.withPrice && !hasMetricValue(item, getComparisonMetric('price'))) return false;
    return true;
  });
}

function comparisonValue(row, key) {
  if (key === 'name') return String(row.item.name || row.item.shortName || '');
  const metric = getComparisonMetric(key);
  return metric ? metricValue(row.item, metric) : null;
}

export function sortComparisonRows(rows, sortKey = 'name', direction = 'asc', locale) {
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = comparisonValue(left, sortKey);
    const b = comparisonValue(right, sortKey);
    const aMissing = a === null || a === undefined || a === '';
    const bMissing = b === null || b === undefined || b === '';
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b), locale) * multiplier;
    return (a - b) * multiplier;
  });
}

export function getInitialSortDirection(key) {
  const metric = getComparisonMetric(key);
  if (!metric) return 'asc';
  return metric.betterDirection === 'higher' ? 'desc' : 'asc';
}

export function normalizeComparisonSort(sortKey, sortDirection, availableMetrics) {
  if (sortKey === 'name' || availableMetrics.some(metric => metric.key === sortKey)) {
    return { sortKey, sortDirection };
  }
  return { sortKey: 'name', sortDirection: 'asc' };
}

function metricRawValue(item, metric) {
  if (!metric) return null;
  if (metric.source === 'item') return item?.[metric.key];
  if (metric.source === 'properties') return item?.properties?.[metric.key];
  if (metric.source === 'price') return item?.price?.value;
  if (metric.source === 'derived' && metric.key === 'zoomLevels') {
    const levels = item?.properties?.zoomLevels;
    if (!Array.isArray(levels)) return null;
    const values = levels.flat(Infinity).map(Number).filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }
  return null;
}

export function metricValue(item, metric) {
  const rawValue = metricRawValue(item, metric);
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

export function hasMetricValue(item, metric) {
  return metricValue(item, metric) !== null;
}

export function isMetricInformative(items, metric) {
  const values = items.map(item => metricValue(item, metric)).filter(value => value !== null);
  if (!values.length) return false;
  return metric.valueKind === 'modifier' ? values.some(value => value !== 0) : true;
}

export function getAvailableComparisonMetrics(candidates) {
  return COMPARISON_METRICS.filter(metric => isMetricInformative(candidates.map(candidate => candidate.item), metric));
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
  if (metric.format === 'distance') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} m`;
  if (metric.format === 'zoom') return `x${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
