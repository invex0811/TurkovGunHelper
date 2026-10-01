# Слой данных и цены

Код: `src/data/`. Публичный API для остального приложения — [`src/data/tarkovApi/index.js`](../src/data/tarkovApi/index.js).

## Источник данных

Все данные берутся из **статического JSON API tarkov.dev** — `https://json.tarkov.dev/`. Это не GraphQL API tarkov.dev, а заранее сгенерированные файлы.

На один каталог приходится пять параллельных запросов (`<gameMode>` — `regular` или `pve`, `<lang>` — `en` или `ru`):

| Endpoint | Содержимое |
| --- | --- |
| `<gameMode>/items` | Все предметы (объект по ID), категории, слоты, характеристики, предложения `buyFor` |
| `<gameMode>/items_<lang>` | Таблица переводов для имён предметов |
| `<gameMode>/barters` | Бартеры торговцев (единственный endpoint, где `data` — массив) |
| `<gameMode>/traders` | Торговцы и их уровни |
| `<gameMode>/traders_<lang>` | Переводы имён торговцев |

### HTTP-клиент

[`client.js`](../src/data/tarkovApi/client.js) — `fetchTarkovJson(path, { signal, timeoutMs, allowArrayData })`:

- принимает только пути внутри `https://json.tarkov.dev/`;
- таймаут по умолчанию 15 с (`timeoutMs: 0` отключает его);
- поддерживает отмену через `AbortSignal`;
- все ошибки приводит к `TarkovApiError` с полем `code`:

| `code` | Когда |
| --- | --- |
| `HTTP_ERROR` | Ответ не 2xx (в `status` — HTTP-код) |
| `INVALID_RESPONSE` | Невалидный JSON или неожиданная структура |
| `TIMEOUT` | Истёк таймаут |
| `ABORTED` | Запрос отменён вызывающим кодом (`isAbortError(error)` → `true`) |
| `NETWORK_ERROR` | Сеть недоступна |
| `NOT_FOUND` | `getWeaponDetails` не нашёл оружие по ID |

### Переводы

В ответах `items` и `traders` текстовые поля содержат не текст, а ключи перевода, а поле `translations` перечисляет JSONPath-пути к ним (например, `$.data.*.name`). Файл `items_<lang>` / `traders_<lang>` — словарь «ключ → текст». [`translations.js`](../src/data/tarkovApi/translations.js) проходит по путям и подставляет текст. Ключи `__proto__`, `prototype` и `constructor` блокируются, чтобы внешние данные не могли испортить прототипы.

## Публичные функции

```js
import {
  loadItemsCatalog,     // (gameMode, { language, priceMode, signal, forceRefresh, timeoutMs }) → catalog
  getWeapons,           // ({ priceMode, language, signal }) → weapons[]
  getAllMods,           // (priceMode, { language, signal }) → modsById
  getWeaponDetails,     // (id, priceMode, { language, signal }) → item
  getCatalogStatus,     // (gameMode, { language, priceMode }) → статус или null
  subscribeToCatalogStatus, // (listener) → unsubscribe
  clearTarkovApiCache,
  isAbortError,
} from './data/tarkovApi/index.js';
```

Режим цен определяет режим игры: `pvp` → `regular`, `pve` → `pve` ([`priceProvider.js`](../src/data/price/priceProvider.js)).

## Нормализованный каталог

[`normalizeItemsCatalog()`](../src/data/tarkovApi/itemMapper.js) приводит сырые данные к одной форме:

```js
{
  items,       // все предметы
  itemsById,   // { [id]: item }
  weapons,     // предметы с types.includes('gun')
  mods,        // предметы с types.includes('mods')
  modsById,    // { [id]: mod } — это и есть modMap калькулятора
  traders,     // [{ id, name, imageUrl, maxLevel }] — только те, у кого есть предложения
}
```

Что делает нормализация с каждым предметом:

- ссылки (`conflictingItems`, `allowedItems` в слотах) превращает в `{ id }`;
- разворачивает `categories` в объекты с именами (по `itemCategories`, с запасным вариантом `handbookCategories`);
- поднимает `properties.slots` в `item.slots`, у каждого слота гарантирует `name`, `nameId`, `required`, `filters.allowedItems`;
- для оружия подтягивает `defaultPreset` и кладёт полный предмет пресета в `defaultPresetItem` (нужен для картинки и запасной цены);
- превращает `buyFor` в предложения с объектом `vendor` (торговец, `minTraderLevel`, `taskUnlock`, `buyLimit`);
- привязывает к предмету его бартеры (`bartersFor`), подставляя в требуемые предметы их цены;
- считает цены: `purchaseOffers` и `price` (см. ниже).

## Кэширование

Каталог кэшируется на двух уровнях. Ключ кэша — `catalog:v1:<gameMode>:<language>:<priceMode>` ([`catalogCacheSchema.js`](../src/data/cache/catalogCacheSchema.js)).

