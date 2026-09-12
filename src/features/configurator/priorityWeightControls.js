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

function normalizeHierarchicalWeights(currentWeights) {
  const normalizedWeights = normalizePriorityWeights(currentWeights);
  const recoil = normalizeLinkedWeight(normalizedWeights.recoil, 50);
  const remaining = 100 - recoil;
  const weight = Math.min(normalizeLinkedWeight(normalizedWeights.weight, 20), remaining);

  return {
    recoil,
    ergonomics: remaining - weight,
    weight,
  };
}

export function getPriorityWeightMax(currentWeights, attribute) {
  if (attribute === 'recoil') return 100;
  if (attribute !== 'ergonomics' && attribute !== 'weight') return 0;
  return 100 - normalizeHierarchicalWeights(currentWeights).recoil;
}

export function rebalancePriorityWeights(currentWeights, changedAttribute, newValue) {
  const normalizedWeights = normalizeHierarchicalWeights(currentWeights);
  if (!CUSTOM_PRIORITY_ATTRIBUTE_KEYS.includes(changedAttribute)) {
    return normalizedWeights;
  }

  if (changedAttribute === 'recoil') {
    const recoil = normalizeLinkedWeight(newValue, normalizedWeights.recoil);
    const remaining = 100 - recoil;
    const weight = Math.min(normalizedWeights.weight, remaining);
    return { recoil, ergonomics: remaining - weight, weight };
  }

  const recoil = normalizedWeights.recoil;
  const remaining = 100 - recoil;
  const changedWeight = Math.min(
    normalizeLinkedWeight(newValue, normalizedWeights[changedAttribute]),
    remaining,
  );

  return changedAttribute === 'ergonomics'
    ? { recoil, ergonomics: changedWeight, weight: remaining - changedWeight }
    : { recoil, ergonomics: remaining - changedWeight, weight: changedWeight };
}
