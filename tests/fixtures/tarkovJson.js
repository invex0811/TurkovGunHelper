export function createTarkovJsonFixture(language = 'en') {
  const names = language === 'ru'
    ? {
      weapon: 'Тестовое оружие', weaponShort: 'ТО', mod: 'Тестовый модуль',
      modShort: 'ТМ', preset: 'Тестовый пресет', slot: 'Пистолетная рукоятка',
      weaponCategory: 'Оружие', modCategory: 'Пистолетная рукоятка', trader: 'Прапор',
    }
    : {
      weapon: 'Test weapon', weaponShort: 'TW', mod: 'Test mod', modShort: 'TM',
      preset: 'Test preset', slot: 'Pistol Grip', weaponCategory: 'Weapon',
      modCategory: 'Pistol grip', trader: 'Prapor',
    };

  const items = {
    data: {
      items: {
        'weapon-1': {
          id: 'weapon-1',
          name: 'weapon-1 Name',
          shortName: 'weapon-1 ShortName',
          normalizedName: 'test-weapon',
          link: 'https://tarkov.dev/item/test-weapon',
          image512pxLink: 'https://assets.test/weapon-512.webp',
          iconLink: 'https://assets.test/weapon-icon.webp',
          gridImageLink: 'https://assets.test/weapon-grid.webp',
          types: ['gun'],
          categories: ['weapon-category'],
          weight: 3,
          basePrice: 1000,
          avg24hPrice: 1200,
          lastLowPrice: 1100,
          low24hPrice: 900,
          high24hPrice: 1400,
          lastOfferCount: 12,
          updated: '2026-07-21T00:00:00.000Z',
          conflictingItems: ['conflict-1'],
          buyFromTrader: [{
            trader: 'trader-1', price: 950, priceRUB: 950, currency: 'RUB',
            minTraderLevel: 2, buyLimit: 3, taskUnlock: 'task-1',
          }],
          properties: {
            ergonomics: 50,
            recoilVertical: 100,
            recoilHorizontal: 200,
            defaultPreset: 'preset-1',
            slots: [{
              id: 'slot-1', name: 'SLOT_PISTOL_GRIP', nameId: 'mod_pistol_grip',
              required: true,
              filters: { allowedItems: ['mod-1'], excludedItems: [] },
            }],
          },
        },
        'mod-1': {
          id: 'mod-1', name: 'mod-1 Name', shortName: 'mod-1 ShortName',
          normalizedName: 'test-mod', types: ['mods'], categories: ['mod-category'],
          image512pxLink: 'https://assets.test/mod-512.webp',
          weight: 0.2, basePrice: 90, avg24hPrice: 100, lastLowPrice: 95,
          low24hPrice: 80, high24hPrice: 130, lastOfferCount: 4,
          ergonomicsModifier: 4, recoilModifier: -3, accuracyModifier: 2,
          conflictingItems: ['conflict-2'],
          buyFromTrader: [{
            trader: 'trader-1', price: 80, priceRUB: 80, currency: 'RUB',
            minTraderLevel: 1, taskUnlock: null,
          }],
          properties: {
            slots: [{
              id: 'nested-slot-1', name: 'SLOT_NESTED', nameId: 'mod_mount',
              required: false,
              filters: { allowedItems: ['other-1'], excludedItems: [] },
            }],
          },
        },
        'preset-1': {
          id: 'preset-1', name: 'preset-1 Name', shortName: 'PRESET', types: [],
          image512pxLink: 'https://assets.test/preset-512.webp',
          iconLink: 'https://assets.test/preset-icon.webp',
          gridImageLink: 'https://assets.test/preset-grid.webp',
          categories: [], properties: {}, conflictingItems: [], buyFromTrader: [],
        },
        'required-1': {
          id: 'required-1', name: 'required-1 Name', shortName: 'REQ', types: [],
          categories: [], avg24hPrice: 10, properties: {}, conflictingItems: [],
          buyFromTrader: [],
        },
        'other-1': {
          id: 'other-1', name: 'other-1 Name', shortName: 'OTHER', types: ['ammo'],
          categories: [], properties: {}, conflictingItems: [], buyFromTrader: [],
        },
      },
      itemCategories: {
        'weapon-category': {
          id: 'weapon-category', name: 'weapon-category Name', normalizedName: 'weapon',
        },
        'mod-category': {
          id: 'mod-category', name: 'mod-category Name', normalizedName: 'pistol-grip',
        },
      },
      handbookCategories: {},
    },
    translations: [
      '$.data.items.*.name',
      '$.data.items.*.shortName',
      '$.data.items.*.properties.slots[*].name',
      '$.data.itemCategories.*.name',
    ],
  };

  const itemTranslations = {
    data: {
      'weapon-1 Name': names.weapon,
      'weapon-1 ShortName': names.weaponShort,
      'mod-1 Name': names.mod,
      'mod-1 ShortName': names.modShort,
      'preset-1 Name': names.preset,
      SLOT_PISTOL_GRIP: names.slot,
      SLOT_NESTED: 'Mount',
      'weapon-category Name': names.weaponCategory,
      'mod-category Name': names.modCategory,
    },
  };

  const barters = {
    data: [{
      id: 'barter-1', trader: 'trader-1', minTraderLevel: 2, buyLimit: 1,
      taskUnlock: 'task-2',
      requiredItems: [{ item: 'required-1', count: 2, attributes: {} }],
      offeredItem: { item: 'mod-1', count: 1, attributes: {} },
    }],
    translations: [],
  };

  const traders = {
    data: {
      'trader-1': {
        id: 'trader-1', name: 'trader-1 Nickname', normalizedName: 'prapor',
      },
    },
    translations: ['$.data.*.name'],
  };
  const traderTranslations = { data: { 'trader-1 Nickname': names.trader } };

  return { items, itemTranslations, barters, traders, traderTranslations };
}
