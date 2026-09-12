import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_GOAL_MODES,
  DEFAULT_BUILD_GOAL_MODE,
  DEFAULT_INCLUDE_TRADER_PRICES,
  DEFAULT_REMEMBER_TACTICAL_DEVICE_SELECTION,
  DEFAULT_STRICT_TRADER_LEVELS,
  loadBuildGoalModePreference,
  loadIncludeTraderPricesPreference,
  loadLastSelectedFlashlightId,
  loadLastSelectedTblId,
  loadPriceModePreference,
  loadRememberTacticalDeviceSelectionPreference,
  loadStrictTraderLevelsPreference,
  loadTargetTypePreference,
  normalizeBuildGoalMode,
  normalizeTargetType,
  saveBuildGoalModePreference,
  saveIncludeTraderPricesPreference,
  saveLastSelectedFlashlightId,
  saveLastSelectedTblId,
  savePriceModePreference,
  saveRememberTacticalDeviceSelectionPreference,
  saveStrictTraderLevelsPreference,
  saveTargetTypePreference,
} from '../../src/data/settings/buildPreferences.js';
import {
  DEFAULT_LANGUAGE,
  loadLanguagePreference,
  saveLanguagePreference,
} from '../../src/i18n/language.js';

function withWindow(localStorage, run) {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage };

  try {
    return run();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('trader prices are enabled by default', () => {
  assert.equal(DEFAULT_INCLUDE_TRADER_PRICES, true);
  assert.equal(loadIncludeTraderPricesPreference(), true);
});

test('price mode defaults safely and persists both supported modes', () => {
  const storage = createStorage();
  withWindow(storage, () => {
    assert.equal(loadPriceModePreference(), 'pvp');
    storage.setItem('tarkovGunHelper.priceMode', 'invalid');
    assert.equal(loadPriceModePreference(), 'pvp');
    savePriceModePreference('pve');
    assert.equal(loadPriceModePreference(), 'pve');
    savePriceModePreference('pvp');
    assert.equal(loadPriceModePreference(), 'pvp');
    savePriceModePreference('invalid');
    assert.equal(loadPriceModePreference(), 'pvp');
  });
});

test('build goal mode defaults to Meta and persists every supported UI mode', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    assert.equal(DEFAULT_BUILD_GOAL_MODE, BUILD_GOAL_MODES.META);
    assert.equal(loadBuildGoalModePreference(), BUILD_GOAL_MODES.META);

    for (const mode of Object.values(BUILD_GOAL_MODES)) {
      saveBuildGoalModePreference(mode);
      assert.equal(loadBuildGoalModePreference(), mode);
    }

    saveBuildGoalModePreference('invalid');
    assert.equal(loadBuildGoalModePreference(), BUILD_GOAL_MODES.PRIORITIES);
  });
});

test('build goal mode preference handles invalid and legacy targetType values safely', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    storage.setItem('tarkovGunHelper.buildGoalMode', 'invalid');
    storage.setItem('tarkovGunHelper.targetType', 'meta');
    assert.equal(loadBuildGoalModePreference(), BUILD_GOAL_MODES.META);

    storage.setItem('tarkovGunHelper.targetType', 'custom');
    assert.equal(loadBuildGoalModePreference(), BUILD_GOAL_MODES.CONSTRAINTS);

    storage.setItem('tarkovGunHelper.buildGoalMode', 'priorities');
    assert.equal(loadBuildGoalModePreference(), BUILD_GOAL_MODES.PRIORITIES);
  });

  assert.equal(normalizeBuildGoalMode('invalid'), DEFAULT_BUILD_GOAL_MODE);
});

test('build goal mode preference safely handles unavailable storage', () => {
  const localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };

  withWindow(localStorage, () => {
    assert.equal(loadBuildGoalModePreference(), DEFAULT_BUILD_GOAL_MODE);
    assert.doesNotThrow(() => saveBuildGoalModePreference(BUILD_GOAL_MODES.PRIORITIES));
  });
});

test('includeTraderPrices preference persists a safe serialized boolean', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    saveIncludeTraderPricesPreference(false);
    assert.equal(loadIncludeTraderPricesPreference(), false);

    saveIncludeTraderPricesPreference(true);
    assert.equal(loadIncludeTraderPricesPreference(), true);
  });
});

