import fs from 'fs';

const modMapRaw = JSON.parse(fs.readFileSync('./mods.json'));
const modMap = {};
modMapRaw.data.items.forEach(i => modMap[i.id] = i);

const options = { requireSuppressor: true, forbidSuppressor: false, maxWeight: 0 };
const ergoWeight = 1, recoilWeight = 2, priceWeight = 0;
const memoizedScores = {};

const slotPriority = {
  'receiver': 1, 'barrel': 2, 'gas block': 3, 'handguard': 4,
  'stock': 5, 'muzzle': 6, 'pistol grip': 7, 'magazine': 8,
  'scope': 9, 'mount': 10
};

function getSlotPriority(slotName) {
  const name = (slotName || '').toLowerCase();
  return slotPriority[name] || 99;
}

function evaluateBranch(itemId, currentErgo, depth = 0) {
  const item = modMap[itemId];
  if (!item) return { score: -Infinity, totalErgoMod: 0, totalWeightMod: 0, hasSuppressor: false };

  const ergoMod = item.ergonomicsModifier || 0;
  const recoilMod = item.recoilModifier || 0; 
  const price = item.avg24hPrice || item.basePrice || 0;
  const weightMod = item.weight || 0;
  const isSuppressor = item.categories?.some(c => c.name === 'Silencer') || false;

  const currentUsableErgo = Math.min(100, currentErgo);
  const newUsableErgo = Math.min(100, currentErgo + ergoMod);
  const effectiveErgoMod = newUsableErgo - currentUsableErgo;

  let branchScore = (effectiveErgoMod * ergoWeight) - (recoilMod * recoilWeight) - (price * priceWeight) - (weightMod * 0.001);
  let branchErgo = Math.max(0, currentErgo + ergoMod);
  let branchWeight = weightMod;
  let branchHasSuppressor = isSuppressor;

  if (options.requireSuppressor && isSuppressor) {
    branchScore += 5000;
    console.log(`${'  '.repeat(depth)}[!] Suppressor boost applied for ${item.shortName}`);
  }

  if (item.properties && item.properties.slots) {
    const sortedSlots = [...item.properties.slots].sort((a, b) => getSlotPriority(a.name) - getSlotPriority(b.name));
    
    sortedSlots.forEach(slot => {
      const allowed = slot.filters?.allowedItems;
      if (!allowed || allowed.length === 0) return;

      let bestChildScore = -Infinity;
      let bestChildErgoMod = 0;
      let bestChildHasSuppressor = false;
      let bestChildName = null;

      allowed.forEach(child => {
         const childEval = evaluateBranch(child.id, branchErgo, depth + 1);
         if (childEval.score > bestChildScore) {
           bestChildScore = childEval.score;
           bestChildErgoMod = childEval.totalErgoMod;
           bestChildHasSuppressor = childEval.hasSuppressor;
           bestChildName = modMap[child.id]?.shortName;
         }
      });

      if (bestChildScore > 0) {
         branchScore += bestChildScore;
         branchErgo = Math.max(0, branchErgo + bestChildErgoMod);
         if (bestChildHasSuppressor) branchHasSuppressor = true;
         console.log(`${'  '.repeat(depth)}Slot ${slot.name} picked ${bestChildName} with score ${bestChildScore}`);
      } else {
         console.log(`${'  '.repeat(depth)}Slot ${slot.name} best child score was ${bestChildScore}, skipping.`);
      }
    });
  }
  
  return { score: branchScore, totalErgoMod: branchErgo - currentErgo, hasSuppressor: branchHasSuppressor };
}

console.log("Evaluating SPR Brake:");
const res = evaluateBranch('68caac500bfe742288085e1e', 50);
console.log("Final SPR Brake score:", res.score);

