import fs from 'fs';

function calculateBestBuild(weapon, targetType, minErgo, maxRecoil, modMap = {}) {
  const build = [];
  let totalErgo = weapon.properties.ergonomics || 0;
  let totalRecoilMod = 0;
  let totalWeight = weapon.weight || 0;
  let totalPrice = weapon.avg24hPrice || weapon.basePrice || 0;
  let hasSight = false;

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

  function processSlots(slots) {
    const sortedSlots = [...slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));

    sortedSlots.forEach(slot => {
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

        const currentUsableErgo = Math.min(100, totalErgo);
        const newUsableErgo = Math.min(100, totalErgo + ergoMod);
        const effectiveErgoMod = newUsableErgo - currentUsableErgo;

        let score = 0;
        if (targetType === 'meta') {
           score = effectiveErgoMod - (recoilMod * 2);
        }
        score -= (weightMod * 0.001);

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
        totalPrice += (bestItem.avg24hPrice || bestItem.basePrice || 0);

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
          totalPrice -= (bestItem.avg24hPrice || bestItem.basePrice || 0);
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

const res = calculateBestBuild(weapon, 'meta', 0, 0, modMap);
console.log(JSON.stringify(res.stats, null, 2));
console.log(res.build.map(b => b.item.shortName).join(', '));
