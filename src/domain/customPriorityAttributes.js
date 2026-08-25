export const CUSTOM_PRIORITY_ATTRIBUTE_KEYS = Object.freeze([
  'verticalRecoil',
  'horizontalRecoil',
  'ergonomics',
  'weight',
]);

export const CUSTOM_PRIORITY_ATTRIBUTE_METADATA = Object.freeze({
  verticalRecoil: Object.freeze({
    direction: 'minimize',
    labelKey: 'config.priorityAttribute.verticalRecoil',
    getValue: result => Number(result?.stats?.recoilVertical),
  }),
  horizontalRecoil: Object.freeze({
    direction: 'minimize',
    labelKey: 'config.priorityAttribute.horizontalRecoil',
    getValue: result => Number(result?.stats?.recoilHorizontal),
  }),
  ergonomics: Object.freeze({
    direction: 'maximize',
    labelKey: 'config.priorityAttribute.ergonomics',
    getValue: result => Number(result?.stats?.ergonomics),
  }),
  weight: Object.freeze({
    direction: 'minimize',
    labelKey: 'config.priorityAttribute.weight',
    getValue: result => Number(result?.stats?.weight),
  }),
});

export const CUSTOM_PRIORITY_SCORE_EPSILON = 1e-9;

export const CUSTOM_CHARACTERISTIC_MODES = Object.freeze({
  CONSTRAINTS: 'constraints',
  PRIORITIES: 'priorities',
});

export function normalizeCustomCharacteristicMode(value) {
  return value === CUSTOM_CHARACTERISTIC_MODES.PRIORITIES
    ? CUSTOM_CHARACTERISTIC_MODES.PRIORITIES
    : CUSTOM_CHARACTERISTIC_MODES.CONSTRAINTS;
}

export function normalizePriorityMaxPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function normalizePriorityAttributes(value) {
  if (!Array.isArray(value)) return [];

  const selected = [];
  for (const attribute of value) {
    if (
      !CUSTOM_PRIORITY_ATTRIBUTE_KEYS.includes(attribute)
      || selected.includes(attribute)
    ) continue;

    selected.push(attribute);
    if (selected.length === 3) break;
  }

  return selected;
}

export function togglePriorityAttribute(priorityAttributes, attribute) {
  const selected = normalizePriorityAttributes(priorityAttributes);
  if (!CUSTOM_PRIORITY_ATTRIBUTE_KEYS.includes(attribute)) return selected;
  if (selected.includes(attribute)) return selected.filter(value => value !== attribute);
  return selected.length < 3 ? [...selected, attribute] : selected;
}

function getFiniteAttributeValues(results, attribute) {
  const getValue = CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].getValue;
  return results
    .map(getValue)
    .filter(Number.isFinite);
}

export function getCustomPriorityScore(result, candidateResults, priorityAttributes) {
  const attributes = normalizePriorityAttributes(priorityAttributes);
  if (attributes.length === 0) return null;

  const contributions = attributes.map(attribute => {
    const metadata = CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute];
    const value = metadata.getValue(result);
    const values = getFiniteAttributeValues(candidateResults, attribute);
    if (!Number.isFinite(value) || values.length === 0) return 0;

    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (Math.abs(maximum - minimum) <= CUSTOM_PRIORITY_SCORE_EPSILON) return 1;

    return metadata.direction === 'maximize'
      ? (value - minimum) / (maximum - minimum)
      : (maximum - value) / (maximum - minimum);
  });

  return contributions.reduce((sum, contribution) => sum + contribution, 0) / contributions.length;
}

export function compareCustomPriorityScores(left, right) {
  if (Math.abs(left - right) <= CUSTOM_PRIORITY_SCORE_EPSILON) return 0;
  return left > right ? 1 : -1;
}
