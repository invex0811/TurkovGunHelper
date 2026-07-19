import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeaponDiagramGraph,
  getOrthogonalEdgePath,
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

test('lays out nodes without overlap and creates orthogonal edge paths', () => {
  const childA = createItem('child-a');
  const childB = createItem('child-b');
  const weapon = createWeapon([
    createSlot('A', ['child-a']),
    createSlot('B', ['child-b']),
  ]);
  const graph = buildWeaponDiagramGraph(weapon, [
    install('A', childA),
    install('B', childB),
  ]);
  const layout = layoutWeaponDiagramGraph(graph);
  const [firstChild, secondChild] = layout.nodes.slice(1);
  const path = getOrthogonalEdgePath(layout.nodes[0], firstChild);

  assert.ok(firstChild.position.y + firstChild.height <= secondChild.position.y);
  assert.match(path, /^M .* H .* V .* H /);
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
