export function buildWeaponAssemblyTree(weapon, buildParts = []) {
  const root = {
    item: weapon,
    buildPart: null,
    sourceSlot: null,
    slotName: 'Root',
    children: [],
    parent: null,
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

    slots.forEach(slot => {
      const allowedIds = new Set((slot.filters?.allowedItems || []).map(item => item.id));

      const partIndex = remainingParts.findIndex(part => {
        if (part.slotName !== slot.name || !allowedIds.has(part.item.id)) {
          return false;
        }

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

      if (partIndex === -1) return;

      const [part] = remainingParts.splice(partIndex, 1);
      const childNode = {
        item: part.item,
        buildPart: part,
        sourceSlot: slot,
        slotName: slot.name,
        children: [],
        parent: currentNode,
      };
      currentNode.children.push(childNode);
      queue.push(childNode);
    });
  }

  root.unattachedParts = remainingParts;
  return root;
}
