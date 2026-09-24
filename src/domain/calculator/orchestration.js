import { _calculateWeighted } from './candidateSearch.js';
import {
  appendBuildWarning,
  BUILD_WARNING_CODES,
} from './buildResultMessages.js';
import { createCalculationCache } from './calculationCache.js';
import { PRICE_AWARE_TARGET } from './constants.js';
import { generatePriorityCandidates } from './priorityCandidates.js';
import {
  selectCustomPriorityCandidate,
  selectWeightedCustomPriorityCandidate,
} from './prioritySelection.js';
import {
  getBuildTieKey,
  getCustomScore,
  getMetaResultScore,
  getPriceAwareResultScore,
} from './scoring.js';
import { evaluateCustomConstraints } from '../customConstraints.js';
import { getNestedSlotRouteKey, getRootSlotRouteKey } from './constraints.js';
import { createCompatibilityTools } from './compatibility.js';
import { createPricingTools, excludeRefOnlyItems } from './pricing.js';
import { scopeSupportsZoom } from '../scopeZoom.js';
import {
  normalizeCustomCharacteristicMode,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
} from '../customPriorityAttributes.js';

const CONSTRAINT_ROUTE_BEAM_WIDTH = 24;
// Protected alternatives per hard-requirement state. Without this cap, a
// required suppressor makes nearly every variant identity-unique (all muzzle
// parts are still ahead), so nothing was pruned and the search never ended.
const CONSTRAINT_PROTECTED_VARIANTS_PER_REQUIREMENT = 8;
// Deterministic cap on nested capability expansions. When it runs out, the
// routes built for the earlier required roots are kept and the ordinary
// search completes the build, so a large catalog can never stall the worker.
const CONSTRAINT_ROUTE_EXPANSION_BUDGET = 1_000_000;
const ROUTE_EXPANSION_BUDGET_EXCEEDED = Symbol('route expansion budget exceeded');
const CONSTRAINT_ROUTE_OPTIONS_PER_SLOT = 8;
const CONSTRAINT_FALLBACK_SWEEP_STEPS = 10;

function hasHardRouteConstraints(options) {
  return (options.requiredItemIds || []).length > 0
    || options.requireSuppressor === true
    || options.requireSight === true
    || options.includeLaser === true
    || options.includeFlashlight === true
    || Number(options.maxPrice) > 0;
}

function getRouteTieKey(route) {
  return Object.entries({ ...route.choices, ...route.nestedChoices })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, itemId]) => `${path}=${itemId ?? ''}`)
    .join('|');
}

function getRouteEvaluation(weapon, route, targets) {
  const recoilModifier = route.recoilModifier;
  return evaluateCustomConstraints(
    {
      ergonomics: Math.max(0, Math.min(100, (weapon.properties?.ergonomics || 0) + route.ergonomics)),
      verticalRecoil: (weapon.properties?.recoilVertical || 0) * (1 + (recoilModifier / 100)),
      horizontalRecoil: (weapon.properties?.recoilHorizontal || 0) * (1 + (recoilModifier / 100)),
      weight: (weapon.weight || 0) + route.weight,
    },
    targets,
  );
}

function getRouteRankKey(weapon, route, targets) {
  const baseErgonomics = weapon.properties?.ergonomics || 0;
  const recoilScale = 1 + route.recoilModifier / 100;
  return {
    route,
    violation: getRouteEvaluation(weapon, route, targets).totalViolation,
    quality: getCustomScore({
      ergonomics: Math.max(0, Math.min(100, baseErgonomics + route.ergonomics)),
      verticalRecoil: (weapon.properties?.recoilVertical || 0) * recoilScale,
      horizontalRecoil: (weapon.properties?.recoilHorizontal || 0) * recoilScale,
    }),
    tieKey: null,
  };
}

function compareRouteRankKeys(left, right) {
  const distance = left.violation - right.violation;
  if (distance !== 0) return distance;
  const quality = right.quality - left.quality;
  if (quality !== 0) return quality;
  if (left.route.price !== right.route.price) return left.route.price - right.route.price;
  left.tieKey ??= getRouteTieKey(left.route);
  right.tieKey ??= getRouteTieKey(right.route);
  return left.tieKey.localeCompare(right.tieKey);
}

// Evaluates each route once instead of twice per comparison; the route
// search sorts thousands of variants.
function sortByRoute(entries, toRoute, weapon, targets) {
  return entries
    .map(entry => ({ entry, key: getRouteRankKey(weapon, toRoute(entry), targets) }))
    .sort((left, right) => compareRouteRankKeys(left.key, right.key))
    .map(({ entry }) => entry);
}

