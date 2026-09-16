export function createBranchEvaluator(context) {
  function invalidBranchEvaluation() {
    return {
      score: -Infinity,
      items: [],
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
      isValid: false,
      warnings: [],
    };
  }

  function createBranchEvaluation(slotName, item, score) {
    return {
      score,
      items: [{ slotName, item }],
      statsDelta: {
        ergonomics: item.ergonomicsModifier || 0,
        recoil: item.recoilModifier || 0,
        weight: item.weight || 0,
        price: context.getItemPrice(item),
      },
      hasSuppressor: context.isSuppressor(item),
      hasSight: context.hasCategory(item, 'Sights'),
      requiredMatches: context.requiredItemIds.has(item.id) ? new Set([item.id]) : new Set(),
      conflicts: new Set(context.getItemConflictIds(item)),
      isValid: true,
      warnings: [],
    };
  }

  function mergeBranchEvaluation(target, source) {
    target.score += source.score;
    target.items.push(...source.items);

    target.statsDelta.ergonomics += source.statsDelta.ergonomics;
    target.statsDelta.recoil += source.statsDelta.recoil;
    target.statsDelta.weight += source.statsDelta.weight;
    target.statsDelta.price += source.statsDelta.price;

    target.hasSuppressor = target.hasSuppressor || source.hasSuppressor;
    target.hasSight = target.hasSight || source.hasSight;
    source.requiredMatches.forEach(itemId => target.requiredMatches.add(itemId));

    source.conflicts.forEach(conflictId => target.conflicts.add(conflictId));
    target.warnings.push(...source.warnings);
  }

  function canInstallItem(itemId, item, pathIds, branchInstalledIds, branchConflicts) {
    if (context.installedIds.has(itemId)) return false;
    if (context.installedConflicts.has(itemId)) return false;
    if (pathIds.has(itemId)) return false;
    if (branchInstalledIds.has(itemId)) return false;
    if (branchConflicts.has(itemId)) return false;

    for (const conflict of item.conflictingItems || []) {
      if (context.installedIds.has(conflict.id)) return false;
      if (pathIds.has(conflict.id)) return false;
      if (branchInstalledIds.has(conflict.id)) return false;
    }

    return true;
  }

  function isBetterBranch(candidate, bestCandidate, mustFindSuppressor, mustFindSight, mustFindRequired = false) {
    if (!candidate || !candidate.isValid || candidate.score === -Infinity) return false;
    if (!bestCandidate) return true;

    if (mustFindRequired && candidate.requiredMatches.size !== bestCandidate.requiredMatches.size) {
      return candidate.requiredMatches.size > bestCandidate.requiredMatches.size;
    }

    if (mustFindSuppressor && candidate.hasSuppressor !== bestCandidate.hasSuppressor) {
      return candidate.hasSuppressor;
    }

    if (mustFindSight && candidate.hasSight !== bestCandidate.hasSight) {
      return candidate.hasSight;
    }

    if (candidate.score !== bestCandidate.score) return candidate.score > bestCandidate.score;

    if (context.targetMatching) {
      const candidateBranch = candidate.branchEval ?? candidate;
      const bestBranch = bestCandidate.branchEval ?? bestCandidate;
      const candidatePrice = candidateBranch.statsDelta.price;
      const bestCandidatePrice = bestBranch.statsDelta.price;
      if (candidatePrice !== bestCandidatePrice) return candidatePrice < bestCandidatePrice;

      const getTieKey = branch => branch.items
        .map(part => String(part.item?.id ?? ''))
        .sort()
        .join('|');
      return getTieKey(candidateBranch).localeCompare(getTieKey(bestBranch)) < 0;
    }

    return false;
  }

  function shouldApplyChildBranch(
    childEval,
    activeMustFindSuppressor,
    activeMustFindSight,
    activeMustFindRequired = false,
    mustFillSlot = false,
  ) {
    if (!childEval || !childEval.isValid || childEval.score === -Infinity) return false;

    if (mustFillSlot) return true;

    if (activeMustFindRequired) {
      return childEval.requiredMatches.size > 0;
    }

    if (activeMustFindSuppressor) {
      return childEval.hasSuppressor;
    }

    if (activeMustFindSight) {
      return childEval.hasSight;
    }

    return childEval.score > 0;
  }

  function evaluateBranch(
    slotName,
    itemId,
    currentErgo,
    pathIds = new Set(),
    currentWeight = context.totalWeight,
    parentBranchInstalledIds = new Set(),
    parentBranchConflicts = new Set(),
    currentPrice = context.totalPrice,
    reservedPrice = 0,
    reservedWeight = 0,
    slotNameId = '',
  ) {
    const item = context.modMap[itemId];
    if (!item) return invalidBranchEvaluation();

    if (!canInstallItem(itemId, item, pathIds, parentBranchInstalledIds, parentBranchConflicts)) {
      return invalidBranchEvaluation();
    }

    const isRequiredItem = context.requiredItemIds.has(item.id);
    const providesRequiredItem = context.hasRequiredItemRequirements && context.itemTreeCanProvideRequiredItem(
      item,
      new Set(),
      new Set([
        ...context.installedIds,
        ...parentBranchInstalledIds,
        ...pathIds,
      ]),
    );

    if (!isRequiredItem && context.weaponHasSeparateStockSlot && context.isPistolGripSlot(slotName, slotNameId) && context.isCombinedPistolGripStock(item)) {
      return invalidBranchEvaluation();
    }

    if (!isRequiredItem && context.hasCategory(item, 'Sights') && !context.isValidSightForMode(item)) {
      return invalidBranchEvaluation();
    }

    const isTacSlot = context.isTacticalSlot(slotName, slotNameId);
    const hasAnyTactical = context.options.includeLaser || context.options.includeFlashlight;
    if (isTacSlot && hasAnyTactical) {
      if (context.isReservedForRequiredTacticalDevice(item)) {
        return invalidBranchEvaluation();
      }

      if (!isRequiredItem && !providesRequiredItem && !context.isValidTacticalDevice(item)) {
        return invalidBranchEvaluation();
      }
      const isLaser = context.hasCategory(item, 'Comb. tact. device');
      const isFlashlight = context.hasCategory(item, 'Flashlight');
      if (isLaser && !isRequiredItem) {
        const alreadyHasLaser = context.hasLaserDevice(context.installedIds) || context.hasLaserDevice(parentBranchInstalledIds);
        if (alreadyHasLaser) {
          return invalidBranchEvaluation();
        }
      }
      if (isFlashlight && !isRequiredItem) {
        const alreadyHasFlashlight = context.hasFlashlightDevice(context.installedIds) || context.hasFlashlightDevice(parentBranchInstalledIds);
        if (alreadyHasFlashlight) {
          return invalidBranchEvaluation();
        }
      }
    }

    const itemWeight = item.weight || 0;
    if (
      context.maxWeight > 0
      && currentWeight + itemWeight + reservedWeight > context.maxWeight + context.weightEpsilon
    ) {
      return invalidBranchEvaluation();
    }

    const price = context.getItemPrice(item);
    if (context.maxPrice > 0 && currentPrice + price + reservedPrice > context.maxPrice) {
      return invalidBranchEvaluation();
    }

    if (context.options.forbidSuppressor && context.isSuppressor(item)) {
      return invalidBranchEvaluation();
    }

    const ergoMod = item.ergonomicsModifier || 0;
    const recoilMod = item.recoilModifier || 0;

    const currentUsableErgo = Math.min(context.ergoCap, currentErgo);
    const newUsableErgo = Math.min(context.ergoCap, currentErgo + ergoMod);
    const cappedErgoMod = newUsableErgo - currentUsableErgo;
    const currentOverflowErgo = Math.max(0, Math.min(context.ergoSoftCap, currentErgo) - context.ergoCap);
    const newOverflowErgo = Math.max(0, Math.min(context.ergoSoftCap, currentErgo + ergoMod) - context.ergoCap);
    const overflowErgoMod = newOverflowErgo - currentOverflowErgo;
    const itemOverflowErgoWeight = context.targetType === 'meta' && context.hasCategory(item, 'Stock')
      ? Math.max(context.overflowErgoWeight, 0.45)
      : context.overflowErgoWeight;
    const effectiveErgoMod = cappedErgoMod + (overflowErgoMod * itemOverflowErgoWeight);

    const scoringPrice = Number.isFinite(price) ? price : Number.MAX_SAFE_INTEGER;
    let branchScore = (effectiveErgoMod * context.ergoWeight)
      - (recoilMod * context.recoilWeight)
      - (scoringPrice * context.priceWeight)
      - (itemWeight * context.weightWeight);

    if (isTacSlot && hasAnyTactical) {
      branchScore += 10000; // Крупный бонус для гарантии установки
    }

    if (context.hasCategory(item, 'Magazine')) {
      const recoil = item.recoilModifier || 0;
      const loadMod = item.properties?.loadModifier || 0;
      const ammoCheckMod = item.properties?.ammoCheckModifier || 0;
      const ergoM = item.ergonomicsModifier || 0;
      const lowPrice = Number.isFinite(price) ? price : Number.MAX_SAFE_INTEGER;

      if (context.targetType === 'meta') {
        branchScore = (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10) + (ergoM * 0.2);
      } else if (context.budgetAwareSearch) {
        const baseScoring = (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10) + (ergoM * 0.2) + 200;
        branchScore = baseScoring / lowPrice;
      } else {
        branchScore = (ergoM * 1.0) - (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10);
      }
    }

    const branchEval = createBranchEvaluation(slotName, item, branchScore);

    let branchErgo = Math.max(0, currentErgo + ergoMod);
    let branchTotalWeight = currentWeight + itemWeight;
    let branchTotalPrice = currentPrice + price;

    const branchInstalledIds = new Set(parentBranchInstalledIds);
    branchInstalledIds.add(itemId);

    const branchConflicts = new Set(parentBranchConflicts);
    context.addItemConflictsToSet(item, branchConflicts);

    const nextPathIds = new Set(pathIds);
    nextPathIds.add(itemId);

    if (item.properties?.slots) {
      const sortedSlots = context.getSortedSlots(item.properties.slots);

      for (let slotIndex = 0; slotIndex < sortedSlots.length; slotIndex += 1) {
        const slot = sortedSlots[slotIndex];
        if (context.isSkippedSlot(slot)) continue;

        let allowed = slot.filters?.allowedItems;
        if (!allowed || allowed.length === 0) {
          if (slot.required === true) return invalidBranchEvaluation();
          continue;
        }

        if (context.isMagazineSlot(slot)) {
          allowed = context.filterAllowedItems(allowed, context.targetCapacity);
        }

        if (allowed.length === 0) {
          if (slot.required === true) return invalidBranchEvaluation();
          continue;
        }

        const remainingRequiredPrice = context.getRemainingRequiredSlotPrice(
          sortedSlots,
          slotIndex,
          nextPathIds,
        );
        if (!Number.isFinite(remainingRequiredPrice)) return invalidBranchEvaluation();
        const childReservedPrice = reservedPrice + remainingRequiredPrice;
        const remainingRequiredWeight = context.getRemainingRequiredSlotWeight(
          sortedSlots,
          slotIndex,
          nextPathIds,
        );
        if (!Number.isFinite(remainingRequiredWeight)) return invalidBranchEvaluation();
        const childReservedWeight = reservedWeight + remainingRequiredWeight;

        const mustFindSuppressor = context.options.requireSuppressor && !branchEval.hasSuppressor;
        const mustFindSight = context.requireSight && !(context.hasSight || branchEval.hasSight);

        let slotCanProvideSuppressor = false;
        let slotCanProvideSight = false;
        let slotCanProvideRequired = false;

        const childEvals = [];

        allowed.forEach(child => {
          const childItem = context.modMap[child.id];
          if (!childItem) return;

          if ((context.hasSight || branchEval.hasSight) && context.hasCategory(childItem, 'Sights') && !context.requiredItemIds.has(childItem.id)) return;

          const childEval = evaluateBranch(
            slot.name,
            child.id,
            branchErgo,
            nextPathIds,
            branchTotalWeight,
            branchInstalledIds,
            branchConflicts,
            branchTotalPrice,
            childReservedPrice,
            childReservedWeight,
            slot.nameId || slot.id,
          );

          if (childEval.isValid && childEval.score !== -Infinity) {
            if (
              (context.hasSight || branchEval.hasSight)
              && childEval.hasSight
              && !context.branchHasRequiredSight(childEval)
            ) return;
            if (context.branchHasOnlyOptionalSight(childEval)) return;
            if (childEval.hasSuppressor) slotCanProvideSuppressor = true;
            if (childEval.hasSight) slotCanProvideSight = true;
            if (childEval.requiredMatches.size > 0) slotCanProvideRequired = true;
            childEvals.push(childEval);
          }
        });

        let bestChildEval = null;
        const activeMustFindSuppressor = mustFindSuppressor && slotCanProvideSuppressor;
        const activeMustFindSight = mustFindSight && slotCanProvideSight;
        const activeMustFindRequired = slotCanProvideRequired;

        childEvals.forEach(childEval => {
          if (isBetterBranch(childEval, bestChildEval, activeMustFindSuppressor, activeMustFindSight, activeMustFindRequired)) {
            bestChildEval = childEval;
          }
        });

        const shouldApply = shouldApplyChildBranch(
          bestChildEval,
          activeMustFindSuppressor,
          activeMustFindSight,
          activeMustFindRequired,
          slot.required === true,
        );

        if (slot.required === true && !shouldApply) {
          return invalidBranchEvaluation();
        }

        if (shouldApply) {
          mergeBranchEvaluation(branchEval, bestChildEval);

          branchErgo = Math.max(0, branchErgo + bestChildEval.statsDelta.ergonomics);
          branchTotalWeight += bestChildEval.statsDelta.weight;
          branchTotalPrice += bestChildEval.statsDelta.price;

          bestChildEval.items.forEach(part => branchInstalledIds.add(part.item.id));
          bestChildEval.conflicts.forEach(conflictId => branchConflicts.add(conflictId));
        }
      }
    }

    if (typeof context.getTargetBranchImprovement === 'function') {
      const targetImprovement = context.getTargetBranchImprovement(branchEval);
      if (Number.isFinite(targetImprovement)) branchEval.score = targetImprovement;
    }

    return branchEval;
  }


  return {
    evaluateBranch,
    isBetterBranch,
  };
}
