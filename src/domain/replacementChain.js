import { _calculateWeighted } from './calculator/candidateSearch.js';
import { createCalculationCache } from './calculator/calculationCache.js';
import { PRICE_AWARE_TARGET } from './calculator/constants.js';
import { compareConstraintCandidates } from './calculator/orchestration.js';
import { excludeRefOnlyItems } from './calculator/pricing.js';
import { getPrioritySearchRoutes } from './calculator/priorityCandidates.js';
import {
  selectCustomPriorityCandidate,
  selectWeightedCustomPriorityCandidate,
} from './calculator/prioritySelection.js';
import { getBuildTieKey, getCustomScore, getMetaResultScore } from './calculator/scoring.js';
import { recalculateBuildStats } from './calculator/stats.js';
import { getPurchasePriceValue } from '../data/price/priceMapper.js';
import { evaluateCustomConstraints } from './customConstraints.js';
import { hasItemCategory } from './itemCategories.js';
import { isValidSightForMode } from './sightModes.js';
import {
  normalizePriorityAttributes,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
} from './customPriorityAttributes.js';
import {
  findBuildSlotContext,
  getCompatibleItemsForSlot,
  validateEditedBuild,
} from './weaponBuildEditor.js';
import {
  getBuildItemInstanceId,
  getBuildSlotId,
  getBuildSlotInstanceId,
} from './weaponAssembly.js';

export const CHAIN_GOAL_MODES = Object.freeze({
  META: 'meta',
  CONSTRAINTS: 'constraints',
  PRIORITIES: 'priorities',
});

// Each alternative module is offered as up to four chains; identical chains
// are merged and carry every profile that produced them.
export const CHAIN_PROFILES = Object.freeze({
  GOAL: 'goal',
  CHEAP: 'cheap',
  ERGONOMICS: 'ergonomics',
  RECOIL: 'recoil',
});

export const CHAIN_NODE_ORIGINS = Object.freeze({
  ROOT: 'root',
  KEPT: 'kept',
  AUTO: 'auto',
  MANUAL: 'manual',
});

const META_SCORING = Object.freeze({
  ergoCap: 50,
  ergoSoftCap: 70,
  ergoWeight: 1,
  overflowErgoWeight: 0.15,
  recoilWeight: 3,
  weightWeight: 15,
});
const META_RUN = Object.freeze({
  ergoWeight: 1,
  recoilWeight: 3,
  priceWeight: 0,
  ergoCap: 50,
  targetType: 'meta',
  weightWeight: 15,
  overflowErgoWeight: 0.15,
  ergoSoftCap: 70,
});
const PRICE_AWARE_RUN = Object.freeze({
  ergoWeight: 1,
  recoilWeight: 3,
  priceWeight: 0.0001,
  ergoCap: 100,
  targetType: PRICE_AWARE_TARGET,
  weightWeight: 0.001,
  overflowErgoWeight: 0,
  ergoSoftCap: 100,
  capabilities: { budgetAwareSearch: true },
});
const CONSTRAINT_SWEEP_STEPS = 4;
const CUSTOM_RUN = Object.freeze({
  ergoWeight: 1,
  recoilWeight: 1,
  priceWeight: 0,
  ergoCap: 100,
  targetType: 'custom',
  weightWeight: 0,
  overflowErgoWeight: 0,
  ergoSoftCap: 100,
});
// Weights of the non-goal profiles. The cheap profile only fills required
// slots, and a price-only score picks the cheapest module for each.
const PROFILE_RUNS = Object.freeze({
  [CHAIN_PROFILES.CHEAP]: Object.freeze({ ...CUSTOM_RUN, ergoWeight: 0, recoilWeight: 0, priceWeight: 1 }),
  [CHAIN_PROFILES.ERGONOMICS]: Object.freeze({ ...CUSTOM_RUN, recoilWeight: 0, weightWeight: 0.001 }),
  [CHAIN_PROFILES.RECOIL]: Object.freeze({ ...CUSTOM_RUN, ergoWeight: 0, weightWeight: 0.001 }),
});
const CONSTRAINT_VIOLATION_EPSILON = 1e-9;
// Mounts stacked under one sight (rail, riser, offset) rarely exceed three.
const MAX_SIGHT_MOUNT_DEPTH = 4;
const SIGHT_PATHS_PER_SIGHT = 3;

function isSightItem(item) {
  return hasItemCategory(item, 'Sights');
}

