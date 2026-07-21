function normalizeNode(node) {
  const indexedSuffix = Number.isInteger(node.slotIndex) ? `:${node.slotIndex}` : '';
  const slotId = indexedSuffix && String(node.slotId).endsWith(indexedSuffix)
    ? String(node.slotId).slice(0, -indexedSuffix.length)
    : node.slotId;
  return {
    itemId: node.itemId,
    slotId,
    ...(Number.isInteger(node.slotIndex) ? { slotIndex: node.slotIndex } : {}),
    children: (node.children || [])
      .map(normalizeNode)
      .sort((first, second) => (
        String(first.slotId).localeCompare(String(second.slotId))
        || String(first.itemId).localeCompare(String(second.itemId))
        || JSON.stringify(first).localeCompare(JSON.stringify(second))
      )),
  };
}

export function getBuildFingerprint(build) {
  return JSON.stringify({
    gameMode: build.gameMode,
    weaponId: build.weaponId,
    configuration: normalizeNode(build.configuration),
  });
}
