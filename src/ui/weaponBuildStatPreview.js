import { recalculateBuildStats } from '../domain/calculator.js';
import { planBuildSlotChange } from '../domain/weaponBuildEditor.js';

const STAT_KEYS = Object.freeze({
  ergonomics: 'ergonomics',
  verticalRecoil: 'vertical-recoil',
  horizontalRecoil: 'horizontal-recoil',
  weight: 'weight',
});

export function getActivePreviewCandidate(hoveredCandidate, focusedCandidate) {
  return hoveredCandidate || focusedCandidate || null;
}

export function getProjectedBuildMeters({
  weapon,
  buildParts,
  allMods,
  slotInstanceId,
  nextItem,
  priceMode,
  includeTraderPrices,
  meters,
}) {
  const plan = planBuildSlotChange({
    weapon,
    buildParts,
    allMods,
    slotInstanceId,
    nextItem,
    priceMode,
    includeTraderPrices,
  });
  if (plan.errors?.length > 0 || plan.changed === false) return null;

  const projectedStats = recalculateBuildStats(weapon, plan.buildParts, {
    priceMode,
    includeTraderPrices,
  }).stats;
  const weight = Number(projectedStats.weight);

  return meters.map(meter => {
    switch (meter.key) {
      case STAT_KEYS.weight:
        return { ...meter, value: weight, displayValue: `${projectedStats.weight} kg` };
      case STAT_KEYS.ergonomics:
        return {
          ...meter,
          value: projectedStats.ergonomics,
          displayValue: projectedStats.ergonomics,
        };
      case STAT_KEYS.verticalRecoil:
        return {
          ...meter,
          value: projectedStats.recoilVertical,
          displayValue: projectedStats.recoilVertical,
        };
      case STAT_KEYS.horizontalRecoil:
        return {
          ...meter,
          value: projectedStats.recoilHorizontal,
          displayValue: projectedStats.recoilHorizontal,
        };
      default:
        return meter;
    }
  });
}