function isMountItem(item) {
  return hasItemCategory(item, 'Mount');
}

function subtreeHasSight(node) {
  if (!node) return false;
  return isSightItem(node.item) || (node.children || []).some(subtreeHasSight);
}

// A sight, or a mount carrying one. A handguard or receiver that merely has a
// sight somewhere below it is not a sight assembly.
function isSightAssemblyNode(node) {
  if (!node) return false;
  return isSightItem(node.item) || (isMountItem(node.item) && subtreeHasSight(node));
}

function getAllowedIds(slot) {
  return new Set((slot?.filters?.allowedItems || []).map(item => item.id).filter(Boolean));
}

function itemsConflict(first, second) {
  if (!first?.id || !second?.id) return false;
  return (first.conflictingItems || []).some(item => item.id === second.id)
    || (second.conflictingItems || []).some(item => item.id === first.id);
}

function getNodeSlot(node) {
  return node.slot ?? node.sourceSlot ?? null;
}

function getNodeSlotIndex(node) {
  return node.slotIndex ?? node.sourceSlotIndex ?? 0;
}

function createChainNode(item, slot, slotIndex, origin, children = []) {
  return { item, slot, slotIndex, origin, children };
}

function sortChildren(children) {
  return children.sort((first, second) => first.slotIndex - second.slotIndex);
}

function cloneChainNode(node) {
  return { ...node, children: node.children.map(cloneChainNode) };
}

export function collectChainNodes(node, result = []) {
  if (!node) return result;
  result.push(node);
  node.children.forEach(child => collectChainNodes(child, result));
  return result;
}

export function getChainNodeAtPath(chain, path = []) {
  let node = chain;
  for (const slotIndex of path) {
    node = node?.children.find(child => child.slotIndex === slotIndex) ?? null;
  }
  return node;
}

function findPreservedSlot(parentItem, oldChild, usedSlotIndexes) {
  const oldSlot = getNodeSlot(oldChild);
  const oldSlotIndex = getNodeSlotIndex(oldChild);
  const candidates = (parentItem?.properties?.slots || [])
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(candidate => (
      !usedSlotIndexes.has(candidate.slotIndex)
      && getAllowedIds(candidate.slot).has(oldChild.item.id)
    ));

  return candidates.find(candidate => (
    candidate.slotIndex === oldSlotIndex
    && (candidate.slot === oldSlot || candidate.slot.nameId === oldSlot?.nameId)
  ))
    || candidates.find(candidate => candidate.slot.nameId && candidate.slot.nameId === oldSlot?.nameId)
    || candidates.find(candidate => candidate.slot.name === (oldSlot?.name ?? oldChild.slotName))
    || candidates[0]
    || null;
}

// Moves every old child that still fits onto the new parent, recursively, the
// same way a single-module replacement keeps compatible attachments.
function preserveChildren(oldNode, newParentItem) {
  const children = [];
  const usedSlotIndexes = new Set();

  (oldNode?.children || []).forEach(oldChild => {
    const match = findPreservedSlot(newParentItem, oldChild, usedSlotIndexes);
    if (!match) return;
    const branchItems = collectChainNodes(oldChild).map(node => node.item);
    if (branchItems.some(item => itemsConflict(newParentItem, item))) return;

    usedSlotIndexes.add(match.slotIndex);
    children.push(createChainNode(
      oldChild.item,
      match.slot,
      match.slotIndex,
      oldChild.origin === CHAIN_NODE_ORIGINS.MANUAL ? CHAIN_NODE_ORIGINS.MANUAL : CHAIN_NODE_ORIGINS.KEPT,
      preserveChildren(oldChild, oldChild.item),
    ));
  });

  return sortChildren(children);
}

function collectEmptySlotGroups(node, path = [], groups = []) {
  const occupied = new Set(node.children.map(child => child.slotIndex));
  const emptySlots = (node.item.properties?.slots || [])
    .filter((slot, slotIndex) => !occupied.has(slotIndex));
  if (emptySlots.length > 0) groups.push({ path, slots: emptySlots });
  node.children.forEach(child => collectEmptySlotGroups(child, [...path, child.slotIndex], groups));
  return groups;
}

