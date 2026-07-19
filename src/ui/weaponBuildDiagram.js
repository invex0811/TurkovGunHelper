import { buildWeaponAssemblyTree } from '../domain/weaponAssembly.js';

export const WEAPON_DIAGRAM_NODE_SIZE = Object.freeze({ width: 190, height: 76 });

const GENERIC_CATEGORIES = new Set([
  'Item',
  'Weapon mod',
  'Gear mod',
  'Functional mod',
  'Essential mod',
  'Compound item',
]);

function getItemCategory(item, fallback = 'Module') {
  const categories = (item?.categories || [])
    .map(category => category?.name)
    .filter(Boolean);
  return categories.find(category => !GENERIC_CATEGORIES.has(category))
    || categories[0]
    || fallback;
}

function getCategoryPriority(item, slotName) {
  const categoryText = [
    slotName,
    ...(item?.categories || []).map(category => category?.name),
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(receiver|barrel|handguard|stock|gas block|charging handle|muzzle|buffer)/.test(categoryText)) {
    return 1;
  }
  if (/(sight|scope|optic|mount)/.test(categoryText)) return 2;
  if (/(magazine|pistol grip|foregrip|grip)/.test(categoryText)) return 3;
  if (/(tactical|laser|flashlight|rail)/.test(categoryText)) return 4;
  return 5;
}

function getNodeSortRank(treeNode) {
  if (treeNode.sourceSlot?.required === true) return 0;
  return getCategoryPriority(treeNode.item, treeNode.slotName);
}

function sortTreeChildren(children) {
  return [...children]
    .map((child, originalIndex) => ({ child, originalIndex }))
    .sort((a, b) => (
      getNodeSortRank(a.child) - getNodeSortRank(b.child)
      || a.originalIndex - b.originalIndex
    ))
    .map(({ child }) => child);
}

function toIdSegment(value) {
  return encodeURIComponent(String(value || 'unknown')).replaceAll('%', '_');
}

function getImageUrl(item) {
  return item?.image512pxLink || item?.iconLink || '';
}

function getNodeStats(item) {
  const stats = [];
  if (Number.isFinite(Number(item?.weight)) && Number(item.weight) > 0) {
    stats.push(`Вес: ${Number(item.weight).toFixed(3)} кг`);
  }
  if (Number.isFinite(Number(item?.ergonomicsModifier)) && Number(item.ergonomicsModifier) !== 0) {
    stats.push(`Эргономика: ${Number(item.ergonomicsModifier) > 0 ? '+' : ''}${item.ergonomicsModifier}`);
  }
  if (Number.isFinite(Number(item?.recoilModifier)) && Number(item.recoilModifier) !== 0) {
    stats.push(`Отдача: ${Number(item.recoilModifier) > 0 ? '+' : ''}${item.recoilModifier}%`);
  }
  return stats;
}

function createDiagramNode({
  id,
  item,
  parentId,
  slot,
  slotName,
  nodeType,
  critical = false,
  unresolved = false,
}) {
  return {
    id,
    itemId: item?.id || '',
    parentId,
    slotId: slot?.nameId || slot?.name || slotName || undefined,
    slotName: slot?.name || slotName || undefined,
    name: item?.shortName || item?.name || 'Unknown module',
    fullName: item?.name || item?.shortName || 'Unknown module',
    category: getItemCategory(item, nodeType === 'weapon' ? 'Weapon' : 'Module'),
    imageUrl: getImageUrl(item),
    critical,
    nodeType,
    unresolved,
    stats: getNodeStats(item),
  };
}