| Уровень | Где | Срок | Назначение |
| --- | --- | --- | --- |
| Память | `Map` в `repository.js` | 5 минут | Переходы между страницами без повторной загрузки; объединение одновременных запросов |
| Постоянный | IndexedDB, база `tarkov-gun-helper`, хранилище `catalogs` | 1 час свежести | Быстрый старт, работа офлайн |

Алгоритм `loadItemsCatalog()`:

1. Если такой же запрос уже выполняется — подписаться на него. Пока у запроса есть хоть один потребитель, он продолжается; когда все отменились, запрос прерывается.
2. Свежая запись в памяти — вернуть её (статус `memory-cache`).
3. Свежая запись в IndexedDB — вернуть её (статус `persistent-cache`).
4. Устаревшая запись в IndexedDB — **сразу вернуть её** (stale-while-revalidate) и в фоне запустить загрузку с `forceRefresh: true`.
5. Иначе загрузить из сети, нормализовать, сохранить в IndexedDB (статус `network`).
6. Если сеть упала, а запись в IndexedDB есть — вернуть её с `refreshFailed: true`.

Каждый исход публикуется как статус каталога:

```js
{ cacheKey, source: 'network' | 'memory-cache' | 'persistent-cache',
  fetchedAt, isStale, isOfflineFallback, refreshFailed }
```

[`CatalogStatusProvider`](../src/features/dataStatus/CatalogStatusProvider.jsx) подписывается на эти события, а индикатор `CatalogStatus` в шапке показывает их пользователю и умеет запустить принудительное обновление.

Если меняете форму нормализованного каталога, увеличьте `PERSISTENT_CACHE_SCHEMA_VERSION`, иначе у пользователей будут читаться старые записи. Записи с другой версией схемы игнорируются валидатором `isValidCatalogCacheRecord()`.

## Цены

Код: [`src/data/price/`](../src/data/price/). Все цены — в рублях.

### Режимы цен

`PRICE_MODES = { PVP: 'pvp', PVE: 'pve' }`, по умолчанию `pvp`. Режим выбирается переключателем в шапке, хранится в `localStorage` и передаётся явно во все функции загрузки и расчёта.

### Предложения

`normalizePurchaseOffers(item, mode)` собирает для предмета:

- **`fleaMarket`** — самое дешёвое предложение барахолки из `buyFor`. Если его нет, используется устаревшее поле: `avg24hPrice` → `lastLowPrice` → `low24hPrice` (последние два помечены `fallbackUsed`);
- **`traderOffers`** — прямые предложения торговцев (с уровнем лояльности и признаком квеста) и бартеры. Цена бартера — сумма самых дешёвых цен требуемых предметов, делённая на количество получаемых.

### Выбор цены

`selectPurchasePrice(item, options)` выбирает **самое дешёвое доступное** предложение с учётом настроек:

| Опция | По умолчанию | Эффект |
| --- | --- | --- |
| `priceMode` | режим предмета | Если предложения посчитаны для другого режима — цена считается отсутствующей |
| `includeTraderPrices` | `true` | `false` — только барахолка |
| `includeRefOffers` | `true` | `false` — исключить торговца Ref (его бартеры требуют GP-монеты) |
| `strictTraderLevels` + `traderLevels` | выкл. | Исключить предложения торговцев, чей требуемый уровень выше уровня пользователя |

Результат — объект цены:

```js
{
  value,            // число или null, если купить негде
  currency: 'RUB', mode, source: 'tarkov.dev',
  sourceType,       // 'fleaMarket' | 'trader' | 'basePrice' | 'missing'
  vendorName, traderId, traderLevel, questRequired,
  isBarter, barterOnly, requiredItems,
  fallbackUsed, confidence,  // 'high' | 'fallback' | 'missing'
  traderFallbackUsed,        // самое дешёвое предложение недоступно по уровню
  unavailableTraderOffers, traderAvailability, offers,
}
```

Для оружия есть `selectWeaponPurchasePrice()`: если само оружие купить нельзя, берётся цена пресета по умолчанию, а если нет и её — `basePrice` (с `sourceType: 'basePrice'`).

Короткие помощники: `getPurchasePriceValue(item, options, missingValue)` и `sumPurchasePrices(items, options)` (сумма равна `null`, если хоть у одного предмета нет цены).

### Предметы только у Ref

`isRefOnlyItem(item)` — предмет продаёт только Ref. Если пользователь отключил Ref, калькулятор удаляет такие предметы из поиска (`excludeRefOnlyItems`), кроме модулей, которые пользователь сам отметил обязательными.

## Уровни торговцев

[`src/data/settings/traderLevels.js`](../src/data/settings/traderLevels.js) хранит уровни отдельно для PvP и PvE:

```js
{ schemaVersion: 1, profiles: { pvp: { [traderId]: 1..4 }, pve: { ... } } }
```

Максимальный уровень берётся из данных торговца (`traders[].maxLevel`), по умолчанию 4. Уровни применяются, только если в настройках включён строгий режим (`strictTraderLevels`). Иначе калькулятор считает, что пользователю доступны все предложения.
