# Хранение и перенос билдов

Пользовательские данные хранятся только в браузере. Сервера и синхронизации нет; для переноса между устройствами есть экспорт и импорт файлов.

## localStorage

| Ключ | Модуль | Содержимое |
| --- | --- | --- |
| `tarkov-gun-helper:saved-builds` | [`savedBuilds.js`](../src/data/savedBuilds.js) | Массив сохранённых билдов (не больше 100) |
| `tarkov-gun-helper-theme` | [`App.jsx`](../src/App.jsx) | `dark` или `light` |
| `tarkovGunHelper.language` | [`i18n/language.js`](../src/i18n/language.js) | `en` или `ru` |
| `tarkovGunHelper.priceMode` | [`buildPreferences.js`](../src/data/settings/buildPreferences.js) | `pvp` или `pve` |
| `tarkovGunHelper.buildGoalMode` | то же | Последняя цель билда: `meta`, `constraints`, `priorities` |
| `tarkovGunHelper.targetType` | то же | Устаревший ключ цели билда, читается для миграции |
| `tarkovGunHelper.includeTraderPrices` | то же | Учитывать цены торговцев |
| `tarkovGunHelper.strictTraderLevels` | то же | Учитывать уровни торговцев |
| `tarkovGunHelper.includeRefOffers` | то же | Учитывать торговца Ref |
| `tarkovGunHelper.rememberTacticalDeviceSelection` | то же | Запоминать выбранные фонарь и ЛЦУ |
| `tarkovGunHelper.lastSelectedFlashlightId`, `tarkovGunHelper.lastSelectedTblId` | то же | Последние выбранные устройства |
| `tarkovGunHelper.rememberRequiredModules` | то же | Запоминать обязательные модули для каждого оружия |
| `tarkovGunHelper.rememberedRequiredModules` | то же | `{ [weaponId]: itemId[] }` |
| `tarkovGunHelper.traderLevels` | [`traderLevels.js`](../src/data/settings/traderLevels.js) | Уровни торговцев по профилям `pvp`/`pve` |

Правила работы с хранилищем:

- Любое чтение и запись оборачиваются в `try/catch`. В приватном режиме или при заполненной квоте `localStorage` бросает исключения, а приложение должно работать дальше со значениями по умолчанию.
- Прочитанные значения всегда нормализуются (`normalize*`). Неизвестное значение заменяется значением по умолчанию.
- Новые ключи настроек называйте `tarkovGunHelper.<имя>` и добавляйте в эту таблицу.