// Rebuilds the nested chain from the calculator's pre-order branch items: each
// item belongs to the deepest open slot that accepts it.
function parseBranchItems(items, state, slot, slotIndex) {
  const part = items[state.index];
  state.index += 1;
  const node = createChainNode(part.item, slot, slotIndex, CHAIN_NODE_ORIGINS.AUTO);
  const slots = part.item.properties?.slots || [];
  const usedSlotIndexes = new Set();

  while (state.index < items.length) {
    const next = items[state.index];
    const childSlotIndex = slots.findIndex((childSlot, index) => (
      !usedSlotIndexes.has(index)
      && childSlot.name === next.slotName
      && getAllowedIds(childSlot).has(next.item.id)
    ));
    if (childSlotIndex < 0) break;
    usedSlotIndexes.add(childSlotIndex);
    node.children.push(parseBranchItems(items, state, slots[childSlotIndex], childSlotIndex));
  }

  sortChildren(node.children);
  return node;
}

function attachFilledSlots(chain, scopePath, groups, filledSlots) {
  const filledChain = cloneChainNode(chain);
  filledSlots.forEach(({ groupIndex, slot, items }) => {
    const group = groups[groupIndex];
    const parent = getChainNodeAtPath(filledChain, [...scopePath, ...group.path]);
    if (!parent || items.length === 0) return;
    const slotIndex = (parent.item.properties?.slots || []).indexOf(slot);
    if (slotIndex < 0) return;
    parent.children.push(parseBranchItems(items, { index: 0 }, slot, slotIndex));
    sortChildren(parent.children);
  });
  return filledChain;
}

// A mount picked automatically only earns its place by carrying something.
function pruneEmptyAutoMounts(node) {
  node.children = node.children.filter(child => {
    pruneEmptyAutoMounts(child);
    return !(
      child.origin === CHAIN_NODE_ORIGINS.AUTO
      && child.children.length === 0
      && child.slot.required !== true
      && isMountItem(child.item)
    );
  });
  return node;
}

export function findEmptyRequiredChainSlots(chain) {
  const missing = [];
  collectChainNodes(chain).forEach(node => {
    const occupied = new Set(node.children.map(child => child.slotIndex));
    (node.item.properties?.slots || []).forEach((slot, slotIndex) => {
      if (slot.required === true && !occupied.has(slotIndex)) missing.push({ node, slot, slotIndex });
    });
  });
  return missing;
}

function isEligibleForBudget(result, maxPrice) {
  return !(maxPrice > 0) || (result.stats.price != null && result.stats.price <= maxPrice);
}

// A sight and the mounts that carry it are replaced as one assembly: a click on
// any of them targets the topmost mount of that sight assembly.
export function resolveChainSlotContext(weapon, buildParts, slotInstanceId) {
  const { slotContext } = findBuildSlotContext(weapon, buildParts, slotInstanceId);
  if (!slotContext) return null;

  let target = slotContext;
  while (target.parent?.parent && (isMountItem(target.parent.item) || isSightItem(target.parent.item))) {
    const parentNode = target.parent;
    const parentSlot = parentNode.parent.slots.find(candidate => candidate.installedNode === parentNode);
    if (!parentSlot) break;
    target = parentSlot;
  }
  return target !== slotContext && isSightAssemblyNode(target.installedNode) ? target : slotContext;
}

