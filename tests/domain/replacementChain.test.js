import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import {
  CHAIN_NODE_ORIGINS,
  CHAIN_PROFILES,
  collectChainNodes,
  createReplacementChainPlanner,
  slotSupportsChains,
} from '../../src/domain/replacementChain.js';
import { findBuildSlotContext } from '../../src/domain/weaponBuildEditor.js';
import { buildWeaponAssemblyTree } from '../../src/domain/weaponAssembly.js';

function createSlot(name, nameId, allowedIds, required = false) {
  return {
    name,
    nameId,
    required,
    filters: { allowedItems: allowedIds.map(id => ({ id })) },
  };
}

function createItem(id, options = {}) {
  return {
    id,
    name: options.name || id,
    shortName: options.shortName || id,
    weight: options.weight || 0,
    ergonomicsModifier: options.ergonomicsModifier || 0,
    recoilModifier: options.recoilModifier || 0,
    conflictingItems: (options.conflicts || []).map(conflictId => ({ id: conflictId })),
    avg24hPrice: options.price || 1000,
    properties: { slots: options.slots || [] },
    categories: [{ name: options.category || 'Weapon mod' }],
  };
}

const gripA = createItem('grip-a', { ergonomicsModifier: 5 });
const gripB = createItem('grip-b', { ergonomicsModifier: 8 });
const gripC = createItem('grip-c', { ergonomicsModifier: 3 });
const mount = createItem('mount', {
  ergonomicsModifier: -1,
  category: 'Mount',
  slots: [createSlot('Mount grip', 'mod_foregrip', ['grip-c'])],
});
const handguardCurrent = createItem('hg-current', {
  slots: [createSlot('Foregrip', 'mod_foregrip', ['grip-a', 'grip-b'])],
});
const handguardKeeps = createItem('hg-keeps', {
  ergonomicsModifier: 2,
  slots: [
    createSlot('Foregrip', 'mod_foregrip', ['grip-a', 'grip-b']),
    createSlot('Mount', 'mod_mount', ['mount']),
  ],
});
const handguardDrops = createItem('hg-drops', {
  slots: [createSlot('Rail', 'mod_foregrip', ['grip-b'], true)],
});
const handguardGripA = createItem('hg-grip-a', {
  slots: [createSlot('Foregrip', 'mod_foregrip', ['grip-a', 'grip-c'])],
});
// A rail that helps ergonomics but has nothing it could carry.
const emptyRail = createItem('empty-rail', {
  ergonomicsModifier: 2,
  category: 'Mount',
  slots: [createSlot('Rail grip', 'mod_foregrip', ['missing-grip'])],
});
const handguardRail = createItem('hg-rail', {
  ergonomicsModifier: 1,
  slots: [createSlot('Rail', 'mod_mount', ['empty-rail'])],
});
const handguardConflicting = createItem('hg-conflict', { conflicts: ['stock'] });
const stock = createItem('stock');
const weaponSlots = [
  createSlot('Handguard', 'mod_handguard', ['hg-current', 'hg-keeps', 'hg-drops', 'hg-grip-a', 'hg-rail', 'hg-conflict'], true),
  createSlot('Stock', 'mod_stock', ['stock']),
];
const weapon = {
  ...createItem('weapon', { slots: weaponSlots, price: 10000, weight: 2 }),
  properties: {
    slots: weaponSlots,
    ergonomics: 50,
    recoilVertical: 100,
    recoilHorizontal: 200,
  },
};
const allMods = Object.fromEntries([
  gripA, gripB, gripC, mount, emptyRail, handguardCurrent, handguardKeeps, handguardDrops, handguardGripA,
  handguardRail, handguardConflicting, stock,
].map(item => [item.id, item]));
const buildParts = [
  { slotName: 'Handguard', item: handguardCurrent },
  { slotName: 'Foregrip', item: gripA },
  { slotName: 'Stock', item: stock },
];

function createPlanner(goal = { mode: 'meta' }) {
  const tree = buildWeaponAssemblyTree(weapon, buildParts);
  const handguardNode = tree.children.find(child => child.item.id === 'hg-current');
  return createReplacementChainPlanner({
    weapon,
    buildParts,
    allMods,
    slotInstanceId: handguardNode.sourceSlotInstanceId,
    goal,
    options: { includeTraderPrices: true, sightMode: 'none', requireSight: false },
  });
}

function describeChain(chain) {
  return collectChainNodes(chain).map(node => `${node.slot.name}:${node.item.id}:${node.origin}`);
}

test('root candidates skip the installed module and modules that conflict with the rest of the build', () => {
  const planner = createPlanner();
  assert.deepEqual(
    planner.getRootCandidates().map(item => item.id).sort(),
    ['hg-drops', 'hg-grip-a', 'hg-keeps', 'hg-rail'],
  );
});