Кэш каталога tarkov.dev хранится не в `localStorage`, а в IndexedDB — см. [Слой данных](data-layer.md#кэширование).

## Сохранённый билд

`createBuildSnapshot()` создаёт снимок билда, `saveBuildSnapshot()` записывает его. Схема (версия `SAVED_BUILD_SCHEMA_VERSION = 1`):

```js
{
  id,                 // crypto.randomUUID()
  version: 1,
  name,
  weapon: { id, name, shortName, imageUrl },
  parts: [{
    itemId, itemName,
    slotName, slotId, slotIndex, slotInstanceId,
    parentItemId, parentInstanceId,
  }],
  ownedItems: [{ key, itemId }],   // отмеченные «уже есть» (key = slotInstanceId предмета)
  stats: { ergonomics, recoilModifier, recoilVertical, recoilHorizontal, weight, price },
  settings: { ... },               // параметры генерации: цель, лимиты, режим глушителя,
                                   // прицел, устройства, обязательные модули, политика цен
}
```

Хранятся только ID предметов, а не сами предметы. При открытии (`#/configure/<weaponId>?build=<id>`) `restoreBuildParts()` заново находит предметы в актуальном каталоге. Предметы, которых в каталоге больше нет, возвращаются в `missingItemIds`, и UI сообщает о них пользователю. Сохранённые `stats` используются только для списка и сравнения на странице **Builds**; в конфигураторе характеристики пересчитываются по текущим данным.

Ограничения: `MAX_SAVED_BUILDS = 100`, сравнить можно до `MAX_COMPARE_BUILDS = 4`. Ошибки хранилища — `SavedBuildStorageError` с полем `code` (например, `STORAGE_UNAVAILABLE`).

Если меняете схему снимка, сохраняйте обратную совместимость: старые снимки должны читаться (как это сделано для устаревших настроек в `copyCurrentSettings` и `migrateSharedMaxPriceSettings`). Если без несовместимого изменения не обойтись, увеличьте `SAVED_BUILD_SCHEMA_VERSION` и добавьте миграцию.

## Экспорт и импорт

Код: [`src/features/buildTransfer/`](../src/features/buildTransfer/).

| Модуль | Назначение |
| --- | --- |
| `serializer.js` | `exportBuild()` / `exportBuilds()` — снимок → переносимый формат |
| `file.js` | Безопасное имя файла и скачивание JSON |
| `validator.js` | Проверка структуры и лимитов импортируемого файла |
| `importer.js` | Сопоставление с каталогом, поиск дубликатов, сборка снимков |
| `fingerprint.js` | Отпечаток конфигурации для поиска дубликатов |
| `constants.js` | Формат, версия, лимиты, стратегии дубликатов |

### Формат файла

```json
{
  "format": "tarkov-gun-helper-builds",
  "version": 1,
  "exportedAt": "2026-10-01T12:00:00.000Z",
  "builds": [
    {
      "name": "M4A1 meta",
      "gameMode": "regular",
      "weaponId": "5447a9cd4bdc2dbd208b4567",
      "settings": { "…": "…" },
      "ownedItems": [{ "key": "weapon:…/slot:…/item:…", "itemId": "…" }],
      "configuration": {
        "itemId": "5447a9cd4bdc2dbd208b4567",
        "slotId": null,
        "children": [
          { "itemId": "…", "slotId": "mod_pistol_grip", "slotIndex": 0, "children": [] }
        ]
      }
    }
  ]
}
```

`gameMode` берётся из режима цен билда (`pve` → `pve`, иначе `regular`). В отличие от снимка в `localStorage`, конфигурация экспортируется **деревом** (оружие → слоты → модули), а слот определяется по `nameId` из данных tarkov.dev. Так файл не зависит от внутренних путей и легко проверяется. Из настроек экспортируются только ключи из списка `EXPORTED_SETTING_KEYS` в `serializer.js`.

### Лимиты импорта

`BUILD_IMPORT_LIMITS`: файл до 2 МБ, до 20 файлов за раз, до 100 билдов, до 500 узлов и глубина до 20 в одном билде, имя до 80 символов. Файл приходит от пользователя, поэтому валидатор проверяет всё и ничему не доверяет.

### Дубликаты

Отпечаток билда — `gameMode` + `weaponId` + нормализованное (отсортированное) дерево конфигурации. Если импортируемый билд совпадает с существующим, пользователь выбирает стратегию: `skip` (пропустить), `copy` (сохранить копию) или `replace` (заменить).

### Импорт по шагам

1. `parseBuildImport()` / `validateBuildImport()` проверяют JSON, формат, версию и лимиты.
2. UI загружает каталог для каждого нужного `gameMode`.
3. `prepareImportedBuilds()` восстанавливает каждый билд по каталогу (`restoreImportedBuild()`): дерево раскладывается обратно в плоский список частей. Каждому билду присваивается статус `ready`, `duplicate` или `error` (оружие или модуль не найдены либо не встают в слот). По умолчанию дубликаты пропускаются, остальные билды импортируются.
4. Выбранные билды записываются через `importSavedBuildSnapshots()` с учётом лимита в 100 билдов.

UI импорта — [`BuildImportModal`](../src/ui/BuildImportModal.jsx), экспорт запускается со страницы [`Builds`](../src/pages/Builds.jsx).
