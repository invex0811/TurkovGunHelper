import { getMetaObjectiveScore } from './scoring.js';

export function createBuildOptimizers(context) {
  function findInstalledSlotContextForItem(itemId) {
    const installedParts = [context.weapon, ...context.build.map(part => part.item)];

    for (const parentItem of installedParts) {
      for (const slot of parentItem.properties?.slots || []) {
        const allowed = slot.filters?.allowedItems || [];
        if (allowed.some(allowedItem => allowedItem.id === itemId)) {
          return { parentItem, slot };
        }
      }
    }

    return null;
  }

  function collectInstalledBranchIds(rootItem) {
    const installedBuildIds = new Set(context.build.map(part => part.item.id));
    const branchIds = new Set([rootItem.id]);

    function walk(item) {
      for (const slot of item.properties?.slots || []) {
        for (const allowedItem of slot.filters?.allowedItems || []) {
          if (!installedBuildIds.has(allowedItem.id) || branchIds.has(allowedItem.id)) continue;

          const childItem = context.modMap[allowedItem.id];
          if (!childItem) continue;

          branchIds.add(childItem.id);
          walk(childItem);
        }
      }
    }

    walk(rootItem);
    return branchIds;
  }

  function createExistingBranchEvaluation(parts) {
    const branchEval = {
      score: 0,
      items: parts,
      statsDelta: {
        ergonomics: 0,
        recoil: 0,
        weight: 0,
        price: 0,
      },
      hasSuppressor: false,
      hasSight: false,
      requiredMatches: new Set(),
      conflicts: new Set(),
      isValid: true,
      warnings: [],
    };

    parts.forEach(part => {
      branchEval.statsDelta.ergonomics += part.item.ergonomicsModifier || 0;
      branchEval.statsDelta.recoil += part.item.recoilModifier || 0;
      branchEval.statsDelta.weight += part.item.weight || 0;
      branchEval.statsDelta.price += context.getItemPrice(part.item);
      if (context.isSuppressor(part.item)) branchEval.hasSuppressor = true;
      if (context.hasCategory(part.item, 'Sights')) branchEval.hasSight = true;
      if (context.requiredItemIds.has(part.item.id)) branchEval.requiredMatches.add(part.item.id);
      context.addItemConflictsToSet(part.item, branchEval.conflicts);
    });

    return branchEval;
  }

  function getProjectedStats(branchEval) {
    const recoilMod = context.totalRecoilMod + branchEval.statsDelta.recoil;

    return {
      ergonomics: context.totalErgo + branchEval.statsDelta.ergonomics,
      recoilVertical: context.baseRecoilV * (1 + (recoilMod / 100)),
      recoilHorizontal: context.baseRecoilH * (1 + (recoilMod / 100)),
      weight: context.totalWeight + branchEval.statsDelta.weight,
      price: context.totalPrice + branchEval.statsDelta.price,
    };
  }

  function getBranchBarrelRecoil(branchEval) {
    const barrelPart = branchEval.items.find(part => context.hasCategory(part.item, 'Barrel'));
    return barrelPart?.item.recoilModifier || 0;
  }

  function withForcedSlotAllowedItem(slot, allowedItem, callback) {
    const originalAllowedItems = slot.filters.allowedItems;
    slot.filters.allowedItems = [allowedItem];

    try {
      return callback();
    } finally {
      slot.filters.allowedItems = originalAllowedItems;
    }
  }

  function withForcedBranchPath(path, callback) {
    const originals = path.map(({ slot }) => ({
      slot,
      allowedItems: slot.filters.allowedItems,
      required: slot.required,
    }));

    path.forEach(({ slot, allowedItem }) => {
      slot.filters.allowedItems = [allowedItem];
      slot.required = true;
    });
    context.clearForcedBranchCaches();

    try {
      return callback();
    } finally {
      originals.forEach(({ slot, allowedItems, required }) => {
        slot.filters.allowedItems = allowedItems;
        slot.required = required;
      });
      context.clearForcedBranchCaches();
    }
  }

  function withoutAdditionalSuppressor(callback) {
    return context.withBranchEvaluatorSuppressorOverride(callback);
  }

  function getMetaCandidateScore(branchEval) {
    const baseErgo = context.weapon.properties.ergonomics || 0;
    return getMetaObjectiveScore(
      {
        baseErgo,
        itemErgo: context.totalErgo - baseErgo + branchEval.statsDelta.ergonomics,
        itemRecoil: context.totalRecoilMod + branchEval.statsDelta.recoil,
        itemWeight: context.totalWeight - (context.weapon.weight || 0) + branchEval.statsDelta.weight,
      },
      {
        ergoCap: context.ergoCap,
        ergoSoftCap: context.ergoSoftCap,
        ergoWeight: context.ergoWeight,
        overflowErgoWeight: context.overflowErgoWeight,
        recoilWeight: context.recoilWeight,
        weightWeight: context.weightWeight,
      },
    );
  }

  function isBetterFinalMuzzle(candidate, bestCandidate) {
    if (!candidate) return false;
    if (!bestCandidate) return true;

    const scoreDelta = candidate.score - bestCandidate.score;
    if (scoreDelta > 0.000001) return true;
    return false;
  }

  function findInstalledMuzzleSlotContext() {
    const installedParts = [context.weapon, ...context.build.map(part => part.item)];
    const installedIds = new Set(context.build.map(part => part.item.id));

    for (const parentItem of installedParts) {
      for (const slot of parentItem.properties?.slots || []) {
        if (!context.isMuzzleSlot(slot.name, slot.nameId || slot.id)) continue;
        const rootAllowedItem = (slot.filters?.allowedItems || [])
          .find(allowedItem => installedIds.has(allowedItem.id));
        if (rootAllowedItem) {
          return { rootItem: context.modMap[rootAllowedItem.id], slot };
        }
      }
    }

    for (const parentItem of installedParts) {
      const slot = (parentItem.properties?.slots || [])
        .find(candidate => context.isMuzzleSlot(candidate.name, candidate.nameId || candidate.id));
      if (slot) return { rootItem: null, slot };
    }
    return null;
  }

  function collectForcedBranchPaths(rootItem) {
    const paths = [[]];

    function walk(item, path, pathIds) {
      for (const slot of item.properties?.slots || []) {
        for (const allowedItem of slot.filters?.allowedItems || []) {
          if (pathIds.has(allowedItem.id)) continue;
          const childItem = context.modMap[allowedItem.id];
          if (!childItem) continue;

          const nextPath = [...path, { slot, allowedItem }];
          paths.push(nextPath);
          walk(childItem, nextPath, new Set([...pathIds, allowedItem.id]));
        }
      }
    }

    walk(rootItem, [], new Set([rootItem.id]));
    return paths;
  }

  function optimizeFinalMuzzleBlock() {
    if (context.targetType !== 'meta') return;

    const slotContext = findInstalledMuzzleSlotContext();
    if (!slotContext) return;

    const rootIndex = slotContext.rootItem
      ? context.build.findIndex(part => part.item.id === slotContext.rootItem.id)
      : context.build.length;
    if (rootIndex === -1) return;

    const removedIds = slotContext.rootItem
      ? collectInstalledBranchIds(slotContext.rootItem)
      : new Set();
    const removedParts = context.build.filter(part => removedIds.has(part.item.id));
    const restoreBranchEval = createExistingBranchEvaluation(removedParts);
    const removedRequiredIds = new Set(
      removedParts
        .map(part => part.item.id)
        .filter(itemId => context.requiredItemIds.has(itemId)),
    );
    const removedRequiredSight = context.requireSight
      && removedParts.some(part => context.hasCategory(part.item, 'Sights'));

    for (let i = context.build.length - 1; i >= 0; i -= 1) {
      if (removedIds.has(context.build[i].item.id)) context.build.splice(i, 1);
    }
    context.rebuildBuildState();

    const hasOtherSuppressor = context.build.some(part => context.isSuppressor(part.item));
    const hasOtherSight = context.build.some(part => context.hasCategory(part.item, 'Sights'));
    const createCandidate = branchEval => {
      if (!branchEval.isValid) return null;
      if (context.options.requireSuppressor && !hasOtherSuppressor && !branchEval.hasSuppressor) return null;
      if (hasOtherSuppressor && branchEval.hasSuppressor) return null;
      if ([...removedRequiredIds].some(itemId => !branchEval.requiredMatches.has(itemId))) return null;
      if (removedRequiredSight && !hasOtherSight && !branchEval.hasSight) return null;

      const projected = getProjectedStats(branchEval);
      if (projected.ergonomics < context.ergoCap) return null;
      if (context.maxWeight > 0 && projected.weight > context.maxWeight + context.weightEpsilon) return null;
      if (context.maxPrice > 0 && projected.price > context.maxPrice) return null;
      if (!Number.isFinite(projected.price)) return null;
      return {
        branchEval,
        projected,
        score: getMetaCandidateScore(branchEval),
      };
    };

    let bestCandidate = createCandidate(restoreBranchEval);
    if (slotContext.slot.required !== true) {
      const emptyCandidate = createCandidate(createExistingBranchEvaluation([]));
      if (isBetterFinalMuzzle(emptyCandidate, bestCandidate)) bestCandidate = emptyCandidate;
    }
    for (const rootAllowedItem of slotContext.slot.filters?.allowedItems || []) {
      const rootItem = context.modMap[rootAllowedItem.id];
      if (!rootItem) continue;

      for (const forcedPath of collectForcedBranchPaths(rootItem)) {
        const evaluateBranchCandidate = () => context.evaluateBranch(
          slotContext.slot.name,
          rootItem.id,
          context.totalErgo,
          new Set(),
          context.totalWeight,
          new Set(),
          new Set(),
          context.totalPrice,
          0,
          0,
          slotContext.slot.nameId || slotContext.slot.id,
        );
        const evaluateCandidate = () => hasOtherSuppressor
          ? withoutAdditionalSuppressor(evaluateBranchCandidate)
          : evaluateBranchCandidate();
        const branchEval = forcedPath.length > 0
          ? withForcedBranchPath(forcedPath, evaluateCandidate)
          : evaluateCandidate();
        const candidate = createCandidate(branchEval);
        if (isBetterFinalMuzzle(candidate, bestCandidate)) bestCandidate = candidate;
      }
    }

    context.applyBranchPlan(bestCandidate?.branchEval || restoreBranchEval, rootIndex);
  }

  function isBetterFinalBarrel(candidate, bestCandidate) {
    if (!candidate) return false;
    if (!bestCandidate) return true;

    if (candidate.branchEval.requiredMatches.size !== bestCandidate.branchEval.requiredMatches.size) {
      return candidate.branchEval.requiredMatches.size > bestCandidate.branchEval.requiredMatches.size;
    }

    const recoilDelta = bestCandidate.projected.recoilVertical - candidate.projected.recoilVertical;
    if (recoilDelta > 0.25) return true;
    if (recoilDelta < -0.25) return false;

    if (candidate.barrelRecoil < bestCandidate.barrelRecoil - 0.1) return true;
    if (candidate.barrelRecoil > bestCandidate.barrelRecoil + 0.1) return false;

    if (candidate.projected.ergonomics > bestCandidate.projected.ergonomics + 0.25) return true;
    if (candidate.projected.ergonomics < bestCandidate.projected.ergonomics - 0.25) return false;

    return candidate.projected.weight < bestCandidate.projected.weight;
  }

  function optimizeFinalBarrelBlock() {
    if (context.targetType !== 'meta') return;

    const barrelIndex = context.build.findIndex(part => context.hasCategory(part.item, 'Barrel'));
    if (barrelIndex === -1) return;

    const currentBarrel = context.build[barrelIndex];
    const barrelSlotContext = findInstalledSlotContextForItem(currentBarrel.item.id);
    if (!barrelSlotContext || !context.isBarrelSlot(barrelSlotContext.slot.name, barrelSlotContext.slot.nameId)) return;

    const parentHasBarrelSlot = barrelSlotContext.parentItem.properties?.slots?.some(slot => context.isBarrelSlot(slot.name, slot.nameId)) || false;
    const rootItem = barrelSlotContext.parentItem !== context.weapon && parentHasBarrelSlot
      ? barrelSlotContext.parentItem
      : currentBarrel.item;
    const rootSlotContext = rootItem === currentBarrel.item
      ? barrelSlotContext
      : findInstalledSlotContextForItem(rootItem.id);

    if (!rootSlotContext) return;

    const rootIndex = context.build.findIndex(part => part.item.id === rootItem.id);
    if (rootIndex === -1) return;

    const removedIds = collectInstalledBranchIds(rootItem);
    const removedParts = context.build.filter(part => removedIds.has(part.item.id));
    const restoreBranchEval = createExistingBranchEvaluation(removedParts);

    for (let i = context.build.length - 1; i >= 0; i -= 1) {
      if (removedIds.has(context.build[i].item.id)) {
        context.build.splice(i, 1);
      }
    }
    context.rebuildBuildState();

    let bestCandidate = null;
    const allowed = rootSlotContext.slot.filters?.allowedItems || [];

    allowed.forEach(shallowItem => {
      const item = context.modMap[shallowItem.id];
      if (!item) return;

      const barrelSlot = item.properties?.slots?.find(slot => context.isBarrelSlot(slot.name, slot.nameId));
      const forcedBarrelItems = barrelSlot
        ? barrelSlot.filters?.allowedItems?.filter(allowedItem => {
          const allowedMod = context.modMap[allowedItem.id];
          return allowedMod && context.hasCategory(allowedMod, 'Barrel');
        }) || []
        : [null];

      if (!barrelSlot && !context.hasCategory(item, 'Barrel')) return;

      forcedBarrelItems.forEach(forcedBarrelItem => {
        const evaluateCandidate = () => context.evaluateBranch(rootSlotContext.slot.name, item.id, context.totalErgo, new Set(), context.totalWeight, new Set(), new Set(), context.totalPrice, 0, 0, rootSlotContext.slot.nameId || rootSlotContext.slot.id);
        const branchEval = forcedBarrelItem && barrelSlot
          ? withForcedSlotAllowedItem(barrelSlot, forcedBarrelItem, evaluateCandidate)
          : evaluateCandidate();

        if (!branchEval.isValid) return;
        if (!branchEval.items.some(part => context.hasCategory(part.item, 'Barrel'))) return;

        const projected = getProjectedStats(branchEval);
        if (projected.ergonomics < context.ergoCap) return;
        if (context.maxWeight > 0 && projected.weight > context.maxWeight + context.weightEpsilon) return;
        if (context.maxPrice > 0 && projected.price > context.maxPrice) return;

        const candidate = { branchEval, projected, barrelRecoil: getBranchBarrelRecoil(branchEval) };
        if (isBetterFinalBarrel(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      });
    });

    context.applyBranchPlan(bestCandidate?.branchEval || restoreBranchEval, rootIndex);
  }

  function optimizePriceAwareLeafRecoilUpgrades() {
    if (context.targetType !== context.PRICE_AWARE_TARGET || context.maxPrice <= 0) return;

    const maxIterations = Math.max(1, context.build.length * 2);

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let bestUpgrade = null;
      const installedParts = [...context.build];

      installedParts.forEach(currentPart => {
        const currentItem = currentPart.item;
        if (context.requiredItemIds.has(currentItem.id)) return;
        if (context.options.requireSuppressor && context.isSuppressor(currentItem)) return;
        if (context.requireSight && context.hasCategory(currentItem, 'Sights')) return;

        const branchIds = collectInstalledBranchIds(currentItem);
        if (branchIds.size !== 1) return;

        const slotContext = findInstalledSlotContextForItem(currentItem.id);
        if (!slotContext) return;

        const currentIndex = context.build.findIndex(part => part.item.id === currentItem.id);
        if (currentIndex === -1) return;

        const [removedPart] = context.build.splice(currentIndex, 1);
        context.rebuildBuildState();

        const restoreEval = createExistingBranchEvaluation([removedPart]);
        const currentRecoil = currentItem.recoilModifier || 0;

        for (const allowedItem of slotContext.slot.filters?.allowedItems || []) {
          if (allowedItem.id === currentItem.id) continue;

          const candidateEval = context.evaluateBranch(
            slotContext.slot.name,
            allowedItem.id,
            context.totalErgo,
            new Set(),
            context.totalWeight,
            new Set(),
            new Set(),
            context.totalPrice,
            0,
            0,
            slotContext.slot.nameId || slotContext.slot.id,
          );
          if (!candidateEval.isValid) continue;

          const recoilImprovement = currentRecoil - candidateEval.statsDelta.recoil;
          if (recoilImprovement <= 0.001) continue;

          const candidate = {
            currentItemId: currentItem.id,
            candidateItemId: allowedItem.id,
            recoilImprovement,
            ergonomicsDelta: candidateEval.statsDelta.ergonomics
              - restoreEval.statsDelta.ergonomics,
            priceDelta: candidateEval.statsDelta.price - restoreEval.statsDelta.price,
          };

          if (
            !bestUpgrade
            || candidate.recoilImprovement > bestUpgrade.recoilImprovement + 0.001
            || (
              Math.abs(candidate.recoilImprovement - bestUpgrade.recoilImprovement) <= 0.001
              && candidate.ergonomicsDelta > bestUpgrade.ergonomicsDelta
            )
            || (
              Math.abs(candidate.recoilImprovement - bestUpgrade.recoilImprovement) <= 0.001
              && candidate.ergonomicsDelta === bestUpgrade.ergonomicsDelta
              && candidate.priceDelta < bestUpgrade.priceDelta
            )
          ) {
            bestUpgrade = candidate;
          }
        }

        context.applyBranchPlan(restoreEval, currentIndex);
      });

      if (!bestUpgrade) return;

      const currentIndex = context.build.findIndex(part => part.item.id === bestUpgrade.currentItemId);
      if (currentIndex === -1) return;

      const currentPart = context.build[currentIndex];
      const slotContext = findInstalledSlotContextForItem(currentPart.item.id);
      if (!slotContext) return;

      context.build.splice(currentIndex, 1);
      context.rebuildBuildState();

      const replacementEval = context.evaluateBranch(
        slotContext.slot.name,
        bestUpgrade.candidateItemId,
        context.totalErgo,
        new Set(),
        context.totalWeight,
        new Set(),
        new Set(),
        context.totalPrice,
        0,
        0,
        slotContext.slot.nameId || slotContext.slot.id,
      );

      if (!replacementEval.isValid) {
        context.applyBranchPlan(createExistingBranchEvaluation([currentPart]), currentIndex);
        return;
      }

      context.applyBranchPlan(replacementEval, currentIndex);
    }
  }


  return {
    optimizeFinalBarrelBlock,
    optimizeFinalMuzzleBlock,
    optimizePriceAwareLeafRecoilUpgrades,
  };
}