function getRankIndex(rankedEntries) {
  return new Map(rankedEntries.map((entry, index) => [entry, index]));
}

function hasFillableRequiredSlots(item, modMap, visitedIds = new Set()) {
  if (!item || visitedIds.has(item.id)) return false;

  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  return (item.properties?.slots || [])
    .filter(slot => slot.required === true)
    .every(slot => (slot.filters?.allowedItems || []).some(allowedItem => (
      hasFillableRequiredSlots(modMap[allowedItem.id], modMap, nextVisitedIds)
    )));
}

function getMinimumRequiredBranchPrice(item, modMap, getItemPrice, visitedIds = new Set()) {
  if (!item || visitedIds.has(item.id)) return Number.POSITIVE_INFINITY;
  const itemPrice = getItemPrice(item);
  if (!Number.isFinite(itemPrice)) return Number.POSITIVE_INFINITY;

  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  let requiredChildrenPrice = 0;

  for (const slot of item.properties?.slots || []) {
    if (slot.required !== true) continue;
    const minimumChildPrice = Math.min(
      ...(slot.filters?.allowedItems || []).map(allowedItem => getMinimumRequiredBranchPrice(
        modMap[allowedItem.id], modMap, getItemPrice, nextVisitedIds,
      )),
    );
    if (!Number.isFinite(minimumChildPrice)) return Number.POSITIVE_INFINITY;
    requiredChildrenPrice += minimumChildPrice;
  }

  return itemPrice + requiredChildrenPrice;
}

function getMinimumRequiredSlotPrice(slot, modMap, getItemPrice) {
  if (slot.required !== true) return 0;
  return Math.min(
    ...(slot.filters?.allowedItems || []).map(allowedItem => getMinimumRequiredBranchPrice(
      modMap[allowedItem.id], modMap, getItemPrice,
    )),
  );
}

function getConstraintRankedRouteOptions(entries, weapon, targets) {
  return sortByRoute(entries, entry => ({
    choices: { item: entry.item.id },
    nestedChoices: entry.capabilities.nestedChoices,
    ergonomics: entry.capabilities.ergonomics,
    recoilModifier: entry.capabilities.recoilModifier,
    weight: entry.capabilities.weight,
    price: entry.capabilities.price,
  }), weapon, targets);
}

function getCapabilitySignature(capabilities, future, options) {
  // Identity matters only while a remaining branch can duplicate the item or
  // conflict with it. Keeping every past ID here makes ordinary budgets exponential.
  const installedIds = [...capabilities.installedIds].filter(itemId => (
    future.installedIds.has(itemId) || future.conflictIds.has(itemId)
  ));
  const conflictIds = [...capabilities.conflictIds].filter(itemId => future.installedIds.has(itemId));
  return [
    [...capabilities.requiredIds].sort().join('|'),
    options.requireSuppressor === true ? capabilities.suppressorKind : '',
    capabilities.deviceMask,
    installedIds.sort().join('|'),
    conflictIds.sort().join('|'),
  ].join(';');
}

function getHardRequirementKey(capabilities, options, requiredIds = capabilities.requiredIds) {
  return [
    [...requiredIds].sort().join('|'),
    options.requireSuppressor === true ? capabilities.suppressorKind : '',
    capabilities.deviceMask,
  ].join(';');
}

// Keeps the best few identity-distinct variants of every hard-requirement
// state, so conflict-avoiding alternatives survive without an unbounded set.
function limitProtectedVariants(variants, getKey, compare) {
  const byRequirement = new Map();
  variants.forEach(variant => {
    const key = getKey(variant);
    const group = byRequirement.get(key) || [];
    group.push(variant);
    byRequirement.set(key, group);
  });
  return [...byRequirement.values()].flatMap(group => (
    group.sort(compare).slice(0, CONSTRAINT_PROTECTED_VARIANTS_PER_REQUIREMENT)
  ));
}

function combineDependencies(...dependencies) {
  return {
    installedIds: new Set(dependencies.flatMap(dependency => [...dependency.installedIds])),
    conflictIds: new Set(dependencies.flatMap(dependency => [...dependency.conflictIds])),
  };
}

