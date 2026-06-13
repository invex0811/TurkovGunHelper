function _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options = {}, ergoCap = 100) {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = weapon.avg24hPrice || weapon.basePrice || 0;
  let hasSight = false;
  let hasSuppressorGlobal = hasCategory(weapon, 'Silencer');
  const maxWeight = Number(options.maxWeight) || 0;
  const weightEpsilon = 0.0001;

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const installedIds = new Set([weapon.id]);
  const installedConflicts = new Set();
  if (weapon.conflictingItems) {
    weapon.conflictingItems.forEach(conflict => installedConflicts.add(conflict.id));
  }

  const slotPriority = {
    'receiver': 1,
    'barrel': 2,
    'gas block': 3,
    'handguard': 4,
    'stock': 5,
    'muzzle': 6,
    'pistol grip': 7,
    'magazine': 8,
    'scope': 9,
    'mount': 10
  };

  function hasCategory(item, categoryName) {
    return item.categories?.some(category => category.name === categoryName) || false;
  }

  function isSuppressor(item) {
    return hasCategory(item, 'Silencer');
  }

  function getItemPrice(item) {
    return item.avg24hPrice || item.basePrice || 0;
  }

  function getItemConflictIds(item) {
    return (item.conflictingItems || []).map(conflict => conflict.id);
  }

  function addItemConflictsToSet(item, targetSet) {
    getItemConflictIds(item).forEach(conflictId => targetSet.add(conflictId));
  }

  function getSlotPriority(slotName) {
    const name = (slotName || '').toLowerCase();
    return slotPriority[name] || 99;
  }

  function isSkippedSlot(slot) {
    const slotNameId = (slot.nameId || '').toLowerCase();
    return slotNameId.includes('tactical')
      || slotNameId.includes('flashlight')
      || slotNameId.includes('bipod')
      || slotNameId.includes('launcher')
      || slotNameId.includes('equipment');
  }

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
        price: getItemPrice(item),
      },
      hasSuppressor: isSuppressor(item),
      hasSight: hasCategory(item, 'Sights'),
      conflicts: new Set(getItemConflictIds(item)),
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

    source.conflicts.forEach(conflictId => target.conflicts.add(conflictId));
    target.warnings.push(...source.warnings);
  }

  function canInstallItem(itemId, item, pathIds, branchInstalledIds, branchConflicts) {
    if (installedIds.has(itemId)) return false;
    if (installedConflicts.has(itemId)) return false;
    if (pathIds.has(itemId)) return false;
    if (branchInstalledIds.has(itemId)) return false;
    if (branchConflicts.has(itemId)) return false;

    for (const conflict of item.conflictingItems || []) {
      if (installedIds.has(conflict.id)) return false;
      if (pathIds.has(conflict.id)) return false;
      if (branchInstalledIds.has(conflict.id)) return false;
    }

    return true;
  }

  function isBetterBranch(candidate, bestCandidate, mustFindSuppressor) {
    if (!candidate || !candidate.isValid || candidate.score === -Infinity) return false;
    if (!bestCandidate) return true;

    if (mustFindSuppressor && candidate.hasSuppressor !== bestCandidate.hasSuppressor) {
      return candidate.hasSuppressor;
    }

    return candidate.score > bestCandidate.score;
  }

  function shouldApplyChildBranch(childEval, branchHasSuppressor) {
    if (!childEval || !childEval.isValid || childEval.score === -Infinity) return false;

    const mustFindSuppressor = options.requireSuppressor && !branchHasSuppressor;
    if (mustFindSuppressor) {
      return childEval.hasSuppressor;
    }

    return childEval.score > 0;
  }

  function evaluateBranch(
    slotName,
    itemId,
    currentErgo,
    pathIds = new Set(),
    currentWeight = totalWeight,
    parentBranchInstalledIds = new Set(),
    parentBranchConflicts = new Set(),
  ) {
    const item = modMap[itemId];
    if (!item) return invalidBranchEvaluation();

    if (!canInstallItem(itemId, item, pathIds, parentBranchInstalledIds, parentBranchConflicts)) {
      return invalidBranchEvaluation();
    }

    const itemWeight = item.weight || 0;
    if (maxWeight > 0 && currentWeight + itemWeight > maxWeight + weightEpsilon) {
      return invalidBranchEvaluation();
    }

    if (options.forbidSuppressor && isSuppressor(item)) {
      return invalidBranchEvaluation();
    }

    const ergoMod = item.ergonomicsModifier || 0;
    const recoilMod = item.recoilModifier || 0;
    const price = getItemPrice(item);

    const currentUsableErgo = Math.min(ergoCap, currentErgo);
    const newUsableErgo = Math.min(ergoCap, currentErgo + ergoMod);
    const effectiveErgoMod = newUsableErgo - currentUsableErgo;

    const branchScore = (effectiveErgoMod * ergoWeight)
      - (recoilMod * recoilWeight)
      - (price * priceWeight)
      - (itemWeight * 0.001);

    const branchEval = createBranchEvaluation(slotName, item, branchScore);

    let branchErgo = Math.max(0, currentErgo + ergoMod);
    let branchTotalWeight = currentWeight + itemWeight;

    const branchInstalledIds = new Set(parentBranchInstalledIds);
    branchInstalledIds.add(itemId);

    const branchConflicts = new Set(parentBranchConflicts);
    addItemConflictsToSet(item, branchConflicts);

    const nextPathIds = new Set(pathIds);
    nextPathIds.add(itemId);

    if (item.properties?.slots) {
      const sortedSlots = [...item.properties.slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));

      sortedSlots.forEach(slot => {
        if (isSkippedSlot(slot)) return;

        const allowed = slot.filters?.allowedItems;
        if (!allowed || allowed.length === 0) return;

        let bestChildEval = null;
        const mustFindSuppressor = options.requireSuppressor && !branchEval.hasSuppressor;

        allowed.forEach(child => {
          const childItem = modMap[child.id];
          if (!childItem) return;

          if ((hasSight || branchEval.hasSight) && hasCategory(childItem, 'Sights')) return;

          const childEval = evaluateBranch(
            slot.name,
            child.id,
            branchErgo,
            nextPathIds,
            branchTotalWeight,
            branchInstalledIds,
            branchConflicts,
          );

          if (isBetterBranch(childEval, bestChildEval, mustFindSuppressor)) {
            bestChildEval = childEval;
          }
        });

        if (shouldApplyChildBranch(bestChildEval, branchEval.hasSuppressor)) {
          mergeBranchEvaluation(branchEval, bestChildEval);

          branchErgo = Math.max(0, branchErgo + bestChildEval.statsDelta.ergonomics);
          branchTotalWeight += bestChildEval.statsDelta.weight;

          bestChildEval.items.forEach(part => branchInstalledIds.add(part.item.id));
          bestChildEval.conflicts.forEach(conflictId => branchConflicts.add(conflictId));
        }
      });
    }

    return branchEval;
  }

  function applyBranchPlan(branchEval) {
    branchEval.items.forEach(part => {
      build.push(part);
      installedIds.add(part.item.id);
      addItemConflictsToSet(part.item, installedConflicts);

      totalErgo += part.item.ergonomicsModifier || 0;
      totalRecoilMod += part.item.recoilModifier || 0;
      totalWeight += part.item.weight || 0;
      totalPrice += getItemPrice(part.item);

      if (hasCategory(part.item, 'Sights')) hasSight = true;
      if (isSuppressor(part.item)) hasSuppressorGlobal = true;
    });
  }

  function processSlots(slots) {
    const sortedSlots = [...slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));

    sortedSlots.forEach(slot => {
      if (isSkippedSlot(slot)) return;

      const allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) return;

      let bestCandidate = null;
      const mustFindSuppressor = options.requireSuppressor && !hasSuppressorGlobal;

      allowed.forEach(shallowItem => {
        const item = modMap[shallowItem.id];
        if (!item) return;

        if (hasSight && hasCategory(item, 'Sights')) return;

        const branchEval = evaluateBranch(slot.name, item.id, totalErgo, new Set(), totalWeight);
        if (!branchEval.isValid) return;

        if (maxWeight > 0) {
          const hypotheticalWeight = totalWeight + branchEval.statsDelta.weight;
          if (hypotheticalWeight > maxWeight + weightEpsilon) return;
        }

        const candidate = {
          branchEval,
          score: branchEval.score,
          hasSuppressor: branchEval.hasSuppressor,
          isValid: branchEval.isValid,
        };

        if (isBetterBranch(candidate, bestCandidate, mustFindSuppressor)) {
          bestCandidate = candidate;
        }
      });

      if (!bestCandidate) return;
      if (mustFindSuppressor && !bestCandidate.hasSuppressor) return;

      const rootItem = bestCandidate.branchEval.items[0]?.item;
      if (!rootItem) return;

      const isMount = hasCategory(rootItem, 'Mount');
      if (
        isMount
        && bestCandidate.score <= 0
        && !(options.requireSuppressor && !hasSuppressorGlobal && bestCandidate.hasSuppressor)
      ) {
        return;
      }

      applyBranchPlan(bestCandidate.branchEval);
    });
  }

  processSlots(weapon.properties.slots);

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  const result = {
    build,
    stats: {
      ergonomics: Math.min(100, Math.round(totalErgo)),
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Math.round(totalPrice),
    },
  };

  const warnings = [];
  if (options.requireSuppressor && !hasSuppressorGlobal) {
    result.error = 'No compatible suppressor could be installed with the current constraints.';
  }
  if (maxWeight > 0 && totalWeight > maxWeight + weightEpsilon) {
    warnings.push('The base weapon already exceeds the selected max weight.');
  }
  if (warnings.length > 0) {
    result.warning = warnings.join(' ');
  }

  return result;
}

