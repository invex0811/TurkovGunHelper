import { _calculateWeighted } from './candidateSearch.js';
import { createCalculationCache } from './calculationCache.js';
import { getBuildTieKey } from './scoring.js';

const PRIORITY_SEARCH_ROUTES = Object.freeze([
  ...Array.from({ length: 21 }, (_, index) => Object.freeze({
    ergoWeight: index / 20,
    recoilWeight: 1 - (index / 20),
    weightWeight: 0.001,
  })),
  Object.freeze({ ergoWeight: 0, recoilWeight: 0, weightWeight: 15 }),
  Object.freeze({ ergoWeight: 1, recoilWeight: 0, weightWeight: 15 }),
  Object.freeze({ ergoWeight: 0, recoilWeight: 1, weightWeight: 15 }),
]);

// This score is used only while discovering viable budget-constrained builds.
// It is deliberately not exposed to Priority ranking or normalization.
export const PRIORITY_BUDGET_SEARCH_PRICE_WEIGHT = 0.0001;
export const PRIORITY_BUDGET_META_COVERAGE_PRICE_WEIGHT = 0.002;

const PRIORITY_BUDGET_META_COVERAGE_ROUTE = Object.freeze({
  ergoWeight: 1,
  recoilWeight: 3,
  weightWeight: 0.001,
});

export function getPrioritySearchRoutes() {
  return Object.freeze(PRIORITY_SEARCH_ROUTES.map(route => Object.freeze({ ...route })));
}

function isEligiblePriorityCandidate(result, maxPrice) {
  return !(maxPrice > 0)
    || (result.stats.price != null && result.stats.price <= maxPrice);
}

function getBudgetAwarePrioritySearchRoutes(routes) {
  const routeWithBudgetSearch = (route, priceWeight) => Object.freeze({
    ...route,
    priceWeight,
    budgetAwareSearch: true,
  });
  return [
    ...routes.map(route => routeWithBudgetSearch(route, PRIORITY_BUDGET_SEARCH_PRICE_WEIGHT)),
    routeWithBudgetSearch(
      PRIORITY_BUDGET_META_COVERAGE_ROUTE,
      PRIORITY_BUDGET_SEARCH_PRICE_WEIGHT,
    ),
    routeWithBudgetSearch(
      PRIORITY_BUDGET_META_COVERAGE_ROUTE,
      PRIORITY_BUDGET_META_COVERAGE_PRICE_WEIGHT,
    ),
  ];
}

/**
 * Run the complete bounded Priority candidate sweep without consulting the
 * selected priority attributes. Attributes only affect ranking after this pool
 * has been built in orchestration.js. Vertical and horizontal recoil both come
 * from the single recoilModifier search dimension, so no separate horizontal
 * route is added here.
 */
export function generatePriorityCandidates({
  weapon,
  modMap = {},
  options = {},
  calculationCache = createCalculationCache(),
  calculateWeighted = _calculateWeighted,
}) {
  const normalRoutes = getPrioritySearchRoutes();
  const maxPrice = Number(options.maxPrice);
  const budgetAwareRoutes = maxPrice > 0
    ? getBudgetAwarePrioritySearchRoutes(normalRoutes)
    : [];
  const searchRoutes = [
    ...normalRoutes.map(route => ({ route, source: 'normal' })),
    ...budgetAwareRoutes.map((route, index) => ({
      route,
      source: index < normalRoutes.length ? 'budgetAware' : 'budgetAwareMetaCoverage',
    })),
  ];
  const candidatesByBuildKey = new Map();
  const sourcesByBuildKey = new Map();
  const routeResults = [];
  let firstCalculationError = null;
  let successfulCalculationCount = 0;

  for (const { route, source } of searchRoutes) {
    const result = calculateWeighted(
      weapon,
      route.ergoWeight,
      route.recoilWeight,
      route.priceWeight || 0,
      modMap,
      options,
      100,
      'custom',
      route.weightWeight,
      0,
      100,
      calculationCache,
      route.budgetAwareSearch === true ? { budgetAwareSearch: true } : undefined,
    );
    routeResults.push(Object.freeze({ route, result, source }));

    if (result.error) {
      firstCalculationError ||= result;
      continue;
    }

    successfulCalculationCount += 1;
    if (!isEligiblePriorityCandidate(result, maxPrice)) continue;

    const buildKey = getBuildTieKey(result);
    candidatesByBuildKey.set(buildKey, Object.freeze({ buildKey, result }));
    const sources = sourcesByBuildKey.get(buildKey) || new Set();
    sources.add(source);
    sourcesByBuildKey.set(buildKey, sources);
  }

  const candidates = [...candidatesByBuildKey.values()]
    .sort((left, right) => left.buildKey.localeCompare(right.buildKey))
    .map(candidate => Object.freeze({
      ...candidate,
      sources: Object.freeze([...sourcesByBuildKey.get(candidate.buildKey)].sort()),
    }));
  const candidateBuildKeys = candidates.map(candidate => candidate.buildKey);
  const candidateResults = candidates.map(candidate => candidate.result);

  return Object.freeze({
    routeCount: searchRoutes.length,
    totalRouteCalls: searchRoutes.length,
    normalRouteCount: normalRoutes.length,
    budgetAwareRouteCount: budgetAwareRoutes.length,
    routes: Object.freeze(searchRoutes.map(({ route }) => route)),
    normalRoutes: Object.freeze(normalRoutes),
    budgetAwareRoutes: Object.freeze(budgetAwareRoutes),
    routeResults: Object.freeze(routeResults),
    candidates: Object.freeze(candidates),
    candidateBuildKeys: Object.freeze(candidateBuildKeys),
    candidateResults: Object.freeze(candidateResults),
    firstCalculationError,
    successfulCalculationCount,
  });
}
