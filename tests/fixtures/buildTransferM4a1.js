function createSlot(nameId, name, allowedItems, required = false) {
  return {
    nameId,
    name,
    required,
    filters: { allowedItems: allowedItems.map(id => ({ id })) },
  };
}

function createItem(id, name, slots = [], overrides = {}) {
  return {
    id,
    name,
    shortName: name,
    types: ['mods'],
    conflictingItems: [],
    properties: { slots },
    ergonomicsModifier: 0,
    recoilModifier: 0,
    weight: 0.1,
    ...overrides,
  };
}

export function createM4a1TransferFixture(suffix = '') {
  const ids = Object.fromEntries([
    'weapon', 'receiver', 'barrel', 'gasBlock', 'muzzle', 'handguard',
    'foregrip', 'chargingHandle', 'scope', 'stock',
  ].map(key => [key, `${key}${suffix}`]));

  const gasBlock = createItem(ids.gasBlock, 'Gas Block');
  const muzzle = createItem(ids.muzzle, 'Muzzle');
  const foregrip = createItem(ids.foregrip, 'Foregrip');
  const chargingHandle = createItem(ids.chargingHandle, 'Charging Handle');
  const scope = createItem(ids.scope, 'Scope');
  const stock = createItem(ids.stock, 'Stock');
  const barrel = createItem(ids.barrel, 'Barrel', [
    createSlot('mod_gas_block', 'Gas Block', [ids.gasBlock], true),
    createSlot('mod_muzzle', 'Muzzle', [ids.muzzle]),
  ]);
  const handguard = createItem(ids.handguard, 'Handguard', [
    createSlot('mod_foregrip', 'Foregrip', [ids.foregrip]),
    createSlot('mod_scope', 'Scope', [ids.scope]),
  ]);
  const receiver = createItem(ids.receiver, 'MUR-1S', [
    createSlot('mod_barrel', 'Barrel', [ids.barrel], true),
    createSlot('mod_handguard', 'Handguard', [ids.handguard], true),
    createSlot('mod_charge', 'Ch. Handle', [ids.chargingHandle]),
    createSlot('mod_scope', 'Scope', [ids.scope]),
    createSlot('mod_scope', 'Scope', [ids.scope]),
  ]);
  const weapon = createItem(ids.weapon, 'M4A1', [
    createSlot('mod_reciever', 'Upper Receiver', [ids.receiver], true),
    createSlot('mod_stock', 'Stock', [ids.stock]),
  ], {
    types: ['gun'],
    properties: {
      slots: [
        createSlot('mod_reciever', 'Upper Receiver', [ids.receiver], true),
        createSlot('mod_stock', 'Stock', [ids.stock]),
      ],
      ergonomics: 45,
      recoilVertical: 80,
      recoilHorizontal: 210,
    },
    weight: 2.8,
  });
  const items = [weapon, receiver, barrel, gasBlock, muzzle, handguard, foregrip, chargingHandle, scope, stock];
  const itemsById = Object.fromEntries(items.map(item => [item.id, item]));
  const modsById = Object.fromEntries(items.filter(item => !item.types.includes('gun')).map(item => [item.id, item]));
  const flatOrder = [receiver, barrel, gasBlock, muzzle, handguard, foregrip, chargingHandle, scope, stock];
  const slotNames = ['Upper Receiver', 'Barrel', 'Gas Block', 'Muzzle', 'Handguard', 'Foregrip', 'Ch. Handle', 'Scope', 'Stock'];

  return {
    ids,
    weapon,
    itemsById,
    modsById,
    weapons: [weapon],
    savedBuild: {
      id: `m4-build${suffix}`,
      version: 1,
      name: 'M4A1 MUR-1S regression',
      weapon: { id: weapon.id, name: weapon.name, shortName: weapon.shortName, imageUrl: '' },
      parts: flatOrder.map((item, index) => ({
        itemId: item.id,
        itemName: item.shortName,
        slotName: slotNames[index],
      })),
      stats: { ergonomics: 45, recoilVertical: 80, recoilHorizontal: 210, weight: 3.7, price: 0 },
      settings: { targetType: 'meta', priceMode: suffix === '-pve' ? 'pve' : 'pvp' },
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
    },
  };
}
