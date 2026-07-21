function toStableSegment(value) {
  return encodeURIComponent(String(value || 'unknown')).replaceAll('%', '_');
}

export function getBuildSlotId(slot, slotIndex = 0) {
  const apiId = slot?.id || slot?.nameId || slot?.name || 'slot';
  return `${apiId}:${slotIndex}`;
}

export function getBuildSlotInstanceId(parentInstanceId, slot, slotIndex = 0) {
  return `${parentInstanceId}/slot:${toStableSegment(getBuildSlotId(slot, slotIndex))}`;
}

export function getBuildItemInstanceId(slotInstanceId, item) {
  return `${slotInstanceId}/item:${toStableSegment(item?.id)}`;
}

export function buildWeaponAssemblyTree(weapon, buildParts = []) {
  const rootInstanceId = `weapon:${toStableSegment(weapon?.id || weapon?.shortName || weapon?.name)}`;
  const root = {
    item: weapon,
    buildPart: null,
    sourceSlot: null,
    slotName: 'Root',
    children: [],
    slots: [],
    parent: null,
    instanceId: rootInstanceId,
    unattachedParts: [],
  };

  if (!weapon) return root;

  const queue = [root];
  let queueIndex = 0;
  const remainingParts = [...buildParts];

  while (queueIndex < queue.length) {
    const currentNode = queue[queueIndex];
    queueIndex += 1;
    const slots = currentNode.item.properties?.slots || [];

    slots.forEach((slot, slotIndex) => {
      const slotId = getBuildSlotId(slot, slotIndex);
      const slotInstanceId = getBuildSlotInstanceId(currentNode.instanceId, slot, slotIndex);
      const allowedIds = new Set((slot.filters?.allowedItems || []).map(item => item.id));

      const partIndex = remainingParts.findIndex(part => {
        if (!allowedIds.has(part.item.id)) {
          return false;
        }

        if (part.slotInstanceId) return part.slotInstanceId === slotInstanceId;
        if (part.parentInstanceId && part.parentInstanceId !== currentNode.instanceId) return false;
        if (part.parentItemId && part.parentItemId !== currentNode.item.id) return false;
        if (part.slotId) return part.slotId === slotId || part.slotId === slot.nameId;
        if (part.slotName !== slot.name) return false;

        const hasAlternativeParent = remainingParts.some(otherPart => {
          if (otherPart === part) return false;
          const otherSlots = otherPart.item.properties?.slots || [];
          return otherSlots.some(otherSlot => (
            otherSlot.name === part.slotName
            && (otherSlot.filters?.allowedItems || []).some(item => item.id === part.item.id)
          ));
        });
        return !hasAlternativeParent;
      });

      const slotContext = {
        id: slotInstanceId,
        slotId,
        slotIndex,
        slot,
        parent: currentNode,
        installedNode: null,
      };
      currentNode.slots.push(slotContext);

      if (partIndex === -1) return;

      const [part] = remainingParts.splice(partIndex, 1);
      const childNode = {
        item: part.item,
        buildPart: part,
        sourceSlot: slot,
        slotName: slot.name,
        children: [],
        slots: [],
        parent: currentNode,
        instanceId: getBuildItemInstanceId(slotInstanceId, part.item),
        sourceSlotId: slotId,
        sourceSlotIndex: slotIndex,
        sourceSlotInstanceId: slotInstanceId,
      };
      slotContext.installedNode = childNode;
      currentNode.children.push(childNode);
      queue.push(childNode);
    });
  }

  root.unattachedParts = remainingParts;
  return root;
}