test('tactical device preferences preserve manual selections and an explicit none choice', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    assert.equal(loadLastSelectedFlashlightId(), undefined);
    assert.equal(loadLastSelectedTblId(), undefined);

    saveLastSelectedFlashlightId('flashlight-id');
    saveLastSelectedTblId('tbl-id');
    assert.equal(loadLastSelectedFlashlightId(), 'flashlight-id');
    assert.equal(loadLastSelectedTblId(), 'tbl-id');

    saveLastSelectedFlashlightId(null);
    saveLastSelectedTblId(null);
    assert.equal(loadLastSelectedFlashlightId(), null);
    assert.equal(loadLastSelectedTblId(), null);
  });
});

test('remember tactical device selection is disabled by default and persists a boolean choice', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    assert.equal(DEFAULT_REMEMBER_TACTICAL_DEVICE_SELECTION, false);
    assert.equal(loadRememberTacticalDeviceSelectionPreference(), false);

    saveRememberTacticalDeviceSelectionPreference(true);
    assert.equal(loadRememberTacticalDeviceSelectionPreference(), true);

    saveRememberTacticalDeviceSelectionPreference(false);
    assert.equal(loadRememberTacticalDeviceSelectionPreference(), false);

    storage.setItem('tarkovGunHelper.rememberTacticalDeviceSelection', 'invalid');
    assert.equal(loadRememberTacticalDeviceSelectionPreference(), false);
  });
});

test('includeTraderPrices preference safely handles unavailable storage', () => {
  const localStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  withWindow(localStorage, () => {
    assert.equal(loadIncludeTraderPricesPreference(), true);
    assert.doesNotThrow(() => saveIncludeTraderPricesPreference(false));
  });
});

test('strictTraderLevels defaults to false and persists only booleans', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    assert.equal(DEFAULT_STRICT_TRADER_LEVELS, false);
    assert.equal(loadStrictTraderLevelsPreference(), false);

    saveStrictTraderLevelsPreference(true);
    assert.equal(loadStrictTraderLevelsPreference(), true);

    saveStrictTraderLevelsPreference(false);
    assert.equal(loadStrictTraderLevelsPreference(), false);

    saveStrictTraderLevelsPreference('true');
    assert.equal(loadStrictTraderLevelsPreference(), false);

    storage.setItem('tarkovGunHelper.strictTraderLevels', 'invalid');
    assert.equal(loadStrictTraderLevelsPreference(), false);
  });
});

test('strictTraderLevels preference safely handles unavailable storage', () => {
  const localStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  withWindow(localStorage, () => {
    assert.equal(loadStrictTraderLevelsPreference(), false);
    assert.doesNotThrow(() => saveStrictTraderLevelsPreference(true));
  });
});

test('only Meta and Custom build goals remain supported', () => {
  assert.equal(normalizeTargetType('meta'), 'meta');
  assert.equal(normalizeTargetType('custom'), 'custom');
  assert.equal(normalizeTargetType('max_ergo'), 'meta');
  assert.equal(normalizeTargetType('min_recoil'), 'meta');
  assert.equal(normalizeTargetType('budget'), 'meta');
});

test('removed stored build goals migrate to Meta', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    saveTargetTypePreference('budget');
    assert.equal(loadTargetTypePreference(), 'meta');

    saveTargetTypePreference('custom');
    assert.equal(loadTargetTypePreference(), 'custom');
  });
});

test('language preference defaults to English and accepts only supported languages', () => {
  const storage = createStorage();
  withWindow(storage, () => {
    assert.equal(loadLanguagePreference(), DEFAULT_LANGUAGE);
    saveLanguagePreference('ru');
    assert.equal(loadLanguagePreference(), 'ru');
    saveLanguagePreference('invalid');
    assert.equal(loadLanguagePreference(), DEFAULT_LANGUAGE);
  });
});

test('language preference safely handles unavailable storage', () => {
  const localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  withWindow(localStorage, () => {
    assert.equal(loadLanguagePreference(), DEFAULT_LANGUAGE);
    assert.doesNotThrow(() => saveLanguagePreference('ru'));
  });
});