export function createReplacementChainPlanner({
  weapon,
  buildParts = [],
  allMods,
  slotInstanceId,
  goal = {},
  options = {},
}) {
  const slotContext = resolveChainSlotContext(weapon, buildParts, slotInstanceId);
  if (!slotContext || !allMods) return null;

  const currentNode = slotContext.installedNode;
  const isSightAssembly = isSightAssemblyNode(currentNode);
  const currentSight = collectChainNodes(currentNode).find(node => isSightItem(node.item))?.item ?? null;
  const oldSubtreeParts = new Set(
    collectChainNodes(currentNode).map(node => node.buildPart).filter(Boolean),
  );
  const currentItems = collectChainNodes(currentNode).map(node => node.item);
  const remainingParts = buildParts.filter(part => !oldSubtreeParts.has(part));
  const remainingFixedBuild = remainingParts.map(part => ({ slotName: part.slotName, item: part.item }));
  const modMap = excludeRefOnlyItems(allMods, options);
  const calculationCache = createCalculationCache();
  const priceOptions = {
    priceMode: options.priceMode,
    includeTraderPrices: options.includeTraderPrices,
    traderLevels: options.traderLevels,
    strictTraderLevels: options.strictTraderLevels,
    includeRefOffers: options.includeRefOffers,
  };
  const maxPrice = Number(options.maxPrice) || 0;
  const goalMode = Object.values(CHAIN_GOAL_MODES).includes(goal.mode) ? goal.mode : CHAIN_GOAL_MODES.META;
  const customLimits = goal.customLimits || {};
  const priorityOptions = { ...options, maxWeight: 0 };

  function runFill(run, fixedBuild, groups, runOptions = options, capabilities = {}) {
    return _calculateWeighted(
      weapon,
      run.ergoWeight,
      run.recoilWeight,
      run.priceWeight,
      modMap,
      runOptions,
      run.ergoCap,
      run.targetType,
      run.weightWeight,
      run.overflowErgoWeight,
      run.ergoSoftCap,
      calculationCache,
      {
        ...run.capabilities,
        ...capabilities,
        slotFill: { fixedBuild, slotGroups: groups.map(group => ({ slots: group.slots })) },
      },
    );
  }

  function selectMetaResult(fixedBuild, groups) {
    const results = [runFill(META_RUN, fixedBuild, groups)];
    if (maxPrice > 0) results.push(runFill(PRICE_AWARE_RUN, fixedBuild, groups));
    return results.reduce((best, result) => {
      const score = getMetaResultScore(result, weapon, META_SCORING);
      const bestScore = getMetaResultScore(best, weapon, META_SCORING);
      if (score > bestScore) return result;
      if (score === bestScore && result.stats.price != null
        && (best.stats.price == null || result.stats.price < best.stats.price)) return result;
      return best;
    });
  }

  function selectConstraintResult(fixedBuild, groups) {
    const guided = { characteristicConstraints: customLimits };
    const unguided = { characteristicConstraints: customLimits, constraintGuidance: false };
    const results = [runFill(CUSTOM_RUN, fixedBuild, groups, options, guided)];
    const pick = () => {
      let selected = null;
      results.forEach(result => {
        if (result.error || !result.constraintEvaluation) return;
        const candidate = { result, tieKey: getBuildTieKey(result) };
        if (!selected || compareConstraintCandidates(candidate, selected) < 0) selected = candidate;
      });
      return selected?.result ?? null;
    };

    let selected = pick();
    if (!selected?.constraintEvaluation.satisfied) {
      for (let step = 0; step <= CONSTRAINT_SWEEP_STEPS; step += 1) {
        const ergoWeight = step / CONSTRAINT_SWEEP_STEPS;
        results.push(runFill(
          { ...CUSTOM_RUN, ergoWeight, recoilWeight: 1 - ergoWeight, weightWeight: 0.001 },
          fixedBuild,
          groups,
          options,
          unguided,
        ));
      }
      results.push(runFill(META_RUN, fixedBuild, groups, options, unguided));
      selected = pick();
    }
    return selected ?? results[0];
  }

  function selectPriorityResult(fixedBuild, groups) {
    const routes = getPrioritySearchRoutes();
    const results = routes.map(route => runFill({
      ergoWeight: route.ergoWeight,
      recoilWeight: route.recoilWeight,
      priceWeight: 0,
      ergoCap: 100,
      targetType: 'custom',
      weightWeight: route.weightWeight,
      overflowErgoWeight: 0,
      ergoSoftCap: 100,
    }, fixedBuild, groups, priorityOptions));
    if (maxPrice > 0) {
      results.push(runFill({ ...PRICE_AWARE_RUN, targetType: 'custom' }, fixedBuild, groups, priorityOptions));
    }

    const seen = new Set();
    const candidates = [];
    results.forEach(result => {
      if (result.error || !isEligibleForBudget(result, maxPrice)) return;
      const tieKey = getBuildTieKey(result);
      if (seen.has(tieKey)) return;
      seen.add(tieKey);
      candidates.push({ result });
    });
    const selected = goal.prioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED
      ? selectWeightedCustomPriorityCandidate(candidates, normalizePriorityWeights(goal.priorityWeights))
      : selectCustomPriorityCandidate(candidates, normalizePriorityAttributes(goal.priorityAttributes));
    return selected?.result ?? results[0];
  }

  function getFixedBuild(chain) {
    return [
      ...remainingFixedBuild,
      ...collectChainNodes(chain).map(node => ({ slotName: node.slot.name, item: node.item })),
    ];
  }

  function selectProfileResult(profile, fixedBuild, groups) {
    if (profile !== CHAIN_PROFILES.GOAL) return runFill(PROFILE_RUNS[profile], fixedBuild, groups);
    if (goalMode === CHAIN_GOAL_MODES.CONSTRAINTS) return selectConstraintResult(fixedBuild, groups);
    if (goalMode === CHAIN_GOAL_MODES.PRIORITIES) return selectPriorityResult(fixedBuild, groups);
    return selectMetaResult(fixedBuild, groups);
  }

  // Completes the empty slots below scopePath using the profile (the build
  // goal by default), while the rest of the build and chain stays fixed.
  // Automatically added mounts that ended up carrying nothing are dropped.
  function fillEmptySlots(chain, scopePath = [], profile = CHAIN_PROFILES.GOAL) {
    const scopeNode = getChainNodeAtPath(chain, scopePath);
    if (!scopeNode) return chain;
    // The cheap profile only completes what the weapon needs to work.
    const groups = collectEmptySlotGroups(scopeNode)
      .map(group => (profile === CHAIN_PROFILES.CHEAP
        ? { ...group, slots: group.slots.filter(slot => slot.required === true) }
        : group))
      .filter(group => group.slots.length > 0);
    if (groups.length === 0) return chain;

    const result = selectProfileResult(profile, getFixedBuild(chain), groups);
    return pruneEmptyAutoMounts(attachFilledSlots(chain, scopePath, groups, result.filledSlots || []));
  }

  // Builds the chain twice, keeping the old attachments and from scratch, and
  // keeps the old ones unless the profile finds something strictly better.
  function buildChain(rootItem, profile = CHAIN_PROFILES.GOAL) {
    const createRoot = children => createChainNode(
      rootItem,
      slotContext.slot,
      slotContext.slotIndex,
      CHAIN_NODE_ORIGINS.ROOT,
      children,
    );
    const preserved = preserveChildren(currentNode, rootItem);
    const kept = fillEmptySlots(createRoot(preserved), [], profile);
    if (preserved.length === 0) return kept;

    const fresh = fillEmptySlots(createRoot([]), [], profile);
    return comparePlansForProfile(planChain(fresh), planChain(kept), profile) < 0 ? fresh : kept;
  }

  function getInstalledIdsOutside(chain, excludedNode) {
    const excluded = new Set(excludedNode ? collectChainNodes(excludedNode) : []);
    return [
      weapon,
      ...remainingParts.map(part => part.item),
      ...collectChainNodes(chain).filter(node => !excluded.has(node)).map(node => node.item),
    ];
  }

  function getSlotOptions(chain, parentPath, slotIndex) {
    const parent = getChainNodeAtPath(chain, parentPath);
    const slot = parent?.item.properties?.slots?.[slotIndex];
    if (!slot) return [];
    const currentChild = parent.children.find(child => child.slotIndex === slotIndex) ?? null;
    const installedItems = getInstalledIdsOutside(chain, currentChild);
    const installedIds = new Set(installedItems.map(item => item.id));

    return [...getAllowedIds(slot)]
      .map(itemId => modMap[itemId] || (currentChild?.item.id === itemId ? currentChild.item : null))
      .filter(item => (
        item
        && !installedIds.has(item.id)
        && !installedItems.some(installedItem => itemsConflict(item, installedItem))
      ));
  }

  // Replaces one slot inside the chain; the new module keeps what still fits
  // from the old one and the rest of its subtree is completed automatically.
  function setSlotItem(chain, parentPath, slotIndex, nextItem) {
    const nextChain = cloneChainNode(chain);
    const parent = getChainNodeAtPath(nextChain, parentPath);
    const slot = parent?.item.properties?.slots?.[slotIndex];
    if (!slot) return chain;

    const previousChild = parent.children.find(child => child.slotIndex === slotIndex) ?? null;
    parent.children = parent.children.filter(child => child !== previousChild);
    if (!nextItem) return nextChain;

    parent.children.push(createChainNode(
      nextItem,
      slot,
      slotIndex,
      CHAIN_NODE_ORIGINS.MANUAL,
      preserveChildren(previousChild, nextItem),
    ));
    sortChildren(parent.children);
    return fillEmptySlots(nextChain, [...parentPath, slotIndex]);
  }

  function toBuildParts(chain) {
    const parts = [];
    function visit(node, parentItem, parentInstanceId) {
      const slotInstanceId = getBuildSlotInstanceId(parentInstanceId, node.slot, node.slotIndex);
      parts.push({
        slotName: node.slot.name,
        slotId: getBuildSlotId(node.slot, node.slotIndex),
        slotIndex: node.slotIndex,
        slotInstanceId,
        parentItemId: parentItem.id,
        parentInstanceId,
        item: node.item,
      });
      const instanceId = getBuildItemInstanceId(slotInstanceId, node.item);
      node.children.forEach(child => visit(child, node.item, instanceId));
    }
    visit(chain, slotContext.parent.item, slotContext.parent.instanceId);
    return parts;
  }

  function planChain(chain) {
    const chainParts = toBuildParts(chain);
    const firstRemovedIndex = buildParts.findIndex(part => oldSubtreeParts.has(part));
    const insertionIndex = firstRemovedIndex < 0
      ? remainingParts.length
      : buildParts.slice(0, firstRemovedIndex).filter(part => !oldSubtreeParts.has(part)).length;
    const nextBuildParts = [
      ...remainingParts.slice(0, insertionIndex),
      ...chainParts,
      ...remainingParts.slice(insertionIndex),
    ];
    const errors = validateEditedBuild(weapon, nextBuildParts);
    const stats = recalculateBuildStats(weapon, nextBuildParts, priceOptions).stats;
    const chainItemIds = new Set(chainParts.map(part => part.item.id));
    const removedItems = collectChainNodes(currentNode)
      .map(node => node.item)
      .filter(item => !chainItemIds.has(item.id));

    const focusItem = isSightAssembly
      ? (chainParts.find(part => isSightItem(part.item))?.item ?? chain.item)
      : chain.item;

    const chainPrice = chainParts.reduce((sum, part) => {
      const price = getPurchasePriceValue(part.item, priceOptions, null);
      return sum !== null && Number.isFinite(price) ? sum + price : null;
    }, 0);

    return {
      key: chainParts.map(part => part.item.id).join('|'),
      chainPrice,
      chain,
      focusItem,
      buildParts: nextBuildParts,
      chainItems: chainParts.map(part => part.item),
      currentItems,
      removedItems,
      errors,
      missingRequiredSlots: findEmptyRequiredChainSlots(chain),
      requirementViolations: countRequirementViolations(nextBuildParts, stats),
      stats,
    };
  }

  // Hard build settings a chain can break: the sight mode, the suppressor
  // mode, required modules and the hard maximum weight.
  function countRequirementViolations(parts, stats) {
    const items = [weapon, ...parts.map(part => part.item)];
    const itemIds = new Set(items.map(item => item.id));
    const sights = items.filter(isSightItem);
    const hasSuppressor = items.some(item => hasItemCategory(item, 'Silencer'));
    const maxWeight = Number(options.maxWeight) || 0;
    let violations = (options.requiredItemIds || []).filter(itemId => !itemIds.has(String(itemId))).length;

    if (options.sightMode === 'none' ? sights.length > 0
      : options.requireSight && !sights.some(item => isValidSightForMode(item, options.sightMode))) {
      violations += 1;
    }
    if ((options.requireSuppressor && !hasSuppressor) || (options.forbidSuppressor && hasSuppressor)) violations += 1;
    if (maxWeight > 0 && Number(stats.weight) > maxWeight) violations += 1;
    return violations;
  }

  function getPlanResult(plan) {
    return { build: plan.buildParts, stats: plan.stats };
  }

  function getPlanTieKey(plan) {
    return plan.chainItems.map(item => item.id).sort().join('|');
  }

  function compareByPriceAndKey(first, second) {
    const firstPrice = first.chainPrice ?? Number.POSITIVE_INFINITY;
    const secondPrice = second.chainPrice ?? Number.POSITIVE_INFINITY;
    if (firstPrice !== secondPrice) return firstPrice - secondPrice;
    return getPlanTieKey(first).localeCompare(getPlanTieKey(second));
  }

  function sumChainItems(plan, key) {
    return plan.chainItems.reduce((sum, item) => sum + (item[key] || 0), 0);
  }

  function getMetaPlanScore(plan) {
    return getMetaResultScore(
      { ...getPlanResult(plan), stats: { ...plan.stats, price: plan.stats.price ?? 0 } },
      weapon,
      META_SCORING,
    );
  }

  // Compares two chains by the build goal alone; negative when first is better.
  function compareByGoal(first, second) {
    if (goalMode === CHAIN_GOAL_MODES.CONSTRAINTS) {
      const violation = plan => evaluateCustomConstraints({
        ...plan.stats,
        weight: Number(plan.stats.weight),
      }, customLimits).totalViolation;
      const violationDifference = violation(first) - violation(second);
      if (Math.abs(violationDifference) > CONSTRAINT_VIOLATION_EPSILON) return violationDifference;
      const quality = plan => getCustomScore({
        ergonomics: plan.stats.ergonomics,
        verticalRecoil: plan.stats.recoilVertical,
        horizontalRecoil: plan.stats.recoilHorizontal,
      });
      return quality(second) - quality(first);
    }
    if (goalMode === CHAIN_GOAL_MODES.PRIORITIES) {
      if (getPlanTieKey(first) === getPlanTieKey(second)) return 0;
      const ranked = rankPlans([first, second]);
      return ranked[0] === first ? -1 : 1;
    }
    return getMetaPlanScore(second) - getMetaPlanScore(first);
  }

  function comparePlansForProfile(first, second, profile) {
    const violationDifference = first.requirementViolations - second.requirementViolations;
    if (violationDifference !== 0) return violationDifference;
    if (profile === CHAIN_PROFILES.CHEAP) {
      return (first.chainPrice ?? Number.POSITIVE_INFINITY) - (second.chainPrice ?? Number.POSITIVE_INFINITY);
    }
    if (profile === CHAIN_PROFILES.ERGONOMICS) {
      return (sumChainItems(second, 'ergonomicsModifier') - sumChainItems(first, 'ergonomicsModifier'))
        || compareByPriceAndKey(first, second);
    }
    if (profile === CHAIN_PROFILES.RECOIL) {
      return (sumChainItems(first, 'recoilModifier') - sumChainItems(second, 'recoilModifier'))
        || compareByPriceAndKey(first, second);
    }
    return compareByGoal(first, second);
  }

  // Orders complete chains by the build goal, best first. Chains that break a
  // hard build setting always come after the ones that keep them.
  function rankPlans(plans) {
    const violationLevels = [...new Set(plans.map(plan => plan.requirementViolations))].sort((a, b) => a - b);
    if (violationLevels.length > 1) {
      return violationLevels.flatMap(level => rankPlans(plans.filter(plan => plan.requirementViolations === level)));
    }

    if (goalMode === CHAIN_GOAL_MODES.PRIORITIES) {
      const pool = plans.map(plan => ({ plan, result: getPlanResult(plan) }));
      const ranked = [];
      while (pool.length > 0) {
        const selected = goal.prioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED
          ? selectWeightedCustomPriorityCandidate(pool, normalizePriorityWeights(goal.priorityWeights))
          : selectCustomPriorityCandidate(pool, normalizePriorityAttributes(goal.priorityAttributes));
        const index = Math.max(0, pool.indexOf(selected));
        ranked.push(pool[index].plan);
        pool.splice(index, 1);
      }
      return ranked;
    }

    return [...plans].sort((first, second) => (
      compareByGoal(first, second) || compareByPriceAndKey(first, second)
    ));
  }

  function getCompatibleRootItems() {
    return getCompatibleItemsForSlot({
      weapon,
      buildParts,
      allMods: modMap,
      slotContext,
      ...priceOptions,
    });
  }

  function getRootCandidates() {
    return getCompatibleRootItems().filter(item => item.id !== currentNode?.item.id);
  }

  function getPathScore(path) {
    return path.reduce((score, { item }) => score
      + (item.ergonomicsModifier || 0)
      - ((item.recoilModifier || 0) * 3)
      - ((item.weight || 0) * 15)
      - (getPurchasePriceValue(item, priceOptions, 1_000_000_000) * 0.00001), 0);
  }

  // Every way down from a mount to a sight that fits the sight mode, keeping
  // the best few mount paths per sight. Paths start with the given item.
  const sightPathsByItem = new Map();
  function getSightPaths(item, depth = 0) {
    const memoKey = `${item.id}:${depth}`;
    if (sightPathsByItem.has(memoKey)) return sightPathsByItem.get(memoKey);
    const pathsBySight = new Map();
    const addPath = (sightId, path) => {
      const paths = pathsBySight.get(sightId) || [];
      paths.push(path);
      paths.sort((first, second) => getPathScore(second) - getPathScore(first));
      pathsBySight.set(sightId, paths.slice(0, SIGHT_PATHS_PER_SIGHT));
    };

    if (isSightItem(item)) {
      if (isValidSightForMode(item, options.sightMode)) addPath(item.id, [{ item }]);
    } else if (isMountItem(item) && depth < MAX_SIGHT_MOUNT_DEPTH) {
      (item.properties?.slots || []).forEach((slot, slotIndex) => {
        getAllowedIds(slot).forEach(childId => {
          const child = modMap[childId];
          if (!child || child.id === item.id || itemsConflict(item, child)) return;
          getSightPaths(child, depth + 1).forEach((childPaths, sightId) => {
            childPaths.forEach(([childStep, ...rest]) => {
              if (rest.some(step => step.item.id === item.id)) return;
              addPath(sightId, [{ item }, { ...childStep, slot, slotIndex }, ...rest]);
            });
          });
        });
      });
    }

    sightPathsByItem.set(memoKey, pathsBySight);
    return pathsBySight;
  }

  function isPathInstallable(path) {
    const installedItems = [weapon, ...remainingParts.map(part => part.item)];
    const installedIds = new Set(installedItems.map(item => item.id));
    return path.every(({ item }, index) => (
      !installedIds.has(item.id)
      && !installedItems.some(installedItem => itemsConflict(item, installedItem))
      && path.slice(0, index).every(previous => previous.item.id !== item.id && !itemsConflict(previous.item, item))
    ));
  }

  // One seed per alternative module, or, for a sight assembly, one per sight
  // with the best mounts that attach it to this slot.
  function getChainSeeds() {
    if (!isSightAssembly) {
      return getRootCandidates().map(item => ({ key: item.id, rootItem: item }));
    }

    const bestPathBySight = new Map();
    getCompatibleRootItems().forEach(rootItem => {
      getSightPaths(rootItem).forEach((paths, sightId) => {
        if (sightId === currentSight?.id) return;
        const path = paths.find(isPathInstallable);
        if (!path) return;
        const best = bestPathBySight.get(sightId);
        if (!best || getPathScore(path) > getPathScore(best)) bestPathBySight.set(sightId, path);
      });
    });

    return [...bestPathBySight.entries()].map(([sightId, path]) => ({
      key: sightId,
      path: [{ ...path[0], slot: slotContext.slot, slotIndex: slotContext.slotIndex }, ...path.slice(1)],
    }));
  }

  // All chains for one seed: a sight path gives one chain, a module gives one
  // chain per profile with identical chains merged.
  function planSeed(seed) {
    if (seed.path) return [{ ...planChain(buildChainFromSeed(seed)), profiles: [CHAIN_PROFILES.GOAL] }];

    const plansByKey = new Map();
    Object.values(CHAIN_PROFILES).forEach(profile => {
      const plan = planChain(buildChain(seed.rootItem, profile));
      const existing = plansByKey.get(plan.key);
      if (existing) existing.profiles.push(profile);
      else plansByKey.set(plan.key, { ...plan, profiles: [profile] });
    });
    return [...plansByKey.values()];
  }

  function buildChainFromSeed(seed) {
    if (!seed.path) return buildChain(seed.rootItem);

    let chain = null;
    let parent = null;
    seed.path.forEach((step, index) => {
      const node = createChainNode(
        step.item,
        step.slot,
        step.slotIndex,
        index === 0 ? CHAIN_NODE_ORIGINS.ROOT : CHAIN_NODE_ORIGINS.AUTO,
      );
      if (parent) parent.children.push(node);
      else chain = node;
      parent = node;
    });
    return fillEmptySlots(chain);
  }

  return {
    slotContext,
    currentNode,
    currentStats: recalculateBuildStats(weapon, buildParts, priceOptions).stats,
    isSightAssembly,
    buildChain,
    buildChainFromSeed,
    getChainSeeds,
    planSeed,
    getRootCandidates,
    getSlotOptions,
    setSlotItem,
    planChain,
    rankPlans,
  };
}

// A chain is only meaningful where modules can hang below the replaced one.
export function slotSupportsChains(slotContext, allMods) {
  if (!slotContext) return false;
  if (isSightAssemblyNode(slotContext.installedNode)) return true;
  if ((slotContext.installedNode?.children || []).length > 0) return true;
  return [...getAllowedIds(slotContext.slot)].some(itemId => (
    (allMods?.[itemId]?.properties?.slots || []).length > 0
  ));
}
