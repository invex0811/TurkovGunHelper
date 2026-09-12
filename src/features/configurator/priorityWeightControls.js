import {
  CUSTOM_PRIORITY_ATTRIBUTE_KEYS,
  normalizePriorityWeights,
} from '../../domain/customPriorityAttributes.js';

function normalizeLinkedWeight(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.round(Math.min(100, Math.max(0, numericValue)));
}

export function rebalancePriorityWeights(currentWeights, changedAttribute, newValue) {
  const normalizedWeights = normalizePriorityWeights(currentWeights);
  if (!CUSTOM_PRIORITY_ATTRIBUTE_KEYS.includes(changedAttribute)) {
    return normalizedWeights;
  }

  const changedWeight = normalizeLinkedWeight(newValue, normalizedWeights[changedAttribute]);
  const remaining = 100 - changedWeight;
  const otherAttributes = CUSTOM_PRIORITY_ATTRIBUTE_KEYS.filter(attribute => attribute !== changedAttribute);
  const otherTotal = otherAttributes.reduce((total, attribute) => total + normalizedWeights[attribute], 0);

  const firstOtherWeight = otherTotal > 0
    ? Math.round(remaining * normalizedWeights[otherAttributes[0]] / otherTotal)
    : Math.ceil(remaining / 2);

  return {
    ...normalizedWeights,
    [changedAttribute]: changedWeight,
    [otherAttributes[0]]: firstOtherWeight,
    [otherAttributes[1]]: remaining - firstOtherWeight,
  };
}