function createFutureDependencies(modMap) {
  const bySlot = new WeakMap();
  function forSlot(slot) {
    if (bySlot.has(slot)) return bySlot.get(slot);
    const result = { installedIds: new Set(), conflictIds: new Set() };
    function visit(itemId) {
      if (result.installedIds.has(itemId)) return;
      const item = modMap[itemId];
      if (!item) return;
      result.installedIds.add(itemId);
      (item.conflictingItems || []).forEach(conflict => result.conflictIds.add(conflict.id));
      (item.properties?.slots || []).forEach(childSlot => (
        (childSlot.filters?.allowedItems || []).forEach(child => visit(child.id))
      ));
    }
    (slot.filters?.allowedItems || []).forEach(item => visit(item.id));
    bySlot.set(slot, result);
    return result;
  }
  return slots => combineDependencies(...slots.map(forSlot));
}

function getCombinedRouteState(route, capabilities) {
  return {
    installedIds: new Set([...route.installedIds, ...capabilities.installedIds]),
    conflictIds: new Set([...route.conflictIds, ...capabilities.conflictIds]),
  };
}

function isCompatibleCapabilities(route, capabilities) {
  for (const itemId of capabilities.installedIds) {
    if (route.installedIds.has(itemId) || route.conflictIds.has(itemId)) return false;
  }
  for (const conflictId of capabilities.conflictIds) {
    if (route.installedIds.has(conflictId)) return false;
  }
  return true;
}

function dedupeCapabilityVariants(variants, future, options, tools, route) {
  const asRoute = variant => ({
    ...variant,
    ergonomics: route.ergonomics + variant.ergonomics,
    recoilModifier: route.recoilModifier + variant.recoilModifier,
    weight: route.weight + variant.weight,
  });
  const ranked = sortByRoute(variants, asRoute, tools.weapon, tools.targets);
  if (!hasHardRouteConstraints(options)) return ranked.slice(0, CONSTRAINT_ROUTE_BEAM_WIDTH);

  const bySignature = new Map();
  ranked.forEach(variant => {
    const signature = getCapabilitySignature(variant, future, options);
    const current = bySignature.get(signature);
    if (!current || variant.price < current.price) {
      bySignature.set(signature, variant);
    }
  });
  const rankIndex = getRankIndex(ranked);
  const protectedVariants = new Set(limitProtectedVariants(
    [...bySignature.values()],
    variant => getHardRequirementKey(variant, options),
    (left, right) => left.price - right.price || rankIndex.get(left) - rankIndex.get(right),
  ));
  return [
    ...protectedVariants,
    ...ranked.filter(variant => !protectedVariants.has(variant))
      .slice(0, Math.max(0, CONSTRAINT_ROUTE_BEAM_WIDTH - protectedVariants.size)),
  ];
}

function combineCapabilities(left, right, nestedSuppressor = false) {
  const requiredIds = new Set([...left.requiredIds, ...right.requiredIds]);
  return {
    requiredIds,
    suppressorKind: Math.max(left.suppressorKind, right.suppressorKind > 0 && nestedSuppressor ? 1 : right.suppressorKind),
    installedIds: new Set([...left.installedIds, ...right.installedIds]),
    conflictIds: new Set([...left.conflictIds, ...right.conflictIds]),
    price: left.price + right.price,
    ergonomics: left.ergonomics + right.ergonomics,
    recoilModifier: left.recoilModifier + right.recoilModifier,
    weight: left.weight + right.weight,
    nestedChoices: { ...left.nestedChoices, ...right.nestedChoices },
    deviceMask: left.deviceMask | right.deviceMask,
  };
}