test('an old attachment gives way when the build goal finds a better module', () => {
  const planner = createPlanner();
  const chain = planner.buildChain(handguardKeeps);

  assert.deepEqual(describeChain(chain), [
    'Handguard:hg-keeps:root',
    'Foregrip:grip-b:auto',
    'Mount:mount:auto',
    'Mount grip:grip-c:auto',
  ]);

  const plan = planner.planChain(chain);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.removedItems.map(item => item.id).sort(), ['grip-a', 'hg-current']);
  assert.deepEqual(plan.currentItems.map(item => item.id), ['hg-current', 'grip-a']);
  const rebuilt = buildWeaponAssemblyTree(weapon, plan.buildParts);
  assert.equal(rebuilt.unattachedParts.length, 0);
  assert.deepEqual(plan.buildParts.map(part => part.item.id), ['hg-keeps', 'grip-b', 'mount', 'grip-c', 'stock']);
});

test('an old attachment stays when nothing better fits', () => {
  const planner = createPlanner();
  assert.deepEqual(describeChain(planner.buildChain(handguardGripA)), [
    'Handguard:hg-grip-a:root',
    'Foregrip:grip-a:kept',
  ]);
});

test('automatically added mounts that carry nothing are left out', () => {
  const planner = createPlanner();
  assert.deepEqual(describeChain(planner.buildChain(handguardRail)), ['Handguard:hg-rail:root']);
});

test('each module is offered per profile and identical chains are merged', () => {
  const planner = createPlanner();
  const seed = planner.getChainSeeds().find(candidate => candidate.rootItem.id === 'hg-keeps');
  const plans = planner.planSeed(seed);

  assert.deepEqual(plans.map(plan => [plan.profiles, plan.chainItems.map(item => item.id)]), [
    [[CHAIN_PROFILES.GOAL, CHAIN_PROFILES.ERGONOMICS], ['hg-keeps', 'grip-b', 'mount', 'grip-c']],
    [[CHAIN_PROFILES.CHEAP], ['hg-keeps']],
    [[CHAIN_PROFILES.RECOIL], ['hg-keeps', 'grip-a']],
  ]);
});

test('incompatible attachments are dropped and required slots of the new module are filled', () => {
  const planner = createPlanner();
  const chain = planner.buildChain(handguardDrops);

  assert.deepEqual(describeChain(chain), ['Handguard:hg-drops:root', 'Rail:grip-b:auto']);
  const plan = planner.planChain(chain);
  assert.deepEqual(plan.missingRequiredSlots, []);
  assert.deepEqual(plan.removedItems.map(item => item.id).sort(), ['grip-a', 'hg-current']);
});

test('changing a slot inside a chain marks it as chosen and re-plans only that branch', () => {
  const planner = createPlanner();
  const chain = planner.buildChain(handguardKeeps);
  const foregripIndex = 0;

  const options = planner.getSlotOptions(chain, [], foregripIndex).map(item => item.id).sort();
  assert.deepEqual(options, ['grip-a', 'grip-b']);

  const edited = planner.setSlotItem(chain, [], foregripIndex, gripA);
  assert.deepEqual(describeChain(edited), [
    'Handguard:hg-keeps:root',
    'Foregrip:grip-a:manual',
    'Mount:mount:auto',
    'Mount grip:grip-c:auto',
  ]);
  assert.equal(chain.children[0].item.id, 'grip-b', 'the original chain is not mutated');

  const cleared = planner.setSlotItem(edited, [], 1, null);
  assert.deepEqual(describeChain(cleared), ['Handguard:hg-keeps:root', 'Foregrip:grip-a:manual']);
});

test('chains are ranked by the active build goal', () => {
  const planner = createPlanner();
  const plans = planner.getRootCandidates().map(item => planner.planChain(planner.buildChain(item)));
  const ranked = planner.rankPlans(plans);
  assert.deepEqual(ranked.map(plan => plan.chain.item.id), ['hg-keeps', 'hg-drops', 'hg-grip-a', 'hg-rail']);
});

test('constraint and priority goals build complete chains as well', () => {
  for (const goal of [
    { mode: 'constraints', customLimits: { ergonomics: 90, verticalRecoil: 100, horizontalRecoil: 200, weight: 0 } },
    { mode: 'priorities', priorityAttributes: ['ergonomics'] },
  ]) {
    const planner = createPlanner(goal);
    const chain = planner.buildChain(handguardGripA);
    assert.deepEqual(planner.planChain(chain).errors, [], goal.mode);
    assert.ok(collectChainNodes(chain).some(node => node.origin === CHAIN_NODE_ORIGINS.KEPT), goal.mode);
    assert.equal(planner.rankPlans([planner.planChain(chain)]).length, 1, goal.mode);
  }
});

