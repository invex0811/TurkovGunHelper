import fs from 'fs';

function calculateBestBuildWithWeights(weapon, ergoWeight, recoilWeight, modMap) {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let hasSight = false;

  const baseRecoilV = weapon.properties.recoilVertical || 0;
  const baseRecoilH = weapon.properties.recoilHorizontal || 0;

  const installedIds = new Set([weapon.id]);
  const installedConflicts = new Set();
  if (weapon.conflictingItems) {
    weapon.conflictingItems.forEach(c => installedConflicts.add(c.id));
  }

  function processSlots(slots) {
    slots.forEach(slot => {
      const slotNameId = (slot.nameId || '').toLowerCase();
      if (slotNameId.includes('tactical') || slotNameId.includes('flashlight') || slotNameId.includes('bipod') || slotNameId.includes('launcher') || slotNameId.includes('equipment')) return;

      const allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) return;

      let bestItem = null;
      let bestScore = -Infinity;
      let bestItemScorePure = 0;

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

        const ergoMod = item.ergonomicsModifier || 0;
        const recoilMod = item.recoilModifier || 0; 
        const weightMod = item.weight || 0;

        let score = (ergoMod * ergoWeight) - (recoilMod * recoilWeight) - (weightMod * 0.001);

        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
          bestItemScorePure = score;
        }
      });

      if (bestItem) {
        build.push({ slotName: slot.name, item: bestItem });
        installedIds.add(bestItem.id);
        if (bestItem.conflictingItems) bestItem.conflictingItems.forEach(c => installedConflicts.add(c.id));
        totalErgo += (bestItem.ergonomicsModifier || 0);
        totalRecoilMod += (bestItem.recoilModifier || 0);
        totalWeight += (bestItem.weight || 0);

        const buildLengthBefore = build.length;
        if (bestItem.properties && bestItem.properties.slots) {
          processSlots(bestItem.properties.slots);
        }
        const addedChildrenCount = build.length - buildLengthBefore;
        const isMount = bestItem.categories?.some(c => c.name === 'Mount');

        if (addedChildrenCount === 0 && isMount && bestItemScorePure <= 0) {
          build.pop();
          installedIds.delete(bestItem.id);
          totalErgo -= (bestItem.ergonomicsModifier || 0);
          totalRecoilMod -= (bestItem.recoilModifier || 0);
          totalWeight -= (bestItem.weight || 0);
        } else {
          if (bestItem.categories?.some(c => c.name === 'Sights')) hasSight = true;
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
      weight: totalWeight.toFixed(2)
    }
  };
}

async function run() {
  const modMapRaw = JSON.parse(fs.readFileSync('./mods.json'));
  const weaponRaw = JSON.parse(fs.readFileSync('./weapon.json'));
  const modMap = {};
  modMapRaw.data.items.forEach(i => modMap[i.id] = i);
  const weapon = weaponRaw.data.item;

  const minErgo = 70;
  const maxRecoil = 50;
  
  let bestBuild = null;
  let bestBuildScore = -Infinity;

  for (let i = 0; i <= 20; i++) {
    const ergoWeight = i / 20;
    const recoilWeight = 1 - ergoWeight;
    const result = calculateBestBuildWithWeights(weapon, ergoWeight, recoilWeight, modMap);
    
    // Score the final build
    const e = result.stats.ergonomics;
    const r = result.stats.recoilVertical;
    
    let score = 0;
    
    // Hard constraints check: Did we meet them?
    const ergoMet = e >= minErgo;
    const recoilMet = r <= maxRecoil;
    
    if (ergoMet && recoilMet) {
      // Both met! We want the one that maximizes ergo and minimizes recoil further?
      // Actually, if both met, this is a perfect build. We can score it very high.
      score = 10000 + e - r;
    } else if (ergoMet) {
      // Ergo met, but recoil not. We want to get recoil as low as possible.
      score = 5000 - r; 
    } else if (recoilMet) {
      // Recoil met, but ergo not. We want to get ergo as high as possible.
      score = 5000 + e;
    } else {
      // Neither met. We want to minimize distance to goals.
      score = -((minErgo - e) + (r - maxRecoil));
    }
    
    if (score > bestBuildScore) {
      bestBuildScore = score;
      bestBuild = result;
    }
  }

  const pureRecoil = calculateBestBuildWithWeights(weapon, 0, 1, modMap);
  console.log('Pure Recoil Build:', JSON.stringify(pureRecoil.stats));
  const pureErgo = calculateBestBuildWithWeights(weapon, 1, 0, modMap);
  console.log('Pure Ergo Build:', JSON.stringify(pureErgo.stats));

  console.log('Best Balanced:', JSON.stringify(bestBuild.stats, null, 2));
  console.log(bestBuild.build.map(b => b.item.shortName).join(', '));
}

run();
