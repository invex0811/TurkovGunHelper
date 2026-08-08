export function getMetaObjectiveScore(
  { baseErgo, itemErgo, itemRecoil, itemWeight },
  {
    ergoCap,
    ergoSoftCap,
    ergoWeight,
    overflowErgoWeight,
    recoilWeight,
    weightWeight,
  },
) {
  const getEffectiveErgo = value => Math.min(ergoCap, value)
    + (Math.max(0, Math.min(ergoSoftCap, value) - ergoCap) * overflowErgoWeight);
  const effectiveErgoDelta = getEffectiveErgo(baseErgo + itemErgo)
    - getEffectiveErgo(baseErgo);

  return (effectiveErgoDelta * ergoWeight)
    - (itemRecoil * recoilWeight)
    - (itemWeight * weightWeight);
}

export function getMetaResultScore(result, weapon, scoringOptions) {
  if (result.error || result.stats.price == null) return -Infinity;

  return getMetaObjectiveScore(
    {
      baseErgo: weapon.properties.ergonomics || 0,
      itemErgo: result.build.reduce(
        (sum, part) => sum + (part.item.ergonomicsModifier || 0),
        0,
      ),
      itemRecoil: result.build.reduce(
        (sum, part) => sum + (part.item.recoilModifier || 0),
        0,
      ),
      itemWeight: result.build.reduce(
        (sum, part) => sum + (part.item.weight || 0),
        0,
      ),
    },
    scoringOptions,
  );
}

export function getPriceAwareResultScore(
  result,
  {
    ergoWeight,
    priceWeight,
    recoilWeight,
    weightWeight,
  },
) {
  if (result.error || result.stats.price == null) return -Infinity;

  const itemErgo = result.build.reduce(
    (sum, part) => sum + (part.item.ergonomicsModifier || 0),
    0,
  );
  const itemRecoil = result.build.reduce(
    (sum, part) => sum + (part.item.recoilModifier || 0),
    0,
  );
  const itemWeight = result.build.reduce(
    (sum, part) => sum + (part.item.weight || 0),
    0,
  );

  return (itemErgo * ergoWeight)
    - (itemRecoil * recoilWeight)
    - (result.stats.price * priceWeight)
    - (itemWeight * weightWeight);
}

export function getCustomScore(matches) {
  return 10000
    + matches.ergonomics
    - matches.verticalRecoil
    - matches.horizontalRecoil;
}

export function getBuildTieKey(result) {
  return result.build
    .map(part => String(part.item?.id ?? ''))
    .sort()
    .join('|');
}