function getRouteCapabilityVariants(item, modMap, options, tools, route, branchPath, future, visitedIds = new Set()) {
  tools.spendExpansion();
  if (!item || visitedIds.has(item.id) || route.installedIds.has(item.id) || route.conflictIds.has(item.id)) return [];
  if ((item.conflictingItems || []).some(conflict => route.installedIds.has(conflict.id))) return [];
  if (options.forbidSuppressor === true && tools.isSuppressor(item)) return [];
  if (!tools.isAllowedSight(item)) return [];

  const itemPrice = tools.getItemPrice(item);
  if (Number(options.maxPrice) > 0 && !Number.isFinite(itemPrice)) return [];
  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  const rootCapabilities = {
    requiredIds: requiredItemIds.has(item.id) ? new Set([item.id]) : new Set(),
    suppressorKind: tools.isSuppressor(item) ? 2 : 0,
    installedIds: new Set([item.id]),
    conflictIds: new Set((item.conflictingItems || []).map(conflict => conflict.id)),
    price: itemPrice,
    ergonomics: item.ergonomicsModifier || 0,
    recoilModifier: item.recoilModifier || 0,
    weight: item.weight || 0,
    nestedChoices: {},
    deviceMask: tools.getRequiredDeviceMask(item),
  };
  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(item.id);
  let variants = [rootCapabilities];

  const slots = item.properties?.slots || [];
  for (const [slotIndex, slot] of slots.entries()) {
    const slotPath = getNestedSlotRouteKey(branchPath, item, slot, slots);
    const remaining = tools.getRemainingDependencies(future, item, slots, slotIndex);
    const nextVariants = [];
    for (const variant of variants) {
      const activeRoute = {
        ...getCombinedRouteState(route, variant),
        ergonomics: route.ergonomics + variant.ergonomics,
        recoilModifier: route.recoilModifier + variant.recoilModifier,
        weight: route.weight + variant.weight,
        price: route.price + variant.price,
      };
      const canProvideRequirement = slot.required === true || tools.slotProvidesRequirement(slot);
      const childVariants = (canProvideRequirement ? slot.filters?.allowedItems || [] : []).flatMap(allowedItem => (
        getRouteCapabilityVariants(
          modMap[allowedItem.id],
          modMap,
          options,
          tools,
          activeRoute,
          slotPath,
          remaining,
          nextVisitedIds,
        )
      )).filter(child => isCompatibleCapabilities(activeRoute, child) && (
        slot.required === true
        || child.requiredIds.size > 0
        || (options.requireSuppressor === true && child.suppressorKind > 0)
        || child.deviceMask > 0
      ));
      if (slot.required !== true) {
        nextVariants.push({ ...variant, nestedChoices: { ...variant.nestedChoices, [slotPath]: null } });
      }
      childVariants.forEach(child => {
        const combined = combineCapabilities(variant, child, true);
        combined.nestedChoices[slotPath] = [...child.installedIds][0];
        nextVariants.push(combined);
      });
    }
    variants = dedupeCapabilityVariants(nextVariants, remaining, options, tools, route);
    if (variants.length === 0) return [];
  }

  return variants;
}

function selectConstraintRouteOptions(
  slot,
  slots,
  weapon,
  modMap,
  targets,
  options,
  tools,
  route,
  future,
) {
  const allItems = (slot.filters?.allowedItems || [])
    .map(allowedItem => modMap[allowedItem.id])
    .filter(Boolean);
  const fillableItems = allItems.filter(item => hasFillableRequiredSlots(item, modMap));
  const candidates = fillableItems.length > 0 ? fillableItems : allItems;
  const optionVariants = candidates.flatMap(item => getRouteCapabilityVariants(
    item, modMap, options, tools, route, getRootSlotRouteKey(slot, slots), future,
  ).map(capabilities => ({ item, capabilities })));
  const rankedOptions = getConstraintRankedRouteOptions(optionVariants, weapon, targets);
  return hasHardRouteConstraints(options) ? rankedOptions : rankedOptions.slice(0, CONSTRAINT_ROUTE_OPTIONS_PER_SLOT);
}

function getRemainingRequiredRootsPrice(slots, currentIndex, modMap, getItemPrice) {
  return slots
    .slice(currentIndex + 1)
    .reduce((sum, slot) => sum + getMinimumRequiredSlotPrice(slot, modMap, getItemPrice), 0);
}

function getRouteHardKey(route, options, future) {
  return getCapabilitySignature({ ...route, requiredIds: route.requiredCoverage }, future, options);
}

function compareHardRoutes(left, right, remainingRequiredRootsPrice, rankIndex) {
  const leftPrice = left.price + remainingRequiredRootsPrice;
  const rightPrice = right.price + remainingRequiredRootsPrice;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return rankIndex.get(left) - rankIndex.get(right);
}

function pruneConstraintRoutes(
  routes,
  remainingRequiredRootsPrice,
  weapon,
  targets,
  options,
  basePrice,
  future,
) {
  const maxPrice = Number(options.maxPrice) || 0;
  const rankedRoutes = sortByRoute(routes.filter(route => !(maxPrice > 0) || (
    Number.isFinite(basePrice + route.price + remainingRequiredRootsPrice)
    && basePrice + route.price + remainingRequiredRootsPrice <= maxPrice
  )), route => route, weapon, targets);
  if (!hasHardRouteConstraints(options)) return rankedRoutes.slice(0, CONSTRAINT_ROUTE_BEAM_WIDTH);

  const rankIndex = getRankIndex(rankedRoutes);
  const compareProtected = (left, right) => (
    compareHardRoutes(left, right, remainingRequiredRootsPrice, rankIndex)
  );
  const hardFrontier = new Map();
  rankedRoutes.forEach(route => {
    const hardKey = getRouteHardKey(route, options, future);
    const current = hardFrontier.get(hardKey);
    if (!current || compareProtected(route, current) < 0) {
      hardFrontier.set(hardKey, route);
    }
  });

  const protectedRoutes = limitProtectedVariants(
    [...hardFrontier.values()],
    route => getHardRequirementKey(route, options, route.requiredCoverage),
    compareProtected,
  ).sort(compareProtected);
  const getRouteStateKey = route => getRouteTieKey(route);
  const protectedRouteKeys = new Set(protectedRoutes.map(getRouteStateKey));
  const remainingRoutes = rankedRoutes.filter(route => !protectedRouteKeys.has(getRouteStateKey(route)));

  // The capped hard frontier stays intact even when it exceeds the normal beam width.
  return [
    ...protectedRoutes,
    ...remainingRoutes.slice(0, Math.max(0, CONSTRAINT_ROUTE_BEAM_WIDTH - protectedRoutes.length)),
  ];
}

