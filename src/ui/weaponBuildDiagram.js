import { buildWeaponAssemblyTree } from '../domain/weaponAssembly.js';

export const WEAPON_DIAGRAM_NODE_SIZE = Object.freeze({ width: 190, height: 76 });

const SEMANTIC_RULES = Object.freeze([
  { role: 'muzzle', backbone: 'front', order: 10, pattern: /muzzle|silencer|suppressor|flash hider|compensator|muzzle brake/ },
  { role: 'barrel', backbone: 'front', order: 20, pattern: /barrel/ },
  { role: 'gas-block', backbone: 'front', order: 30, pattern: /gas block|gas tube/ },
  { role: 'handguard', backbone: 'front', order: 40, pattern: /handguard|forestock/ },
  { role: 'receiver', backbone: 'center', order: 10, pattern: /receiver/ },
  { role: 'buffer', backbone: 'rear', order: 10, pattern: /buffer tube|stock adapter|rear adapter/ },
  { role: 'stock', backbone: 'rear', order: 20, pattern: /stock|buttstock/ },
]);

const TOP_PATTERN = /sight|scope|optic|thermal|night vision|collimator|reflex|charging handle|ch\. handle/;
const AMBIGUOUS_TOP_PATTERN = /mount|rail/;
const BOTTOM_PATTERN = /magazine|pistol grip|foregrip|underbarrel|bipod|lower rail/;
const FRONT_ACCESSORY_PATTERN = /tactical|laser|flashlight|front device/;
const REAR_ACCESSORY_PATTERN = /cheek rest|butt ?pad/;

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