export function calculateBestBuild(weapon, targetType, minErgo, maxRecoil, modMap = {}, options = {}) {
  if (targetType !== 'custom') {
     let ergoWeight = 1;
     let recoilWeight = 1;
     let priceWeight = 0;
     let ergoCap = 100;
     
     if (targetType === 'max_ergo') { ergoWeight = 1; recoilWeight = 0; }
     else if (targetType === 'min_recoil') { ergoWeight = 0; recoilWeight = 1; }
     else if (targetType === 'meta') { ergoWeight = 1; recoilWeight = 3; ergoCap = 50; }
     else if (targetType === 'budget') { 
       ergoWeight = 1; 
       recoilWeight = 1.5; 
       priceWeight = 0.0001; 
     }
     
     return _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options, ergoCap);
  }

  let bestBuild = null;
  let bestBuildScore = -Infinity;

  for (let i = 0; i <= 20; i++) {
    const ergoWeight = i / 20;
    const recoilWeight = 1 - ergoWeight;
    const priceWeight = 0; 
    const result = _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options);
    if (result.error) return result;
    
    const e = result.stats.ergonomics;
    const r = result.stats.recoilVertical;
    const w = parseFloat(result.stats.weight);
    
    let score;
    const ergoMet = e >= minErgo;
    const recoilMet = r <= maxRecoil;
    
    if (ergoMet && recoilMet) {
      score = 10000 + e - r; 
    } else if (ergoMet) {
      score = 5000 - r; 
    } else if (recoilMet) {
      score = 5000 + e; 
    } else {
      score = -Math.abs(minErgo - e) - Math.abs(r - maxRecoil);
    }

    if (options.maxWeight > 0 && w > options.maxWeight) {
      score -= (w - options.maxWeight) * 1000;
    }
    
    if (score > bestBuildScore) {
      bestBuildScore = score;
      bestBuild = result;
    }
  }

  if (bestBuild.stats.ergonomics < minErgo || bestBuild.stats.recoilVertical > maxRecoil) {
    const warning = "It's physically impossible to meet your exact requirements with the current available parts. Showing the closest balanced build possible.";
    bestBuild.warning = bestBuild.warning ? `${bestBuild.warning} ${warning}` : warning;
  }

  return bestBuild;
}