export function createConstraintSearchRoutes(
  weapon,
  modMap,
  targets,
  options = {},
  calculationCache = createCalculationCache(),
  expansionBudget = CONSTRAINT_ROUTE_EXPANSION_BUDGET,
) {
  let routes = [{
    choices: {},
    nestedChoices: {},
    ergonomics: 0,
    recoilModifier: 0,
    weight: 0,
    price: 0,
    requiredCoverage: new Set(),
    suppressorKind: 0,
    deviceMask: 0,
    installedIds: new Set([weapon.id]),
    conflictIds: new Set((weapon.conflictingItems || []).map(conflict => conflict.id)),
  }];
  const slots = weapon.properties?.slots || [];
  const { isSuppressor, hasCategory } = createCompatibilityTools(calculationCache);
  const { getItemPrice, getWeaponPrice } = createPricingTools(calculationCache, options);
  const getFutureDependencies = createFutureDependencies(modMap);
  const getRequiredDeviceMask = item => (
    (options.requireSight === true && hasCategory(item, 'Sights') ? 1 : 0)
    | (options.includeLaser === true && hasCategory(item, 'Comb. tact. device') ? 2 : 0)
    | (options.includeFlashlight === true && hasCategory(item, 'Flashlight') ? 4 : 0)
  );
  const requiredItemIds = new Set((options.requiredItemIds || []).map(String));
  const isAllowedSight = item => {
    if (!hasCategory(item, 'Sights') || requiredItemIds.has(item.id)) return true;
    if (['Ironsight', 'Thermal Vision', 'Night Vision', 'Special scope'].some(category => hasCategory(item, category))) return false;
    const mode = options.sightMode || 'any';
    if (mode === 'none') return false;
    if (mode === 'any') return true;
    if (mode === 'reflex') return hasCategory(item, 'Reflex sight') || hasCategory(item, 'Compact reflex sight');
    if (mode === 'scope') return hasCategory(item, 'Scope') || hasCategory(item, 'Assault scope');
    return isNaN(Number(mode)) || scopeSupportsZoom(item, Number(mode));
  };
  // Both helpers depend only on the catalog and slot position, but the route
  // search asks for them once per variant, so they are cached.
  const providesRequirementBySlot = new WeakMap();
  const slotProvidesRequirement = slot => {
    if (providesRequirementBySlot.has(slot)) return providesRequirementBySlot.get(slot);
    const provides = [...getFutureDependencies([slot]).installedIds].some(itemId => (
      requiredItemIds.has(itemId)
      || (options.requireSuppressor === true && isSuppressor(modMap[itemId]))
      || getRequiredDeviceMask(modMap[itemId]) > 0
    ));
    providesRequirementBySlot.set(slot, provides);
    return provides;
  };
  const remainingByFuture = new WeakMap();
  const getRemainingDependencies = (future, item, slots, slotIndex) => {
    let byPosition = remainingByFuture.get(future);
    if (!byPosition) {
      byPosition = new Map();
      remainingByFuture.set(future, byPosition);
    }
    const positionKey = `${item.id}#${slotIndex}`;
    if (!byPosition.has(positionKey)) {
      byPosition.set(positionKey, combineDependencies(
        future,
        getFutureDependencies(slots.slice(slotIndex + 1)),
      ));
    }
    return byPosition.get(positionKey);
  };
  let remainingExpansions = expansionBudget;
  const spendExpansion = () => {
    remainingExpansions -= 1;
    if (remainingExpansions < 0) throw ROUTE_EXPANSION_BUDGET_EXCEEDED;
  };
  const tools = {
    getItemPrice, isSuppressor, getRemainingDependencies, getRequiredDeviceMask, slotProvidesRequirement, isAllowedSight,
    spendExpansion, weapon, targets,
  };

  for (const [slotIndex, slot] of slots.entries()) {
    // Required roots are where a greedy early choice can prevent a later required
    // composition. Optional roots retain the target-aware branch scorer below.
    if (slot.required !== true) continue;
    const routeKey = getRootSlotRouteKey(slot, slots);
    if (!routeKey) continue;
    const future = getFutureDependencies(slots.filter((otherSlot, otherIndex) => (
      otherIndex > slotIndex || otherSlot.required !== true
    )));
    const expandRoute = route => {
      const allowed = selectConstraintRouteOptions(
        slot,
        slots,
        weapon,
        modMap,
        targets,
        options,
        tools,
        route,
        future,
      );
      return allowed.map(({ item, capabilities }) => {
        const requiredCoverage = new Set(route.requiredCoverage);
        capabilities.requiredIds.forEach(requiredId => requiredCoverage.add(requiredId));
        const combinedRouteState = getCombinedRouteState(route, capabilities);
        return {
          choices: { ...route.choices, [routeKey]: item.id },
          nestedChoices: { ...route.nestedChoices, ...capabilities.nestedChoices },
          ergonomics: route.ergonomics + capabilities.ergonomics,
          recoilModifier: route.recoilModifier + capabilities.recoilModifier,
          weight: route.weight + capabilities.weight,
          price: route.price + capabilities.price,
          requiredCoverage,
          suppressorKind: Math.max(route.suppressorKind, capabilities.suppressorKind),
          deviceMask: route.deviceMask | capabilities.deviceMask,
          installedIds: combinedRouteState.installedIds,
          conflictIds: combinedRouteState.conflictIds,
        };
      });
    };
    try {
      routes = routes.flatMap(expandRoute);
    } catch (error) {
      if (error !== ROUTE_EXPANSION_BUDGET_EXCEEDED) throw error;
      // Routes for the earlier required roots stay; the ordinary search fills the rest.
      break;
    }
    const remainingRequiredRootsPrice = getRemainingRequiredRootsPrice(
      slots,
      slots.indexOf(slot),
      modMap,
      getItemPrice,
    );
    routes = pruneConstraintRoutes(
      routes,
      remainingRequiredRootsPrice,
      weapon,
      targets,
      options,
      getWeaponPrice(weapon),
      future,
    );
  }

  return routes;
}