export function buildWeaponDiagramGraph(weapon, buildParts = []) {
  if (!weapon) {
    return { nodes: [], edges: [], diagnostics: [] };
  }

  const assemblyTree = buildWeaponAssemblyTree(weapon, buildParts);
  const nodes = [];
  const edges = [];
  const diagnostics = [];
  const rootId = `weapon:${toIdSegment(weapon.id || weapon.shortName || weapon.name)}`;
  const visitedTreeNodes = new Set();

  nodes.push(createDiagramNode({
    id: rootId,
    item: weapon,
    parentId: null,
    slot: null,
    slotName: null,
    nodeType: 'weapon',
  }));

  function visit(treeNode, parentId, ancestry) {
    if (visitedTreeNodes.has(treeNode)) {
      diagnostics.push({ type: 'duplicate-tree-node', itemId: treeNode.item?.id || '' });
      return;
    }
    visitedTreeNodes.add(treeNode);

    const siblingOccurrences = new Map();
    sortTreeChildren(treeNode.children).forEach(child => {
      const slotId = child.sourceSlot?.nameId || child.sourceSlot?.name || child.slotName || 'slot';
      const occurrenceKey = `${slotId}:${child.item?.id || 'unknown'}`;
      const occurrence = siblingOccurrences.get(occurrenceKey) || 0;
      siblingOccurrences.set(occurrenceKey, occurrence + 1);
      const childId = `${parentId}/${toIdSegment(slotId)}:${toIdSegment(child.item?.id)}:${occurrence}`;
      const isCycle = ancestry.has(child);

      nodes.push(createDiagramNode({
        id: childId,
        item: child.item,
        parentId,
        slot: child.sourceSlot,
        slotName: child.slotName,
        nodeType: 'module',
        critical: child.sourceSlot?.required === true,
      }));
      edges.push({
        id: `edge:${parentId}->${childId}`,
        source: parentId,
        target: childId,
        slotId,
      });

      if (isCycle) {
        diagnostics.push({ type: 'cycle', itemId: child.item?.id || '' });
        return;
      }

      const nextAncestry = new Set(ancestry);
      nextAncestry.add(child);
      visit(child, childId, nextAncestry);
    });
  }

  visit(assemblyTree, rootId, new Set([assemblyTree]));

  (assemblyTree.unattachedParts || []).forEach((part, index) => {
    if (!part?.item) return;
    const nodeId = `${rootId}/unresolved:${toIdSegment(part.slotName)}:${toIdSegment(part.item.id)}:${index}`;
    nodes.push(createDiagramNode({
      id: nodeId,
      item: part.item,
      parentId: rootId,
      slot: null,
      slotName: part.slotName,
      nodeType: 'module',
      unresolved: true,
    }));
    edges.push({
      id: `edge:${rootId}->${nodeId}`,
      source: rootId,
      target: nodeId,
      slotId: part.slotName,
      unresolved: true,
    });
    diagnostics.push({
      type: 'unresolved-parent',
      itemId: part.item.id,
      slotName: part.slotName,
    });
  });

  return { nodes, edges, diagnostics };
}

export function layoutWeaponDiagramGraph(graph, options = {}) {
  const nodeWidth = options.nodeWidth || WEAPON_DIAGRAM_NODE_SIZE.width;
  const nodeHeight = options.nodeHeight || WEAPON_DIAGRAM_NODE_SIZE.height;
  const layerGap = options.layerGap || 92;
  const siblingGap = options.siblingGap || 24;
  const padding = options.padding || 48;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: padding * 2, height: padding * 2 };
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const childrenById = new Map(nodes.map(node => [node.id, []]));
  const targetedIds = new Set();

  edges.forEach(edge => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    childrenById.get(edge.source).push(edge.target);
    targetedIds.add(edge.target);
  });

  const roots = nodes.filter(node => node.parentId === null || !targetedIds.has(node.id));
  if (roots.length === 0) roots.push(nodes[0]);

  const positions = new Map();
  const laidOut = new Set();
  const active = new Set();
  let maxDepth = 0;

  function layoutNode(nodeId, depth, top) {
    if (active.has(nodeId) || laidOut.has(nodeId)) return nodeHeight;

    active.add(nodeId);
    maxDepth = Math.max(maxDepth, depth);
    const childIds = (childrenById.get(nodeId) || []).filter(childId => !active.has(childId));
    let blockHeight = nodeHeight;

    if (childIds.length > 0) {
      let childTop = top;
      let childrenHeight = 0;
      childIds.forEach((childId, index) => {
        const childHeight = layoutNode(childId, depth + 1, childTop);
        childTop += childHeight + (index < childIds.length - 1 ? siblingGap : 0);
        childrenHeight += childHeight;
      });
      childrenHeight += siblingGap * Math.max(0, childIds.length - 1);
      blockHeight = Math.max(nodeHeight, childrenHeight);
    }

    positions.set(nodeId, {
      x: padding + depth * (nodeWidth + layerGap),
      y: top + (blockHeight - nodeHeight) / 2,
    });
    active.delete(nodeId);
    laidOut.add(nodeId);
    return blockHeight;
  }

  let nextTop = padding;
  roots.forEach(root => {
    const rootHeight = layoutNode(root.id, 0, nextTop);
    nextTop += rootHeight + siblingGap * 2;
  });
  nodes.forEach(node => {
    if (laidOut.has(node.id)) return;
    const nodeBlockHeight = layoutNode(node.id, 0, nextTop);
    nextTop += nodeBlockHeight + siblingGap * 2;
  });

  const positionedNodes = nodes.map(node => ({
    ...node,
    position: positions.get(node.id) || { x: padding, y: nextTop },
    width: nodeWidth,
    height: nodeHeight,
  }));
  const width = padding * 2 + (maxDepth + 1) * nodeWidth + maxDepth * layerGap;
  const height = Math.max(padding * 2 + nodeHeight, nextTop - siblingGap * 2 + padding);

  return { nodes: positionedNodes, edges, width, height };
}

export function getOrthogonalEdgePath(sourceNode, targetNode) {
  if (!sourceNode?.position || !targetNode?.position) return '';
  const sourceX = sourceNode.position.x + sourceNode.width;
  const sourceY = sourceNode.position.y + sourceNode.height / 2;
  const targetX = targetNode.position.x;
  const targetY = targetNode.position.y + targetNode.height / 2;
  const middleX = sourceX + (targetX - sourceX) / 2;
  return `M ${sourceX} ${sourceY} H ${middleX} V ${targetY} H ${targetX}`;
}
