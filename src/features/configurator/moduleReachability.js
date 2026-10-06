// Collects every module that can be installed on the weapon, directly or
// through mounts and adapters, by walking the slot tree once.
export function getReachableModuleIds(weapon, allMods) {
  const reachableIds = new Set();
  if (!weapon?.id || !allMods) return reachableIds;

  const queue = [weapon];
  const visitedIds = new Set([weapon.id]);
  while (queue.length > 0) {
    const item = queue.pop();
    for (const slot of item.properties?.slots || []) {
      for (const reference of slot.filters?.allowedItems || []) {
        const child = allMods[reference?.id];
        if (!child?.id || visitedIds.has(child.id)) continue;
        visitedIds.add(child.id);
        reachableIds.add(child.id);
        queue.push(child);
      }
    }
  }
  return reachableIds;
}
