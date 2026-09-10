import {
  CUSTOM_PRIORITY_FLOAT_EPSILON,
  CUSTOM_PRIORITY_RANK_TOLERANCE,
  getCustomPriorityBounds,
  getCustomPriorityVectorFromBounds,
  normalizePriorityAttributes,
} from '../customPriorityAttributes.js';
import { getBuildTieKey } from './scoring.js';

function getCandidateResult(candidate) {
  return candidate?.result ?? candidate;
}

function getCandidatePrice(candidate) {
  const priceValue = getCandidateResult(candidate)?.stats?.price;
  if (priceValue == null || priceValue === '') return Number.POSITIVE_INFINITY;
  const price = Number(priceValue);
  return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
}

function getCandidateTieKey(candidate) {
  const result = getCandidateResult(candidate);
  return Array.isArray(result?.build) ? getBuildTieKey(result) : '';
}

function compareCandidatesByTieBreak(left, right) {
  const leftPrice = getCandidatePrice(left);
  const rightPrice = getCandidatePrice(right);
  if (leftPrice < rightPrice) return -1;
  if (leftPrice > rightPrice) return 1;
  return getCandidateTieKey(left).localeCompare(getCandidateTieKey(right));
}

function selectCustomPriorityCandidateWithDiagnostics(candidates, priorityAttributes) {
  const originalPool = Array.isArray(candidates) ? [...candidates] : [];
  const attributes = normalizePriorityAttributes(priorityAttributes);
  const bounds = getCustomPriorityBounds(
    originalPool.map(getCandidateResult),
    attributes,
  );
  const entries = originalPool.map(candidate => Object.freeze({
    candidate,
    vector: getCustomPriorityVectorFromBounds(getCandidateResult(candidate), bounds),
  }));
  const diagnostics = [];
  let shortlist = entries;

  for (let rank = 0; rank < attributes.length; rank += 1) {
    const beforeCount = shortlist.length;
    const bestNormalizedContribution = beforeCount === 0
      ? 0
      : Math.max(...shortlist.map(entry => entry.vector[rank]));
    shortlist = shortlist.filter(entry => (
      bestNormalizedContribution - entry.vector[rank]
        <= CUSTOM_PRIORITY_RANK_TOLERANCE + CUSTOM_PRIORITY_FLOAT_EPSILON
    ));
    diagnostics.push(Object.freeze({
      rank: rank + 1,
      attribute: attributes[rank],
      beforeCount,
      bestNormalizedContribution,
      tolerance: CUSTOM_PRIORITY_RANK_TOLERANCE,
      afterCount: shortlist.length,
    }));
  }

  const selectedEntry = [...shortlist].sort(
    (left, right) => compareCandidatesByTieBreak(left.candidate, right.candidate),
  )[0];

  return Object.freeze({
    candidate: selectedEntry?.candidate ?? null,
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Select from a complete Priority candidate pool. Every rank uses vectors normalized
 * against the original pool; only the shortlist changes between ranks.
 */
export function selectCustomPriorityCandidate(candidates, priorityAttributes) {
  return selectCustomPriorityCandidateWithDiagnostics(candidates, priorityAttributes).candidate;
}

export function getCustomPrioritySelectionDiagnostics(candidates, priorityAttributes) {
  return selectCustomPriorityCandidateWithDiagnostics(candidates, priorityAttributes).diagnostics;
}