function getSemanticText(node) {
  return [node?.category, node?.slotName, node?.slotId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function classifyWeaponDiagramNode(node) {
  if (node?.nodeType === 'weapon' || node?.parentId === null) {
    return {
      role: 'weapon',
      backbone: 'center',
      order: 0,
      direction: null,
      directionWeight: 0,
    };
  }

  const semanticText = getSemanticText(node);
  const structuralRule = SEMANTIC_RULES.find(rule => rule.pattern.test(semanticText));
  if (structuralRule) {
    return { ...structuralRule, direction: null, directionWeight: 0 };
  }
  if (BOTTOM_PATTERN.test(semanticText)) {
    return { role: 'lower', backbone: null, order: 0, direction: 'bottom', directionWeight: 2 };
  }
  if (TOP_PATTERN.test(semanticText)) {
    return { role: 'upper', backbone: null, order: 0, direction: 'top', directionWeight: 2 };
  }
  if (AMBIGUOUS_TOP_PATTERN.test(semanticText)) {
    return { role: 'mount', backbone: null, order: 0, direction: 'top', directionWeight: 0.5 };
  }
  if (REAR_ACCESSORY_PATTERN.test(semanticText)) {
    return { role: 'rear-accessory', backbone: null, order: 0, direction: 'top', directionWeight: 1 };
  }
  if (FRONT_ACCESSORY_PATTERN.test(semanticText)) {
    return { role: 'front-accessory', backbone: null, order: 0, direction: 'bottom', directionWeight: 1 };
  }
  return { role: 'accessory', backbone: null, order: 0, direction: null, directionWeight: 0 };
}

function getGraphDepths(rootId, childrenById) {
  const depths = new Map([[rootId, 0]]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    const depth = depths.get(nodeId);
    (childrenById.get(nodeId) || []).forEach(childId => {
      if (depths.has(childId)) return;
      depths.set(childId, depth + 1);
      queue.push(childId);
    });
  }
  return depths;
}

function getBackboneNodes(nodes, semanticById, depthById, rootId) {
  const byOriginalOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const compareFront = (a, b) => (
    semanticById.get(a.id).order - semanticById.get(b.id).order
    || (depthById.get(b.id) || 0) - (depthById.get(a.id) || 0)
    || byOriginalOrder.get(a.id) - byOriginalOrder.get(b.id)
  );
  const compareRear = (a, b) => (
    semanticById.get(a.id).order - semanticById.get(b.id).order
    || (depthById.get(a.id) || 0) - (depthById.get(b.id) || 0)
    || byOriginalOrder.get(a.id) - byOriginalOrder.get(b.id)
  );
  const front = nodes
    .filter(node => node.id !== rootId && semanticById.get(node.id).backbone === 'front')
    .sort(compareFront);
  const rear = nodes
    .filter(node => node.id !== rootId && semanticById.get(node.id).backbone === 'rear')
    .sort(compareRear);
  const center = nodes
    .filter(node => node.id !== rootId && semanticById.get(node.id).backbone === 'center')
    .sort(compareRear);
  const root = nodes.find(node => node.id === rootId);
  return [...front, ...center, ...(root ? [root] : []), ...rear];
}

function resolveRowCollisions(row, minimumDistance) {
  if (row.length < 2) return;
  row.sort((a, b) => a.desiredX - b.desiredX || a.originalIndex - b.originalIndex);
  const desiredCenter = row.reduce((sum, item) => sum + item.desiredX, 0) / row.length;
  let lastX = Number.NEGATIVE_INFINITY;
  row.forEach(item => {
    item.x = Math.max(item.desiredX, lastX + minimumDistance);
    lastX = item.x;
  });
  const actualCenter = row.reduce((sum, item) => sum + item.x, 0) / row.length;
  row.forEach(item => {
    item.x += desiredCenter - actualCenter;
  });
}

export function layoutWeaponDiagramGraph(graph, options = {}) {
  const nodeWidth = options.nodeWidth || WEAPON_DIAGRAM_NODE_SIZE.width;
  const nodeHeight = options.nodeHeight || WEAPON_DIAGRAM_NODE_SIZE.height;
  const backboneGap = options.backboneGap || 58;
  const verticalGap = options.verticalGap || 54;
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

  const root = nodes.find(node => node.nodeType === 'weapon')
    || nodes.find(node => node.parentId === null || !targetedIds.has(node.id))
    || nodes[0];
  const parentById = new Map();
  edges.forEach(edge => {
    if (edge.target !== root.id && !parentById.has(edge.target)) {
      parentById.set(edge.target, edge.source);
    }
  });

  const semanticById = new Map(nodes.map(node => [node.id, classifyWeaponDiagramNode(node)]));
  const depthById = getGraphDepths(root.id, childrenById);
  const backboneNodes = getBackboneNodes(nodes, semanticById, depthById, root.id);
  const backboneIds = new Set(backboneNodes.map(node => node.id));
  const rootBackboneIndex = Math.max(0, backboneNodes.findIndex(node => node.id === root.id));
  const horizontalStep = nodeWidth + backboneGap;
  const verticalStep = nodeHeight + verticalGap;
  const positions = new Map();

  backboneNodes.forEach((node, index) => {
    positions.set(node.id, { x: (index - rootBackboneIndex) * horizontalStep, y: 0 });
  });

  const subtreeDirectionScores = new Map();
  function getSubtreeDirectionScore(nodeId, active = new Set()) {
    if (subtreeDirectionScores.has(nodeId)) return subtreeDirectionScores.get(nodeId);
    if (active.has(nodeId) || backboneIds.has(nodeId)) return 0;
    const nextActive = new Set(active);
    nextActive.add(nodeId);
    const semantic = semanticById.get(nodeId);
    let score = semantic.direction === 'top'
      ? semantic.directionWeight
      : semantic.direction === 'bottom' ? -semantic.directionWeight : 0;
    (childrenById.get(nodeId) || []).forEach(childId => {
      score += getSubtreeDirectionScore(childId, nextActive);
    });
    subtreeDirectionScores.set(nodeId, score);
    return score;
  }

  const placements = new Map();
  const resolving = new Set();
  function getPlacement(nodeId) {
    if (placements.has(nodeId)) return placements.get(nodeId);
    if (backboneIds.has(nodeId)) return null;
    if (resolving.has(nodeId)) {
      return { anchorId: root.id, side: 'bottom', depth: 1 };
    }
    resolving.add(nodeId);

    const parentId = parentById.get(nodeId);
    const parentPlacement = parentId ? getPlacement(parentId) : null;
    let placement;
    if (parentId && backboneIds.has(parentId)) {
      const score = getSubtreeDirectionScore(nodeId);
      placement = {
        anchorId: parentId,
        side: score >= 0 ? 'top' : 'bottom',
        depth: 1,
      };
    } else if (parentPlacement) {
      placement = {
        anchorId: parentPlacement.anchorId,
        side: parentPlacement.side,
        depth: parentPlacement.depth + 1,
      };
    } else {
      const score = getSubtreeDirectionScore(nodeId);
      placement = {
        anchorId: root.id,
        side: score > 0 ? 'top' : 'bottom',
        depth: 1,
      };
    }
    resolving.delete(nodeId);
    placements.set(nodeId, placement);
    return placement;
  }

  nodes.forEach(node => getPlacement(node.id));
  const maxBranchDepth = Math.max(0, ...[...placements.values()].map(placement => placement.depth));
  const originalIndexById = new Map(nodes.map((node, index) => [node.id, index]));
  for (let depth = 1; depth <= maxBranchDepth; depth += 1) {
    ['top', 'bottom'].forEach(side => {
      const row = nodes
        .filter(node => placements.get(node.id)?.side === side && placements.get(node.id)?.depth === depth)
        .map(node => {
          const parentId = parentById.get(node.id);
          const parentPosition = positions.get(parentId) || positions.get(placements.get(node.id).anchorId) || { x: 0 };
          const siblings = (childrenById.get(parentId) || [])
            .filter(childId => placements.get(childId)?.side === side && placements.get(childId)?.depth === depth);
          const siblingIndex = Math.max(0, siblings.indexOf(node.id));
          const siblingOffset = (siblingIndex - (siblings.length - 1) / 2) * (nodeWidth + siblingGap);
          const anchorSemantic = semanticById.get(placements.get(node.id).anchorId);
          const zoneBias = anchorSemantic.backbone === 'front'
            ? -backboneGap / 2
            : anchorSemantic.backbone === 'rear' ? backboneGap / 2 : 0;
          return {
            node,
            desiredX: parentPosition.x + siblingOffset + zoneBias,
            x: parentPosition.x,
            originalIndex: originalIndexById.get(node.id),
          };
        });

      resolveRowCollisions(row, nodeWidth + siblingGap);
      row.forEach(item => {
        positions.set(item.node.id, {
          x: item.x,
          y: side === 'top' ? -depth * verticalStep : depth * verticalStep,
        });
      });
    });
  }

  const annotatedNodes = nodes.map(node => {
    const semantic = semanticById.get(node.id);
    const placement = placements.get(node.id);
    const anchorSemantic = placement ? semanticById.get(placement.anchorId) : semantic;
    const layoutZone = backboneIds.has(node.id)
      ? `backbone-${semantic.backbone}`
      : anchorSemantic.backbone === 'front' || anchorSemantic.backbone === 'rear'
        ? `${anchorSemantic.backbone}-${placement.side}`
        : placement.side;
    return {
      ...node,
      position: positions.get(node.id) || { x: 0, y: verticalStep },
      width: nodeWidth,
      height: nodeHeight,
      semanticRole: semantic.role,
      layoutZone,
      isBackbone: backboneIds.has(node.id),
      anchorId: placement?.anchorId || null,
    };
  });

  const rootNode = annotatedNodes.find(node => node.id === root.id);
  const minX = Math.min(...annotatedNodes.map(node => node.position.x));
  const maxX = Math.max(...annotatedNodes.map(node => node.position.x + node.width));
  const minY = Math.min(...annotatedNodes.map(node => node.position.y));
  const maxY = Math.max(...annotatedNodes.map(node => node.position.y + node.height));
  const rootCenterX = rootNode.position.x + rootNode.width / 2;
  const backboneCenterY = rootNode.position.y + rootNode.height / 2;
  const halfWidth = Math.max(rootCenterX - minX, maxX - rootCenterX, nodeWidth / 2);
  const halfHeight = Math.max(backboneCenterY - minY, maxY - backboneCenterY, nodeHeight / 2);
  const shiftX = padding + halfWidth - rootCenterX;
  const shiftY = padding + halfHeight - backboneCenterY;
  const positionedNodes = annotatedNodes.map(node => ({
    ...node,
    position: {
      x: node.position.x + shiftX,
      y: node.position.y + shiftY,
    },
  }));

  return {
    nodes: positionedNodes,
    edges,
    width: Math.ceil(padding * 2 + halfWidth * 2),
    height: Math.ceil(padding * 2 + halfHeight * 2),
  };
}

export function getOrthogonalEdgePath(sourceNode, targetNode) {
  if (!sourceNode?.position || !targetNode?.position) return '';
  const sourceCenterX = sourceNode.position.x + sourceNode.width / 2;
  const sourceCenterY = sourceNode.position.y + sourceNode.height / 2;
  const targetCenterX = targetNode.position.x + targetNode.width / 2;
  const targetCenterY = targetNode.position.y + targetNode.height / 2;

  if (sourceNode.isBackbone && targetNode.isBackbone) {
    const direction = targetCenterX >= sourceCenterX ? 1 : -1;
    const sourceX = sourceCenterX + direction * sourceNode.width / 2;
    const targetX = targetCenterX - direction * targetNode.width / 2;
    const freeGap = Math.abs(targetX - sourceX);
    if (freeGap <= 100) {
      return `M ${sourceX} ${sourceCenterY} H ${targetX}`;
    }
    const laneY = Math.min(sourceNode.position.y, targetNode.position.y) - 18;
    return `M ${sourceCenterX} ${sourceNode.position.y} V ${laneY} H ${targetCenterX} V ${targetNode.position.y}`;
  }

  const goesUp = targetCenterY < sourceCenterY;
  const sourceY = goesUp ? sourceNode.position.y : sourceNode.position.y + sourceNode.height;
  const targetY = goesUp ? targetNode.position.y + targetNode.height : targetNode.position.y;
  const middleY = sourceY + (targetY - sourceY) / 2;
  return `M ${sourceCenterX} ${sourceY} V ${middleY} H ${targetCenterX} V ${targetY}`;
}
