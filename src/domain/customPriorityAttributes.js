export const CUSTOM_PRIORITY_ATTRIBUTE_KEYS = Object.freeze([
  'recoil',
  'ergonomics',
  'weight',
]);

const LEGACY_RECOIL_PRIORITY_ATTRIBUTES = new Set([
  'verticalRecoil',
  'horizontalRecoil',
]);

function getPriorityStatValue(result, statName) {
  const value = result?.stats?.[statName];
  if (value == null || value === '') return Number.NaN;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

export const CUSTOM_PRIORITY_ATTRIBUTE_METADATA = Object.freeze({
  recoil: Object.freeze({
    direction: 'minimize',
    labelKey: 'config.priorityAttribute.recoil',
    getValue: result => getPriorityStatValue(result, 'recoilModifier'),
  }),
  ergonomics: Object.freeze({
    direction: 'maximize',
    labelKey: 'config.priorityAttribute.ergonomics',
    getValue: result => getPriorityStatValue(result, 'ergonomics'),
  }),
  weight: Object.freeze({
    direction: 'minimize',
    labelKey: 'config.priorityAttribute.weight',
    getValue: result => getPriorityStatValue(result, 'weight'),
  }),
});

export const CUSTOM_PRIORITY_FLOAT_EPSILON = 1e-9;
export const CUSTOM_PRIORITY_RANK_TOLERANCE = 0.10;

export const PRIORITY_SELECTION_MODES = Object.freeze({
  ORDERED: 'ordered',
  WEIGHTED: 'weighted',
});

export const DEFAULT_PRIORITY_WEIGHTS = Object.freeze({
  recoil: 50,
  ergonomics: 30,
  weight: 20,
});

export function normalizePrioritySelectionMode(value) {
  return value === PRIORITY_SELECTION_MODES.WEIGHTED
    ? PRIORITY_SELECTION_MODES.WEIGHTED
    : PRIORITY_SELECTION_MODES.ORDERED;
}

function normalizePriorityWeight(value, fallback) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(100, Math.max(0, numericValue));
}

export function normalizePriorityWeights(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(CUSTOM_PRIORITY_ATTRIBUTE_KEYS.map(attribute => [
    attribute,
    normalizePriorityWeight(source[attribute], DEFAULT_PRIORITY_WEIGHTS[attribute]),
  ]));
}

export const CUSTOM_CHARACTERISTIC_MODES = Object.freeze({
  CONSTRAINTS: 'constraints',
  PRIORITIES: 'priorities',
});

export function normalizeCustomCharacteristicMode(value) {
  return value === CUSTOM_CHARACTERISTIC_MODES.PRIORITIES
    ? CUSTOM_CHARACTERISTIC_MODES.PRIORITIES
    : CUSTOM_CHARACTERISTIC_MODES.CONSTRAINTS;
}

export function normalizePriorityAttributes(value) {
  if (!Array.isArray(value)) return [];

  const selected = [];
  for (const rawAttribute of value) {
    const attribute = LEGACY_RECOIL_PRIORITY_ATTRIBUTES.has(rawAttribute)
      ? 'recoil'
      : rawAttribute;
    if (
      !CUSTOM_PRIORITY_ATTRIBUTE_KEYS.includes(attribute)
      || selected.includes(attribute)
    ) continue;

    selected.push(attribute);
    if (selected.length === CUSTOM_PRIORITY_ATTRIBUTE_KEYS.length) break;
  }

  return selected;
}

export function togglePriorityAttribute(priorityAttributes, attribute) {
  const selected = normalizePriorityAttributes(priorityAttributes);
  if (!CUSTOM_PRIORITY_ATTRIBUTE_KEYS.includes(attribute)) return selected;
  if (selected.includes(attribute)) return selected.filter(value => value !== attribute);
  return selected.length < CUSTOM_PRIORITY_ATTRIBUTE_KEYS.length ? [...selected, attribute] : selected;
}

export function movePriorityAttribute(attributes, fromIndex, toIndex) {
  const normalized = normalizePriorityAttributes(attributes);
  if (
    !Number.isInteger(fromIndex)
    || !Number.isInteger(toIndex)
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= normalized.length
    || toIndex >= normalized.length
    || fromIndex === toIndex
  ) return [...normalized];

  const reordered = [...normalized];
  const [attribute] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, attribute);
  return reordered;
}

function getFiniteAttributeValues(results, attribute) {
  const getValue = CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].getValue;
  return (Array.isArray(results) ? results : [])
    .map(getValue)
    .filter(Number.isFinite);
}

export function getCustomPriorityBounds(candidateResults, priorityAttributes) {
  return normalizePriorityAttributes(priorityAttributes).map(attribute => {
    const values = getFiniteAttributeValues(candidateResults, attribute);
    const minimum = values.length > 0 ? Math.min(...values) : Number.NaN;
    const maximum = values.length > 0 ? Math.max(...values) : Number.NaN;
    const metadata = CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute];

    return Object.freeze({
      attribute,
      direction: metadata.direction,
      minimum,
      maximum,
    });
  });
}

function getNormalizedContribution(value, { direction, minimum, maximum }) {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum)) return 0;
  if (Math.abs(maximum - minimum) <= CUSTOM_PRIORITY_FLOAT_EPSILON) return 1;

  const contribution = direction === 'maximize'
    ? (value - minimum) / (maximum - minimum)
    : (maximum - value) / (maximum - minimum);
  return Number.isFinite(contribution) ? Math.min(1, Math.max(0, contribution)) : 0;
}

export function getCustomPriorityVectorFromBounds(result, bounds) {
  return (Array.isArray(bounds) ? bounds : []).map(bound => {
    const metadata = CUSTOM_PRIORITY_ATTRIBUTE_METADATA[bound.attribute];
    return metadata
      ? getNormalizedContribution(metadata.getValue(result), bound)
      : 0;
  });
}

export function getCustomPriorityVector(result, candidateResults, priorityAttributes) {
  return getCustomPriorityVectorFromBounds(
    result,
    getCustomPriorityBounds(candidateResults, priorityAttributes),
  );
}
