import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeaponDiagramGraph,
  classifyWeaponDiagramNode,
  getOrthogonalEdgePath,
  isDiagramEdgeHighlighted,
  layoutWeaponDiagramGraph,
} from '../../src/ui/weaponBuildDiagram.js';

function createSlot(name, allowedItems, required = false) {
  return {
    name,
    nameId: `id_${name.toLowerCase()}`,
    required,
    filters: { allowedItems: allowedItems.map(id => ({ id })) },
  };
}

function createItem(id, options = {}) {
  return {
    id,
    name: options.name || `${id} full name`,
    shortName: options.shortName || id,
    image512pxLink: options.imageUrl,
    categories: [{ name: options.category || 'Weapon mod' }],
    properties: { slots: options.slots || [] },
  };
}

function createWeapon(slots = []) {
  return createItem('weapon', {
    name: 'Test weapon',
    shortName: 'Weapon',
    category: 'Assault rifle',
    slots,
  });
}

function install(slotName, item) {
  return { slotName, item };
}

test('builds a root-only graph for a weapon without modules', () => {
  const graph = buildWeaponDiagramGraph(createWeapon(), []);

  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].nodeType, 'weapon');
  assert.equal(graph.edges.length, 0);
});

test('connects one direct module to the weapon', () => {
  const barrel = createItem('barrel', { category: 'Barrel' });
  const weapon = createWeapon([createSlot('Barrel', ['barrel'], true)]);
  const graph = buildWeaponDiagramGraph(weapon, [install('Barrel', barrel)]);
  const moduleNode = graph.nodes.find(node => node.itemId === 'barrel');

  assert.equal(graph.nodes.length, 2);
  assert.equal(moduleNode.parentId, graph.nodes[0].id);
  assert.equal(moduleNode.critical, true);
  assert.equal(graph.edges[0].target, moduleNode.id);
});

test('keeps several direct weapon modules as separate children', () => {
  const barrel = createItem('barrel', { category: 'Barrel' });
  const magazine = createItem('magazine', { category: 'Magazine' });
  const grip = createItem('grip', { category: 'Pistol grip' });
  const weapon = createWeapon([
    createSlot('Barrel', ['barrel']),
    createSlot('Magazine', ['magazine']),
    createSlot('Pistol Grip', ['grip']),
  ]);
  const graph = buildWeaponDiagramGraph(weapon, [
    install('Barrel', barrel),
    install('Magazine', magazine),
    install('Pistol Grip', grip),
  ]);

  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3);
  assert.equal(new Set(graph.nodes.slice(1).map(node => node.parentId)).size, 1);
});

test('preserves a nested weapon to handguard to rail to laser chain', () => {
  const laser = createItem('laser', { category: 'Tactical device' });
  const rail = createItem('rail', {
    category: 'Mount',
    slots: [createSlot('Tactical', ['laser'])],
  });
  const handguard = createItem('handguard', {
    category: 'Handguard',
    slots: [createSlot('Rail', ['rail'])],
  });
  const weapon = createWeapon([createSlot('Handguard', ['handguard'], true)]);
  const graph = buildWeaponDiagramGraph(weapon, [
    install('Tactical', laser),
    install('Rail', rail),
    install('Handguard', handguard),
  ]);
  const handguardNode = graph.nodes.find(node => node.itemId === 'handguard');
  const railNode = graph.nodes.find(node => node.itemId === 'rail');
  const laserNode = graph.nodes.find(node => node.itemId === 'laser');

  assert.equal(handguardNode.parentId, graph.nodes[0].id);
  assert.equal(railNode.parentId, handguardNode.id);
  assert.equal(laserNode.parentId, railNode.id);

  const highlightedEdges = graph.edges.filter(edge => (
    isDiagramEdgeHighlighted(edge, laserNode.id)
  ));
  assert.equal(highlightedEdges.length, 1);
  assert.equal(highlightedEdges[0].source, railNode.id);
  assert.equal(highlightedEdges[0].target, laserNode.id);
});

test('sorts critical children before ordinary children', () => {
  const ordinary = createItem('ordinary', { category: 'Barrel' });
  const critical = createItem('critical', { category: 'Pistol grip' });
  const weapon = createWeapon([
    createSlot('Ordinary', ['ordinary']),
    createSlot('Critical', ['critical'], true),
  ]);
  const graph = buildWeaponDiagramGraph(weapon, [
    install('Ordinary', ordinary),
    install('Critical', critical),
  ]);

  assert.deepEqual(graph.nodes.slice(1).map(node => node.itemId), ['critical', 'ordinary']);
});

test('handles a missing module image without throwing', () => {
  const module = createItem('no-image');
  const weapon = createWeapon([createSlot('Module', ['no-image'])]);
  const graph = buildWeaponDiagramGraph(weapon, [install('Module', module)]);

  assert.equal(graph.nodes[1].imageUrl, '');
});

