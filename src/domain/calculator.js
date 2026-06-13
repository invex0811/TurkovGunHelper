function _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options = {}, ergoCap = 100) {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = weapon.avg24hPrice || weapon.basePrice || 0;
  let hasSight = false;
  let hasSuppressorGlobal = weapon.categories?.some(c => c.name === 'Silencer') || false;
  const maxWeight = Number(options.maxWeight) || 0;
  const weightEpsilon = 0.0001;

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const installedIds = new Set([weapon.id]);
  const installedConflicts = new Set();
  if (weapon.conflictingItems) {
    weapon.conflictingItems.forEach(c => installedConflicts.add(c.id));
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

  function getSlotPriority(slotName) {
    const name = (slotName || '').toLowerCase();
    return slotPriority[name] || 99;
  }

  const memoizedScores = new Map();

  function evaluateBranch(itemId, currentErgo, pathIds = new Set(), currentWeight = totalWeight) {
    if (installedIds.has(itemId) || installedConflicts.has(itemId) || pathIds.has(itemId)) {
      return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };
    }

    const memoKey = `${itemId}_${Math.floor(currentErgo)}_${maxWeight > 0 ? currentWeight.toFixed(3) : 'no-weight-limit'}`;
    if (memoizedScores.has(memoKey)) return memoizedScores.get(memoKey);

    const item = modMap[itemId];
    if (!item) return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };

    let blocksInstalled = false;
    if (item.conflictingItems) {
      for (const conflict of item.conflictingItems) {
        if (installedIds.has(conflict.id) || pathIds.has(conflict.id)) { blocksInstalled = true; break; }
      }
    }
    if (blocksInstalled) return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };

    const ergoMod = item.ergonomicsModifier || 0;
    const recoilMod = item.recoilModifier || 0; 
    const price = item.avg24hPrice || item.basePrice || 0;
    const weightMod = item.weight || 0;
    const isSuppressor = item.categories?.some(c => c.name === 'Silencer') || false;

    if (maxWeight > 0 && currentWeight + weightMod > maxWeight + weightEpsilon) {
      return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };
    }

    if (options.forbidSuppressor && isSuppressor) {
      return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };
    }

    const currentUsableErgo = Math.min(ergoCap, currentErgo);
    const newUsableErgo = Math.min(ergoCap, currentErgo + ergoMod);
    const effectiveErgoMod = newUsableErgo - currentUsableErgo;

    let branchScore = (effectiveErgoMod * ergoWeight) - (recoilMod * recoilWeight) - (price * priceWeight) - (weightMod * 0.001);
    let branchErgo = Math.max(0, currentErgo + ergoMod);
    let branchWeight = weightMod;
    let branchTotalWeight = currentWeight + weightMod;
    let branchHasSuppressor = isSuppressor;

    // Apply the massive boost directly at the node that IS a suppressor,
    // so it bubbles up through the DP tree perfectly!
    if (options.requireSuppressor && isSuppressor) {
      branchScore += 5000;
    }

    if (item.properties && item.properties.slots) {
      const sortedSlots = [...item.properties.slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));
      
      sortedSlots.forEach(slot => {
        const slotNameId = (slot.nameId || '').toLowerCase();
        if (slotNameId.includes('tactical') || slotNameId.includes('flashlight') || slotNameId.includes('bipod') || slotNameId.includes('launcher') || slotNameId.includes('equipment')) return;
        
        const allowed = slot.filters?.allowedItems;
        if (!allowed || allowed.length === 0) return;

        let bestChildScore = -Infinity;
        let bestChildErgoMod = 0;
        let bestChildWeightMod = 0;
        let bestChildHasSuppressor = false;

        const nextPathIds = new Set(pathIds);
        nextPathIds.add(itemId);

        allowed.forEach(child => {
           const childEval = evaluateBranch(child.id, branchErgo, nextPathIds, branchTotalWeight);
           
           let childScoreMod = childEval.score;
           
           if (childScoreMod > bestChildScore) {
             bestChildScore = childScoreMod;
             bestChildErgoMod = childEval.totalErgoMod;
             bestChildWeightMod = childEval.totalWeightMod;
             bestChildHasSuppressor = childEval.hasSuppressor;
           }
        });

        if (bestChildScore > -Infinity && bestChildScore > 0) {
           branchScore += bestChildScore;
           branchErgo = Math.max(0, branchErgo + bestChildErgoMod);
           branchWeight += bestChildWeightMod;
           branchTotalWeight += bestChildWeightMod;
           if (bestChildHasSuppressor) branchHasSuppressor = true;
        }
      });
    }
    
    const result = { 
      score: branchScore, 
      totalErgoMod: branchErgo - currentErgo, 
      totalWeightMod: branchWeight,
      hasSuppressor: branchHasSuppressor 
    };
    memoizedScores.set(memoKey, result);
    return result;
  }

  function processSlots(slots) {
    const sortedSlots = [...slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));

    sortedSlots.forEach(slot => {
      const slotNameId = (slot.nameId || '').toLowerCase();
      if (slotNameId.includes('tactical') || slotNameId.includes('flashlight') || slotNameId.includes('bipod') || slotNameId.includes('launcher') || slotNameId.includes('equipment')) return;

      const allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) return;

      let bestItem = null;
      let bestScore = -Infinity;
      let bestHasSuppressor = false;

      allowed.forEach(shallowItem => {
        const item = modMap[shallowItem.id] || shallowItem;
        
        const isSight = item.categories?.some(c => c.name === 'Sights');
        if (hasSight && isSight) return;
        if (installedIds.has(item.id)) return;
        if (installedConflicts.has(item.id)) return;
        
        let blocksInstalled = false;
        if (item.conflictingItems) {
          for (const conflict of item.conflictingItems) {
            if (installedIds.has(conflict.id)) { blocksInstalled = true; break; }
          }
        }
        if (blocksInstalled) return;

        const isItemSuppressor = item.categories?.some(c => c.name === 'Silencer') || false;
        if (options.forbidSuppressor && isItemSuppressor) return;

        const itemWeight = item.weight || 0;
        if (maxWeight > 0 && totalWeight + itemWeight > maxWeight + weightEpsilon) return;

        const branchEval = evaluateBranch(item.id, totalErgo, new Set(), totalWeight);
        
        let localScore = branchEval.score;

        if (maxWeight > 0) {
           const hypotheticalWeight = totalWeight + branchEval.totalWeightMod;
           if (hypotheticalWeight > maxWeight + weightEpsilon) return;
        }

        if (localScore > bestScore) {
          bestScore = localScore;
          bestItem = item;
          bestHasSuppressor = branchEval.hasSuppressor;
        }
      });

      if (bestItem) {
        const isMount = bestItem.categories?.some(c => c.name === 'Mount');
        // Check if the item score is so bad that it's just an empty mount (unless we forced it for a suppressor)
        if (isMount && bestScore <= 0 && !(options.requireSuppressor && bestHasSuppressor)) return;

        build.push({ slotName: slot.name, item: bestItem });
        installedIds.add(bestItem.id);
        if (bestItem.conflictingItems) bestItem.conflictingItems.forEach(c => installedConflicts.add(c.id));
        memoizedScores.clear();
        totalErgo += (bestItem.ergonomicsModifier || 0);
        totalRecoilMod += (bestItem.recoilModifier || 0);
        totalWeight += (bestItem.weight || 0);
        totalPrice += (bestItem.avg24hPrice || bestItem.basePrice || 0);
        
        if (bestItem.categories?.some(c => c.name === 'Sights')) hasSight = true;
        if (bestItem.categories?.some(c => c.name === 'Silencer')) hasSuppressorGlobal = true;

        if (bestItem.properties && bestItem.properties.slots) {
          processSlots(bestItem.properties.slots);
        }
      }
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
      price: Math.round(totalPrice)
    }
  };

  const warnings = [];
  if (options.requireSuppressor && !hasSuppressorGlobal) {
    warnings.push('No compatible suppressor could be installed with the current constraints.');
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