test('chains are offered only where modules can be attached below the slot', () => {
  const { root } = findBuildSlotContext(weapon, buildParts, null);
  const handguardSlot = root.slots[0];
  const stockSlot = root.slots[1];
  assert.equal(slotSupportsChains(handguardSlot, allMods), true);
  assert.equal(slotSupportsChains(stockSlot, allMods), false);
});

test('every chain of a generated M4A1 build is a valid, complete build', () => {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
  const fixtureWeapon = read('weapon.json').data.item;
  const modMap = Object.fromEntries(read('mods.json').data.items.map(item => [item.id, item]));
  const options = { includeTraderPrices: true, sightMode: 'any', requireSight: true, magazineCapacity: 30 };
  const result = calculateBestBuild(fixtureWeapon, 'meta', 0, 0, modMap, options);
  const tree = buildWeaponAssemblyTree(fixtureWeapon, result.build);

  let checkedChains = 0;
  const checkedBySlot = new Map();
  collectChainNodes(tree).slice(1).forEach(node => {
    const planner = createReplacementChainPlanner({
      weapon: fixtureWeapon,
      buildParts: result.build,
      allMods: modMap,
      slotInstanceId: node.sourceSlotInstanceId,
      goal: { mode: 'meta' },
      options,
    });
    planner.getChainSeeds().forEach(seed => {
      const plan = planner.planChain(planner.buildChainFromSeed(seed));
      const label = `${node.item.shortName} -> ${plan.focusItem.shortName}`;
      assert.deepEqual(plan.errors, [], label);
      assert.deepEqual(plan.missingRequiredSlots, [], label);
      assert.equal(buildWeaponAssemblyTree(fixtureWeapon, plan.buildParts).unattachedParts.length, 0);
      checkedChains += 1;
      checkedBySlot.set(node.slotName, (checkedBySlot.get(node.slotName) || 0) + 1);
    });
  });
  assert.ok(checkedChains > 50);
  assert.ok(checkedBySlot.get('Handguard') > 0, 'a handguard carrying a sight still offers handguard chains');
  assert.ok(checkedBySlot.get('Receiver') > 0, 'a receiver carrying a sight still offers receiver chains');
});

test('a sight assembly offers one chain per sight, reached from any of its parts', () => {
  const sightOptions = { includeTraderPrices: true, sightMode: 'any', requireSight: true };
  const reflexA = { ...createItem('reflex-a'), categories: [{ name: 'Sights' }, { name: 'Reflex sight' }] };
  const reflexB = { ...createItem('reflex-b'), categories: [{ name: 'Sights' }, { name: 'Reflex sight' }] };
  const ironSight = { ...createItem('iron'), categories: [{ name: 'Sights' }, { name: 'Ironsight' }] };
  const riser = { ...createItem('riser', {
    weight: 0.2,
    slots: [createSlot('Scope', 'mod_scope', ['reflex-a', 'reflex-b', 'iron'])],
  }), categories: [{ name: 'Mount' }] };
  const lowRiser = { ...createItem('low-riser', {
    weight: 0.1,
    slots: [createSlot('Scope', 'mod_scope', ['reflex-b'])],
  }), categories: [{ name: 'Mount' }] };
  const sightSlots = [createSlot('Scope', 'mod_scope', ['riser', 'low-riser'])];
  const sightWeapon = {
    ...createItem('sight-weapon', { slots: sightSlots }),
    properties: { slots: sightSlots, ergonomics: 50, recoilVertical: 100, recoilHorizontal: 200 },
  };
  const mods = Object.fromEntries([reflexA, reflexB, ironSight, riser, lowRiser].map(item => [item.id, item]));
  const parts = [{ slotName: 'Scope', item: riser }, { slotName: 'Scope', item: reflexA }];
  const tree = buildWeaponAssemblyTree(sightWeapon, parts);
  const sightNode = tree.children[0].children[0];

  const planner = createReplacementChainPlanner({
    weapon: sightWeapon,
    buildParts: parts,
    allMods: mods,
    slotInstanceId: sightNode.sourceSlotInstanceId,
    goal: { mode: 'meta' },
    options: sightOptions,
  });

  assert.equal(planner.isSightAssembly, true);
  assert.equal(planner.currentNode.item.id, 'riser', 'the chain targets the top mount');
  const plans = planner.getChainSeeds().map(seed => planner.planChain(planner.buildChainFromSeed(seed)));
  assert.deepEqual(plans.map(plan => [plan.focusItem.id, plan.chainItems.map(item => item.id)]), [
    ['reflex-b', ['low-riser', 'reflex-b']],
  ], 'the current sight and iron sights are skipped, the lighter mount wins');
  assert.deepEqual(plans[0].removedItems.map(item => item.id).sort(), ['reflex-a', 'riser']);
});