const CONSTRAINT_VIOLATION_TIE_EPSILON = 1e-9;

// Hard-valid candidates rank first by soft directional violation, then by the
// ordinary Custom quality. Satisfied limits all score 0, so distance to a
// boundary never wins inside the allowed region.
export function compareConstraintCandidates(left, right) {
  const violationDifference = left.result.constraintEvaluation.totalViolation
    - right.result.constraintEvaluation.totalViolation;
  if (Math.abs(violationDifference) > CONSTRAINT_VIOLATION_TIE_EPSILON) return violationDifference;
  const quality = result => getCustomScore({
    ergonomics: result.stats.ergonomics,
    verticalRecoil: result.stats.recoilVertical,
    horizontalRecoil: result.stats.recoilHorizontal,
  });
  const qualityDifference = quality(right.result) - quality(left.result);
  if (qualityDifference !== 0) return qualityDifference;
  const leftPrice = left.result.stats.price ?? Number.POSITIVE_INFINITY;
  const rightPrice = right.result.stats.price ?? Number.POSITIVE_INFINITY;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return left.tieKey.localeCompare(right.tieKey);
}

export function calculateBestBuild(
  weapon,
  targetType,
  minErgo,
  maxRecoil,
  modMap = {},
  options = {},
  customProfile = null,
  priorityAttributes = [],
  characteristicMode = 'constraints',
  prioritySelectionMode = 'ordered',
  priorityWeights = undefined,
) {
  modMap = excludeRefOnlyItems(modMap, options);
  const calculationCache = createCalculationCache();
  const effectiveTargetType = targetType === 'custom'
    ? 'custom'
    : targetType === PRICE_AWARE_TARGET
      ? PRICE_AWARE_TARGET
      : 'meta';

  if (effectiveTargetType !== 'custom') {
    const isPriceAwareCalculation = effectiveTargetType === PRICE_AWARE_TARGET;
    const ergoWeight = 1;
    const recoilWeight = 3;
    const priceWeight = isPriceAwareCalculation ? 0.0001 : 0;
    const weightWeight = isPriceAwareCalculation ? 0.001 : 15;
    const overflowErgoWeight = isPriceAwareCalculation ? 0 : 0.15;
    const ergoSoftCap = isPriceAwareCalculation ? 100 : 70;
    const ergoCap = isPriceAwareCalculation ? 100 : 50;
    const primaryResult = _calculateWeighted(
      weapon,
      ergoWeight,
      recoilWeight,
      priceWeight,
      modMap,
      options,
      ergoCap,
      effectiveTargetType,
      weightWeight,
      overflowErgoWeight,
      ergoSoftCap,
      calculationCache,
      isPriceAwareCalculation ? { budgetAwareSearch: true } : undefined,
    );

    if (effectiveTargetType === 'meta' && options.maxPrice > 0) {
      const priceAwareResult = calculateBestBuild(
        weapon,
        PRICE_AWARE_TARGET,
        minErgo,
        maxRecoil,
        modMap,
        options,
      );

      const scoringOptions = {
        ergoCap,
        ergoSoftCap,
        ergoWeight,
        overflowErgoWeight,
        recoilWeight,
        weightWeight,
      };
      const priceAwareScore = getMetaResultScore(priceAwareResult, weapon, scoringOptions);
      const primaryScore = getMetaResultScore(primaryResult, weapon, scoringOptions);
      const priceAwareWinsTie = priceAwareScore === primaryScore
        && priceAwareResult.stats.price != null
        && (
          primaryResult.stats.price == null
          || priceAwareResult.stats.price < primaryResult.stats.price
        );

      return priceAwareScore > primaryScore || priceAwareWinsTie
        ? priceAwareResult
        : primaryResult;
    }

    if (!isPriceAwareCalculation) return primaryResult;

    // The builder is greedy within each slot tree. Explore a price-sensitive route as well,
    // then compare complete builds with the price-aware objective. This prevents an early
    // optional muzzle purchase from starving a much stronger required stock upgrade.
    const priceSensitiveResult = _calculateWeighted(
      weapon,
      ergoWeight,
      recoilWeight,
      priceWeight * 20,
      modMap,
      options,
      ergoCap,
      effectiveTargetType,
      weightWeight,
      overflowErgoWeight,
      ergoSoftCap,
      calculationCache,
      { budgetAwareSearch: true },
    );

    const scoringOptions = {
      ergoWeight,
      priceWeight,
      recoilWeight,
      weightWeight,
    };
    return getPriceAwareResultScore(priceSensitiveResult, scoringOptions)
      > getPriceAwareResultScore(primaryResult, scoringOptions)
      ? priceSensitiveResult
      : primaryResult;
  }

  const normalizedCharacteristicMode = normalizeCustomCharacteristicMode(characteristicMode);
  const isPriorityMode = normalizedCharacteristicMode === 'priorities';
  const normalizedPriorityAttributes = normalizePriorityAttributes(priorityAttributes);
  const normalizedPrioritySelectionMode = normalizePrioritySelectionMode(prioritySelectionMode);
  const normalizedPriorityWeights = normalizePriorityWeights(priorityWeights);
  // Soft desired limits. customProfile.weight never becomes options.maxWeight:
  // only the explicit maxWeight option is a hard maximum.
  const customLimits = {
    ergonomics: minErgo,
    verticalRecoil: maxRecoil,
    horizontalRecoil: customProfile?.horizontalRecoil,
    weight: customProfile?.weight,
  };
  const customOptions = isPriorityMode ? { ...options, maxWeight: 0 } : options;

  if (isPriorityMode) {
    const priorityCandidates = generatePriorityCandidates({
      weapon,
      modMap,
      options: customOptions,
      calculationCache,
    });
    const selectedPriorityCandidate = normalizedPrioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED
      ? selectWeightedCustomPriorityCandidate(
        priorityCandidates.candidates,
        normalizedPriorityWeights,
      )
      : selectCustomPriorityCandidate(
        priorityCandidates.candidates,
        normalizedPriorityAttributes,
      );
    if (selectedPriorityCandidate) return selectedPriorityCandidate.result;
    if (priorityCandidates.successfulCalculationCount === 0 && priorityCandidates.firstCalculationError) {
      return priorityCandidates.firstCalculationError;
    }
    return {
      build: [],
      stats: {
        ergonomics: weapon.properties?.ergonomics ?? 0,
        recoilModifier: 0,
        recoilVertical: weapon.properties?.recoilVertical ?? 0,
        recoilHorizontal: weapon.properties?.recoilHorizontal ?? 0,
        weight: Number(weapon.weight || 0).toFixed(2),
        price: null,
      },
      error: customOptions.maxPrice > 0
        ? `No available build satisfies the priority maximum price of ${customOptions.maxPrice} RUB.`
        : 'No available build satisfies the current builder options.',
    };
  }

  // Bounded root/nested routes supplement the ordinary recursive calculation.
  const routes = createConstraintSearchRoutes(
    weapon, modMap, customLimits, customOptions, calculationCache,
  );
  const calculateRoute = (route = {}, forceNested = false, routeOptions = customOptions) => _calculateWeighted(
    weapon, 1, 1, 0, modMap, routeOptions, 100, 'custom', 0, 0, 100,
    calculationCache, {
      characteristicConstraints: customLimits,
      forcedRootChoices: route.choices,
      forcedNestedChoices: forceNested ? route.nestedChoices : undefined,
    },
  );
  const candidates = [];
  const ordinaryRootChoices = new Set();
  let baselineResult = null;
  routes.forEach(route => {
    const rootKey = JSON.stringify(route.choices);
    if (!ordinaryRootChoices.has(rootKey)) {
      const result = calculateRoute(route);
      if (Object.keys(route.choices).length === 0) baselineResult = result;
      candidates.push(result);
      ordinaryRootChoices.add(rootKey);
    }
    if (Object.keys(route.nestedChoices).length > 0) candidates.push(calculateRoute(route, true));
  });
  // Always retain the unforced calculation, even when every forced route fails.
  if (!baselineResult) {
    baselineResult = calculateRoute();
    candidates.push(baselineResult);
  }
  // Only hard-valid builds compete; soft violations only rank them.
  const selectCandidate = results => {
    let selectedCandidate = null;
    const successfulBuildKeys = new Set();
    results.forEach(result => {
      if (result.error) return;
      const tieKey = getBuildTieKey(result);
      if (successfulBuildKeys.has(tieKey)) return;
      successfulBuildKeys.add(tieKey);
      const candidate = { result, tieKey };
      if (!selectedCandidate || compareConstraintCandidates(candidate, selectedCandidate) < 0) {
        selectedCandidate = candidate;
      }
    });
    return selectedCandidate?.result ?? null;
  };
  let selectedResult = selectCandidate(candidates);

  // Violation-guided greedy search can settle on one axis at the expense of
  // another. Sweep ergonomics/recoil trade-offs for a build with less
  // violation, or for any hard-valid build at all.
  const unguidedSearch = { characteristicConstraints: customLimits, constraintGuidance: false };
  const sweep = sweepOptions => Array.from({ length: CONSTRAINT_FALLBACK_SWEEP_STEPS + 1 }, (_, step) => {
    const ergoWeight = step / CONSTRAINT_FALLBACK_SWEEP_STEPS;
    return _calculateWeighted(
      weapon, ergoWeight, 1 - ergoWeight, 0, modMap, sweepOptions, 100, 'custom', 0.001, 0, 100,
      calculationCache, unguidedSearch,
    );
  });
  const desiredWeight = Number(customLimits.weight) || 0;
  const hardWeight = Number(customOptions.maxWeight) || 0;
  if (!selectedResult?.constraintEvaluation.satisfied
    && desiredWeight > 0
    && (hardWeight <= 0 || desiredWeight < hardWeight)) {
    // Extra candidates pruned at the desired weight explore the region inside
    // it. The soft limit only narrows these extra searches; every candidate
    // still competes on the unchanged hard requirements.
    const withinDesiredWeight = { ...customOptions, maxWeight: desiredWeight };
    candidates.push(calculateRoute({}, false, withinDesiredWeight), ...sweep(withinDesiredWeight));
    selectedResult = selectCandidate(candidates);
  }
  if (!selectedResult?.constraintEvaluation.satisfied) {
    // The weight-aware Meta balance is costly (its final optimizers), so it
    // runs once, only when the cheaper searches left a violation.
    candidates.push(...sweep(customOptions), _calculateWeighted(
      weapon, 1, 3, 0, modMap, customOptions, 50, 'meta', 15, 0.15, 70, calculationCache, unguidedSearch,
    ));
    selectedResult = selectCandidate(candidates);
  }

  // No hard-valid build: keep the ordinary calculation's specific reason and
  // code (budget, required parts or devices, hard maximum weight).
  if (!selectedResult) return baselineResult;
  if (!selectedResult.constraintEvaluation.satisfied) {
    appendBuildWarning(selectedResult, {
      code: BUILD_WARNING_CODES.REQUIREMENTS_UNMET_CLOSEST_BUILD,
      params: {},
      fallback: 'Not all selected values are reachable. Showing the closest build found.',
    });
  }
  return selectedResult;
}
