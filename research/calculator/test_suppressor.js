import fs from 'fs';

function _calculateWeighted(weapon, ergoWeight, recoilWeight, priceWeight, modMap, options = {}) {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = weapon.avg24hPrice || weapon.basePrice || 0;
  let hasSight = false;
  let hasSuppressorGlobal = weapon.categories?.some(c => c.name === 'Suppressor') || false;

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

  const memoizedScores = {};

  function evaluateBranch(itemId, currentErgo) {
    const memoKey = `${itemId}_${Math.floor(currentErgo)}`;
    if (memoizedScores[memoKey]) return memoizedScores[memoKey];

    const item = modMap[itemId];
    if (!item) return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };

    const ergoMod = item.ergonomicsModifier || 0;
    const recoilMod = item.recoilModifier || 0; 
    const price = item.avg24hPrice || item.basePrice || 0;
    const weightMod = item.weight || 0;
    const isSuppressor = item.categories?.some(c => c.name === 'Suppressor') || false;

    if (options.forbidSuppressor && isSuppressor) {
      return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };
    }

    const currentUsableErgo = Math.min(100, currentErgo);
    const newUsableErgo = Math.min(100, currentErgo + ergoMod);
    const effectiveErgoMod = newUsableErgo - currentUsableErgo;

    let branchScore = (effectiveErgoMod * ergoWeight) - (recoilMod * recoilWeight) - (price * priceWeight) - (weightMod * 0.001);
    let branchErgo = Math.max(0, currentErgo + ergoMod);
    let branchWeight = weightMod;
    let branchHasSuppressor = isSuppressor;

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

        allowed.forEach(child => {
           const childEval = evaluateBranch(child.id, branchErgo);
           let childScoreMod = childEval.score;
           
           if (childScoreMod > bestChildScore) {
             bestChildScore = childScoreMod;
             bestChildErgoMod = childEval.totalErgoMod;
             bestChildWeightMod = childEval.totalWeightMod;
             bestChildHasSuppressor = childEval.hasSuppressor;
           }
        });

        // We MUST add it if it brings the suppressor! 
        // Oh, wait! If the bestChildScore is > 0, we add it. 
        // But what if we REQUIRE a suppressor, and a child has a suppressor, but the BEST child score is STILL < 0? 
        // No, bestChildScore would be > 5000 because the suppressor adds +5000.
        // But what if the slot is a MOUNT slot, and it requires > 0 to be installed in greedy? 
        if (bestChildScore > -Infinity && bestChildScore > 0) {
           branchScore += bestChildScore;
           branchErgo = Math.max(0, branchErgo + bestChildErgoMod);
           branchWeight += bestChildWeightMod;
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
    memoizedScores[memoKey] = result;
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

      allowed.forEach(shallowItem => {
        const item = modMap[shallowItem.id] || shallowItem;
        
        const isSight = item.categories?.some(c => c.name === 'Sights');
        if (hasSight && isSight) return;
        if (installedConflicts.has(item.id)) return;
        
        let blocksInstalled = false;
        if (item.conflictingItems) {
          for (const conflict of item.conflictingItems) {
            if (installedIds.has(conflict.id)) { blocksInstalled = true; break; }
          }
        }
        if (blocksInstalled) return;

        const isItemSuppressor = item.categories?.some(c => c.name === 'Suppressor') || false;
        if (options.forbidSuppressor && isItemSuppressor) return;

        const branchEval = evaluateBranch(item.id, totalErgo);
        let localScore = branchEval.score;

        if (options.maxWeight > 0) {
           const hypotheticalWeight = totalWeight + branchEval.totalWeightMod;
           if (hypotheticalWeight > options.maxWeight) {
             localScore -= (hypotheticalWeight - options.maxWeight) * 1000;
           }
        }

        console.log(`Evaluating: ${item.shortName} in slot ${slot.name}, score: ${localScore}`);

        if (localScore > bestScore) {
          bestScore = localScore;
          bestItem = item;
        }
      });

      if (bestItem) {
        const isMount = bestItem.categories?.some(c => c.name === 'Mount');
        if (isMount && bestScore <= 0 && !options.requireSuppressor) return;

        build.push({ slotName: slot.name, item: bestItem });
        installedIds.add(bestItem.id);
        if (bestItem.conflictingItems) bestItem.conflictingItems.forEach(c => installedConflicts.add(c.id));
        totalErgo += (bestItem.ergonomicsModifier || 0);
        totalRecoilMod += (bestItem.recoilModifier || 0);
        totalWeight += (bestItem.weight || 0);
        totalPrice += (bestItem.avg24hPrice || bestItem.basePrice || 0);
        
        if (bestItem.categories?.some(c => c.name === 'Sights')) hasSight = true;
        if (bestItem.categories?.some(c => c.name === 'Suppressor')) hasSuppressorGlobal = true;

        if (bestItem.properties && bestItem.properties.slots) {
          processSlots(bestItem.properties.slots);
        }
      }
    });
  }

  processSlots(weapon.properties.slots);

  const finalRecoilV = baseRecoilV * (1 + (totalRecoilMod / 100));
  const finalRecoilH = baseRecoilH * (1 + (totalRecoilMod / 100));

  return {
    build,
    stats: {
      ergonomics: Math.min(100, Math.round(totalErgo)),
      recoilVertical: Math.round(finalRecoilV),
      recoilHorizontal: Math.round(finalRecoilH),
      weight: totalWeight.toFixed(2),
      price: Math.round(totalPrice)
    }
  };
}

const modMapRaw = JSON.parse(fs.readFileSync('./mods.json'));
const weaponRaw = JSON.parse(fs.readFileSync('./weapon.json'));
const modMap = {};
modMapRaw.data.items.forEach(i => modMap[i.id] = i);
const weapon = weaponRaw.data.item;

const res = _calculateWeighted(weapon, 1, 2, 0, modMap, { requireSuppressor: true, forbidSuppressor: false });
console.log(JSON.stringify(res.stats, null, 2));
console.log(res.build.map(b => b.item.shortName).join(', '));
