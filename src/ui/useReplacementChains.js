import { useEffect, useState } from 'react';

// Keeps each batch short so the page stays responsive while chains are built.
const BATCH_BUDGET_MS = 12;

const EMPTY_STATE = Object.freeze({ planner: null, plans: [], completed: 0, total: 0, done: false });

// Builds the replacement chains of every seed (alternative module, or sight
// for a sight assembly) in small batches and exposes them as they are ready.
export function useReplacementChains(planner) {
  const [state, setState] = useState(EMPTY_STATE);

  useEffect(() => {
    if (!planner) return undefined;

    const seeds = planner.getChainSeeds();
    const plans = [];
    let index = 0;
    let timer = null;

    const runBatch = () => {
      const startedAt = performance.now();
      while (index < seeds.length && performance.now() - startedAt < BATCH_BUDGET_MS) {
        plans.push(...planner.planSeed(seeds[index]));
        index += 1;
      }

      const done = index >= seeds.length;
      setState({
        planner,
        plans: done ? planner.rankPlans(plans) : [...plans],
        completed: index,
        total: seeds.length,
        done,
      });
      if (!done) timer = setTimeout(runBatch, 0);
    };

    timer = setTimeout(runBatch, 0);
    return () => clearTimeout(timer);
  }, [planner]);

  return state.planner === planner ? state : EMPTY_STATE;
}
