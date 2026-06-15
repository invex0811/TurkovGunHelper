function _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options = {}, ergoCap = 100, targetType = 'custom') {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = getItemPrice(weapon);
  let hasSight = false;
  let hasSuppressorGlobal = hasCategory(weapon, 'Silencer');
  const requireSight = options.requireSight === true;
  const maxWeight = Number(options.maxWeight) || 0;
  const maxPrice = Number(options.maxPrice) || 0;
  const weightEpsilon = 0.0001;

  let targetCapacity = 30;
  if (options.magazineCapacity !== undefined) {
    const parsed = Number(options.magazineCapacity);
    if (!isNaN(parsed) && parsed > 0) {
      targetCapacity = parsed;
    }
  }

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
    'muzzle': 5,
    'stock': 6,
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

  function filterAllowedItems(allowedItems, targetCap) {
    if (!allowedItems || allowedItems.length === 0) return allowedItems;

    const magazines = allowedItems
      .map(child => modMap[child.id])
      .filter(item => item && hasCategory(item, 'Magazine'));

    if (magazines.length === 0) {
      return allowedItems;
    }

    const exactMatch = magazines.filter(m => m.properties?.capacity === targetCap);
    if (exactMatch.length > 0) {
      const exactIds = new Set(exactMatch.map(m => m.id));
      return allowedItems.filter(child => exactIds.has(child.id));
    }

    let minDiff = Infinity;
    magazines.forEach(m => {
      const cap = m.properties?.capacity ?? 30;
      const diff = Math.abs(cap - targetCap);
      if (diff < minDiff) {
        minDiff = diff;
      }
    });

    const nearestMags = magazines.filter(m => {
      const cap = m.properties?.capacity ?? 30;
      return Math.abs(cap - targetCap) === minDiff;
    });

    const nearestIds = new Set(nearestMags.map(m => m.id));
    return allowedItems.filter(child => nearestIds.has(child.id));
  }

  function getRawItemPrice(item) {
    return item.avg24hPrice
      || item.lastLowPrice
      || item.low24hPrice
      || item.basePrice
      || 0;
  }

function getItemPrice(item) {
  const expectedPriceMode = options.priceMode;

  if (!expectedPriceMode || item.price?.mode === expectedPriceMode) {
    return item.price?.value ?? getRawItemPrice(item);
  }

  return getRawItemPrice(item);
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

  function isTacticalSlot(slotName) {
    const name = (slotName || '').toLowerCase();
    return name.includes('tactical') || name.includes('flashlight');
  }

  function isValidTacticalDevice(item) {
    const cats = (item.categories || []).map(c => c.name);
    const isLaser = cats.includes('Comb. tact. device');
    const isFlashlight = cats.includes('Flashlight');

    if (isLaser && options.includeLaser) return true;
    if (isFlashlight && options.includeFlashlight) return true;
    return false;
  }

  function isValidSightForMode(item) {
    const cats = (item.categories || []).map(c => c.name);
    if (cats.includes('Thermal Vision') || cats.includes('Night Vision') || cats.includes('Special scope')) {
      return false;
    }

    const mode = options.sightMode || 'any';
    if (mode === 'any') return true;
    if (cats.includes('Ironsight')) return false;

    const isReflex = cats.includes('Reflex sight') || cats.includes('Compact reflex sight');
    const isMagnified = cats.includes('Scope') || cats.includes('Assault scope');

    if (mode === 'reflex') return isReflex;
    if (mode === 'scope') return isMagnified;

    const parsedMode = Number(mode);
    if (!isNaN(parsedMode)) {
      const zoomLevels = item.properties?.zoomLevels;
      if (zoomLevels) {
        const flatZooms = zoomLevels.flat();
        return flatZooms.includes(parsedMode);
      }
      if (parsedMode === 1) {
        return isReflex;
      }
      return false;
    }

    return true;
  }

  function hasLaserDevice(installedSet) {
    for (const id of installedSet) {
      const item = modMap[id];
      if (item) {
        const cats = (item.categories || []).map(c => c.name);
        if (cats.includes('Comb. tact. device')) {
          return true;
        }
      }
    }
    return false;
  }

  function hasFlashlightDevice(installedSet) {
    for (const id of installedSet) {
      const item = modMap[id];
      if (item) {
        const cats = (item.categories || []).map(c => c.name);
        if (cats.includes('Flashlight')) {
          return true;
        }
      }
    }
    return false;
  }

  function isSkippedSlot(slot) {
    const slotNameId = (slot.nameId || '').toLowerCase();
    const hasAnyTactical = options.includeLaser || options.includeFlashlight;
    if (hasAnyTactical) {
      return slotNameId.includes('bipod')
        || slotNameId.includes('launcher')
        || slotNameId.includes('equipment');
    }
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

  function isBetterBranch(candidate, bestCandidate, mustFindSuppressor, mustFindSight) {
    if (!candidate || !candidate.isValid || candidate.score === -Infinity) return false;
    if (!bestCandidate) return true;

    if (mustFindSuppressor && candidate.hasSuppressor !== bestCandidate.hasSuppressor) {
      return candidate.hasSuppressor;
    }

    if (mustFindSight && candidate.hasSight !== bestCandidate.hasSight) {
      return candidate.hasSight;
    }

    return candidate.score > bestCandidate.score;
  }

  function shouldApplyChildBranch(childEval, activeMustFindSuppressor, activeMustFindSight) {
    if (!childEval || !childEval.isValid || childEval.score === -Infinity) return false;

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
    currentWeight = totalWeight,
    parentBranchInstalledIds = new Set(),
    parentBranchConflicts = new Set(),
    currentPrice = totalPrice,
  ) {
    const item = modMap[itemId];
    if (!item) return invalidBranchEvaluation();

    if (!canInstallItem(itemId, item, pathIds, parentBranchInstalledIds, parentBranchConflicts)) {
      return invalidBranchEvaluation();
    }

    if (hasCategory(item, 'Sights') && !isValidSightForMode(item)) {
      return invalidBranchEvaluation();
    }

    const isTacSlot = isTacticalSlot(slotName);
    const hasAnyTactical = options.includeLaser || options.includeFlashlight;
    if (isTacSlot && hasAnyTactical) {
      if (!isValidTacticalDevice(item)) {
        return invalidBranchEvaluation();
      }
      
      const cats = (item.categories || []).map(c => c.name);
      const isLaser = cats.includes('Comb. tact. device');
      const isFlashlight = cats.includes('Flashlight');
      
      if (isLaser) {
        const alreadyHasLaser = hasLaserDevice(installedIds) || hasLaserDevice(parentBranchInstalledIds);
        if (alreadyHasLaser) {
          return invalidBranchEvaluation();
        }
      }
      
      if (isFlashlight) {
        const alreadyHasFlashlight = hasFlashlightDevice(installedIds) || hasFlashlightDevice(parentBranchInstalledIds);
        if (alreadyHasFlashlight) {
          return invalidBranchEvaluation();
        }
      }
    }

    const itemWeight = item.weight || 0;
    if (maxWeight > 0 && currentWeight + itemWeight > maxWeight + weightEpsilon) {
      return invalidBranchEvaluation();
    }

    const price = getItemPrice(item);
    if (maxPrice > 0 && currentPrice + price > maxPrice) {
      return invalidBranchEvaluation();
    }

    if (options.forbidSuppressor && isSuppressor(item)) {
      return invalidBranchEvaluation();
    }

    const ergoMod = item.ergonomicsModifier || 0;
    const recoilMod = item.recoilModifier || 0;

    const currentUsableErgo = Math.min(ergoCap, currentErgo);
    const newUsableErgo = Math.min(ergoCap, currentErgo + ergoMod);
    const effectiveErgoMod = newUsableErgo - currentUsableErgo;

    let branchScore = (effectiveErgoMod * ergoWeight)
      - (recoilMod * recoilWeight)
      - (price * priceWeight)
      - (itemWeight * 0.001);

    if (isTacSlot && hasAnyTactical) {
      branchScore += 10000; // Крупный бонус для гарантии установки
    }

    if (hasCategory(item, 'Magazine')) {
      const recoil = item.recoilModifier || 0;
      const loadMod = item.properties?.loadModifier || 0;
      const ammoCheckMod = item.properties?.ammoCheckModifier || 0;
      const ergoM = item.ergonomicsModifier || 0;
      const lowPrice = getItemPrice(item) || 1;

      if (targetType === 'meta' || targetType === 'min_recoil') {
        branchScore = (recoil * 100) - (loadMod * 10) - (ammoCheckMod * 10) + (ergoM * 0.2);
      } else if (targetType === 'max_ergo') {
        branchScore = ergoM - (loadMod * 0.1);
      } else if (targetType === 'budget') {
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
    addItemConflictsToSet(item, branchConflicts);

    const nextPathIds = new Set(pathIds);
    nextPathIds.add(itemId);

    if (item.properties?.slots) {
      const sortedSlots = [...item.properties.slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));

      sortedSlots.forEach(slot => {
        if (isSkippedSlot(slot)) return;

        let allowed = slot.filters?.allowedItems;
        if (!allowed || allowed.length === 0) return;

        const isMagSlot = slot.name.toLowerCase() === 'mag'
          || slot.name.toLowerCase() === 'magazine'
          || slot.nameId === 'mod_magazine';

        if (isMagSlot) {
          allowed = filterAllowedItems(allowed, targetCapacity);
        }

        const mustFindSuppressor = options.requireSuppressor && !branchEval.hasSuppressor;
        const mustFindSight = requireSight && !(hasSight || branchEval.hasSight);

        let slotCanProvideSuppressor = false;
        let slotCanProvideSight = false;

        const childEvals = [];

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
            branchTotalPrice,
          );

          if (childEval.isValid && childEval.score !== -Infinity) {
            if (childEval.hasSuppressor) slotCanProvideSuppressor = true;
            if (childEval.hasSight) slotCanProvideSight = true;
            childEvals.push(childEval);
          }
        });

        let bestChildEval = null;
        const activeMustFindSuppressor = mustFindSuppressor && slotCanProvideSuppressor;
        const activeMustFindSight = mustFindSight && slotCanProvideSight;

        childEvals.forEach(childEval => {
          if (isBetterBranch(childEval, bestChildEval, activeMustFindSuppressor, activeMustFindSight)) {
            bestChildEval = childEval;
          }
        });

        if (shouldApplyChildBranch(bestChildEval, activeMustFindSuppressor, activeMustFindSight)) {
          mergeBranchEvaluation(branchEval, bestChildEval);

          branchErgo = Math.max(0, branchErgo + bestChildEval.statsDelta.ergonomics);
          branchTotalWeight += bestChildEval.statsDelta.weight;
          branchTotalPrice += bestChildEval.statsDelta.price;

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

      let allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) return;

      const isMagSlot = slot.name.toLowerCase() === 'mag'
        || slot.name.toLowerCase() === 'magazine'
        || slot.nameId === 'mod_magazine';

      if (isMagSlot) {
        allowed = filterAllowedItems(allowed, targetCapacity);
      }

      let slotCanProvideSuppressor = false;
      let slotCanProvideSight = false;

      const candidates = [];

      allowed.forEach(shallowItem => {
        const item = modMap[shallowItem.id];
        if (!item) return;

        if (hasSight && hasCategory(item, 'Sights')) return;

        const branchEval = evaluateBranch(slot.name, item.id, totalErgo, new Set(), totalWeight, new Set(), new Set(), totalPrice);
        if (!branchEval.isValid) return;

        if (maxWeight > 0) {
          const hypotheticalWeight = totalWeight + branchEval.statsDelta.weight;
          if (hypotheticalWeight > maxWeight + weightEpsilon) return;
        }

        if (maxPrice > 0) {
          const hypotheticalPrice = totalPrice + branchEval.statsDelta.price;
          if (hypotheticalPrice > maxPrice) return;
        }

        if (branchEval.hasSuppressor) slotCanProvideSuppressor = true;
        if (branchEval.hasSight) slotCanProvideSight = true;

        candidates.push({
          branchEval,
          score: branchEval.score,
          hasSuppressor: branchEval.hasSuppressor,
          hasSight: branchEval.hasSight,
          isValid: branchEval.isValid,
        });
      });

      let bestCandidate = null;
      const mustFindSuppressor = options.requireSuppressor && !hasSuppressorGlobal;
      const mustFindSight = requireSight && !hasSight;

      const activeMustFindSuppressor = mustFindSuppressor && slotCanProvideSuppressor;
      const activeMustFindSight = mustFindSight && slotCanProvideSight;

      candidates.forEach(candidate => {
        if (isBetterBranch(candidate, bestCandidate, activeMustFindSuppressor, activeMustFindSight)) {
          bestCandidate = candidate;
        }
      });

      if (!bestCandidate) return;
      if (activeMustFindSuppressor && !bestCandidate.hasSuppressor) return;
      if (activeMustFindSight && !bestCandidate.hasSight) return;

      const rootItem = bestCandidate.branchEval.items[0]?.item;
      if (!rootItem) return;

      const isMount = hasCategory(rootItem, 'Mount');
      if (
        isMount
        && bestCandidate.score <= 0
        && !(options.requireSuppressor && !hasSuppressorGlobal && bestCandidate.hasSuppressor)
        && !(requireSight && !hasSight && bestCandidate.hasSight)
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
  if (maxPrice > 0 && totalPrice > maxPrice) {
    warnings.push('The build exceeds the selected max price.');
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
     
     return _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options, ergoCap, targetType);
  }

  let bestBuild = null;
  let bestBuildScore = -Infinity;

  for (let i = 0; i <= 20; i++) {
    const ergoWeight = i / 20;
    const recoilWeight = 1 - ergoWeight;
    const priceWeight = 0; 
    const result = _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options, 100, 'custom');
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

export function recalculateBuildStats(weapon, buildParts, options = {}) {
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;

  function getRawItemPrice(item) {
    return item.avg24hPrice
      || item.lastLowPrice
      || item.low24hPrice
      || item.basePrice
      || 0;
  }

  function getItemPrice(item) {
    const expectedPriceMode = options.priceMode;
    if (!expectedPriceMode || item.price?.mode === expectedPriceMode) {
      return item.price?.value ?? getRawItemPrice(item);
    }
    return getRawItemPrice(item);
  }

  let totalPrice = getItemPrice(weapon);

  buildParts.forEach(part => {
    totalErgo += part.item.ergonomicsModifier || 0;
    totalRecoilMod += part.item.recoilModifier || 0;
    totalWeight += part.item.weight || 0;
    totalPrice += getItemPrice(part.item);
  });

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  return {
    build: buildParts,
    stats: {
      ergonomics: Math.min(100, Math.max(0, Math.round(totalErgo))),
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Math.round(totalPrice),
    }
  };
}