test('creates distinct stable nodes for a repeated item id in different slots', () => {
  const repeated = createItem('same-item');
  const weapon = createWeapon([
    createSlot('Left', ['same-item']),
    createSlot('Right', ['same-item']),
  ]);
  const graph = buildWeaponDiagramGraph(weapon, [
    install('Left', repeated),
    install('Right', repeated),
  ]);
  const repeatedNodes = graph.nodes.filter(node => node.itemId === 'same-item');

  assert.equal(repeatedNodes.length, 2);
  assert.notEqual(repeatedNodes[0].id, repeatedNodes[1].id);
  assert.match(repeatedNodes[0].id, /left/i);
  assert.match(repeatedNodes[1].id, /right/i);
});

test('terminates safely when installed item slot definitions form a cycle', () => {
  const itemA = createItem('a');
  const itemB = createItem('b');
  itemA.properties.slots = [createSlot('B slot', ['b'])];
  itemB.properties.slots = [createSlot('A slot', ['a'])];
  const weapon = createWeapon([createSlot('A slot', ['a'])]);

  const graph = buildWeaponDiagramGraph(weapon, [
    install('A slot', itemA),
    install('B slot', itemB),
  ]);

  assert.equal(graph.nodes.length, 3);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, 3);
});

test('removes a module from the graph after it is removed from the build', () => {
  const module = createItem('removable');
  const weapon = createWeapon([createSlot('Module', ['removable'])]);
  const withModule = buildWeaponDiagramGraph(weapon, [install('Module', module)]);
  const withoutModule = buildWeaponDiagramGraph(weapon, []);

  assert.equal(withModule.nodes.some(node => node.itemId === 'removable'), true);
  assert.equal(withoutModule.nodes.some(node => node.itemId === 'removable'), false);
});

function semanticNode(id, category, parentId = 'weapon', slotName = category) {
  return {
    id,
    itemId: id,
    parentId,
    nodeType: id === 'weapon' ? 'weapon' : 'module',
    category,
    slotName,
    slotId: slotName,
  };
}

function semanticGraph() {
  const nodes = [
    semanticNode('weapon', 'Assault rifle', null),
    semanticNode('receiver', 'Receiver'),
    semanticNode('barrel', 'Barrel', 'receiver'),
    semanticNode('muzzle', 'Muzzle device', 'barrel'),
    semanticNode('gas', 'Gas block', 'barrel'),
    semanticNode('handguard', 'Handguard', 'receiver'),
    semanticNode('buffer', 'Buffer tube'),
    semanticNode('stock', 'Stock', 'buffer'),
    semanticNode('optic', 'Scope', 'receiver'),
    semanticNode('magazine', 'Magazine', 'receiver'),
    semanticNode('foregrip', 'Foregrip', 'handguard'),
    semanticNode('flashlight', 'Tactical device', 'handguard'),
  ];
  return {
    nodes,
    edges: nodes.slice(1).map(node => ({
      id: `${node.parentId}-${node.id}`,
      source: node.parentId,
      target: node.id,
    })),
  };
}

function assertNoNodeOverlaps(nodes) {
  nodes.forEach((first, firstIndex) => {
    nodes.slice(firstIndex + 1).forEach(second => {
      const separated = first.position.x + first.width <= second.position.x
        || second.position.x + second.width <= first.position.x
        || first.position.y + first.height <= second.position.y
        || second.position.y + second.height <= first.position.y;
      assert.equal(separated, true, `${first.id} overlaps ${second.id}`);
    });
  });
}

test('classifies structural, upper, and lower modules from slot/category semantics', () => {
  assert.equal(classifyWeaponDiagramNode(semanticNode('barrel', 'Barrel')).backbone, 'front');
  assert.equal(classifyWeaponDiagramNode(semanticNode('receiver', 'Receiver')).backbone, 'center');
  assert.equal(classifyWeaponDiagramNode(semanticNode('stock', 'Stock')).backbone, 'rear');
  assert.equal(classifyWeaponDiagramNode(semanticNode('optic', 'Scope')).direction, 'top');
  assert.equal(classifyWeaponDiagramNode(semanticNode('magazine', 'Magazine')).direction, 'bottom');
});

test('uses stable category keys when localized category and slot names do not contain English semantics', () => {
  const barrel = {
    ...semanticNode('barrel', 'Ствол', 'weapon', 'Ствольный слот'),
    categoryKeys: ['barrel'],
    slotId: 'mod barrel',
  };
  const sight = {
    ...semanticNode('sight', 'Прицелы', 'weapon', 'Оптический слот'),
    categoryKeys: ['sights', 'scope'],
    slotId: 'mod scope',
  };

  assert.equal(classifyWeaponDiagramNode(barrel).backbone, 'front');
  assert.equal(classifyWeaponDiagramNode(sight).direction, 'top');
});

test('normalizes stable API slot identifiers for localized diagram layout', () => {
  const localizedNode = slotId => ({
    ...semanticNode('localized', 'Модуль', 'weapon', 'Локализованный слот'),
    slotId,
  });

  assert.equal(classifyWeaponDiagramNode(localizedNode('mod_gas_block')).backbone, 'front');
  assert.equal(classifyWeaponDiagramNode(localizedNode('mod_reciever')).backbone, 'center');
  assert.equal(classifyWeaponDiagramNode(localizedNode('mod_pistol_grip')).direction, 'bottom');
});

test('lays the weapon backbone horizontally from muzzle to stock around the centered weapon', () => {
  const layout = layoutWeaponDiagramGraph(semanticGraph());
  const byId = new Map(layout.nodes.map(node => [node.id, node]));
  const backboneIds = ['muzzle', 'barrel', 'gas', 'handguard', 'receiver', 'weapon', 'buffer', 'stock'];
  const backbone = backboneIds.map(id => byId.get(id));

  assert.equal(new Set(backbone.map(node => node.position.y)).size, 1);
  backbone.slice(1).forEach((node, index) => {
    assert.ok(backbone[index].position.x < node.position.x);
  });
  assert.equal(byId.get('receiver').layoutZone, 'backbone-center');
  assert.equal(byId.get('muzzle').layoutZone, 'backbone-front');
  assert.equal(byId.get('stock').layoutZone, 'backbone-rear');
  assert.equal(byId.get('weapon').position.x + byId.get('weapon').width / 2, layout.width / 2);
});

test('keeps parent-to-child order for consecutive rear modules with the same category', () => {
  const graph = {
    nodes: [
      semanticNode('weapon', 'Submachine gun', null),
      semanticNode('rear-adapter', 'Stock'),
      semanticNode('buttstock', 'Stock', 'rear-adapter'),
    ],
    edges: [
      { id: 'weapon-rear-adapter', source: 'weapon', target: 'rear-adapter' },
      { id: 'rear-adapter-buttstock', source: 'rear-adapter', target: 'buttstock' },
    ],
  };
  const layout = layoutWeaponDiagramGraph(graph);
  const byId = new Map(layout.nodes.map(node => [node.id, node]));

  assert.ok(byId.get('weapon').position.x < byId.get('rear-adapter').position.x);
  assert.ok(byId.get('rear-adapter').position.x < byId.get('buttstock').position.x);
});

test('places optics above and magazines, grips, and tactical branches below their anchors', () => {
  const layout = layoutWeaponDiagramGraph(semanticGraph());
  const byId = new Map(layout.nodes.map(node => [node.id, node]));

  assert.ok(byId.get('optic').position.y < byId.get('receiver').position.y);
  assert.ok(byId.get('magazine').position.y > byId.get('receiver').position.y);
  assert.ok(byId.get('foregrip').position.y > byId.get('handguard').position.y);
  assert.ok(byId.get('flashlight').position.y > byId.get('handguard').position.y);
  assert.equal(byId.get('optic').layoutZone, 'top');
  assert.equal(byId.get('foregrip').layoutZone, 'front-bottom');
  assertNoNodeOverlaps(layout.nodes);
});

test('uses a mounted subtree to choose whether an ambiguous rail belongs above or below', () => {
  const graph = semanticGraph();
  graph.nodes.push(
    semanticNode('lower-mount', 'Mount', 'handguard'),
    semanticNode('mounted-grip', 'Foregrip', 'lower-mount'),
  );
  graph.edges.push(
    { id: 'handguard-lower-mount', source: 'handguard', target: 'lower-mount' },
    { id: 'lower-mount-mounted-grip', source: 'lower-mount', target: 'mounted-grip' },
  );
  const layout = layoutWeaponDiagramGraph(graph);
  const byId = new Map(layout.nodes.map(node => [node.id, node]));

  assert.ok(byId.get('lower-mount').position.y > byId.get('handguard').position.y);
  assert.ok(byId.get('mounted-grip').position.y > byId.get('lower-mount').position.y);
  assert.equal(byId.get('lower-mount').layoutZone, 'front-bottom');
  assertNoNodeOverlaps(layout.nodes);
});

test('creates short orthogonal routes for vertical branches and the horizontal backbone', () => {
  const layout = layoutWeaponDiagramGraph(semanticGraph());
  const byId = new Map(layout.nodes.map(node => [node.id, node]));
  const verticalPath = getOrthogonalEdgePath(byId.get('receiver'), byId.get('optic'));
  const horizontalPath = getOrthogonalEdgePath(byId.get('buffer'), byId.get('stock'));

  assert.match(verticalPath, /^M .* V .* H .* V /);
  assert.match(horizontalPath, /^M .* H /);
  assert.ok(layout.width > 0);
  assert.ok(layout.height > 0);
});

test('layout cycle protection returns finite positions for cyclic edges', () => {
  const graph = {
    nodes: [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ],
    edges: [
      { id: 'one', source: 'root', target: 'child' },
      { id: 'two', source: 'child', target: 'root' },
    ],
  };
  const layout = layoutWeaponDiagramGraph(graph);

  assert.equal(layout.nodes.length, 2);
  layout.nodes.forEach(node => {
    assert.equal(Number.isFinite(node.position.x), true);
    assert.equal(Number.isFinite(node.position.y), true);
  });
});
