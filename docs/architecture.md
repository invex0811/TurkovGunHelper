# Архитектура

## Общая схема

```
          ┌──────────────────────────── браузер ─────────────────────────────┐
          │                                                                  │
 tarkov.dev JSON API ──► data/tarkovApi ──► кэш в памяти (5 мин)             │
 (json.tarkov.dev)        │  нормализация    + IndexedDB (1 ч)               │
                          │  + data/price                                    │
                          ▼                                                  │
                  pages/ и features/ (React UI) ──postMessage──► Web Worker  │
                          │                                     domain/calculator
                          ▼                                                  │
                  localStorage: настройки, сохранённые билды                 │
          └──────────────────────────────────────────────────────────────────┘
```

Сервера нет. Всё, что делает приложение, происходит в браузере пользователя.

## Слои

Проект разделён на слои с однонаправленными зависимостями: UI зависит от domain и data, domain не знает о React и браузере.

| Слой | Каталог | Ответственность | Не должен |
| --- | --- | --- | --- |
| Данные | `src/data/` | Загрузка из tarkov.dev, нормализация предметов, цены, кэш, чтение/запись настроек и билдов | Импортировать React |
| Домен | `src/domain/` | Расчёт билдов, статистика, совместимость, дерево сборки, цепочки замен | Обращаться к DOM, `localStorage`, сети |
| Фичи | `src/features/` | Связка UI и домена по конкретной функции: конфигуратор, перенос билдов, режим цен, аналитика, PWA | — |
| Страницы | `src/pages/` | Маршрутизируемые экраны | Содержать алгоритмы расчёта |
| UI-компоненты | `src/ui/` | Переиспользуемые компоненты и их чистые помощники (диаграмма билда, модальные окна, панели слотов) | — |
| Локализация | `src/i18n/` | Тексты на `en`/`ru`, провайдер языка, интерполяция | — |
| Worker | `src/workers/` | Запуск калькулятора вне UI-потока | — |

> Домен импортирует из `src/data/price/` функции выбора цены (`priceMapper.js`) — это чистые функции над уже нормализованными предметами, а не обращения к сети.

## Структура каталогов

```
src/
├── main.jsx, App.jsx           # точка входа, провайдеры, маршруты, шапка
├── index.css, App.css          # глобальные стили и токены темы
├── assets/                     # шрифт Material Symbols, изображения
├── data/
│   ├── tarkovApi/              # client.js (fetch), repository.js (каталог+кэш),
│   │                           # itemMapper.js (нормализация), translations.js
│   ├── price/                  # priceModes.js, priceProvider.js, priceMapper.js
│   ├── cache/                  # IndexedDB-кэш каталога и схема записей
│   ├── settings/               # buildPreferences.js, traderLevels.js (localStorage)
│   └── savedBuilds.js          # CRUD сохранённых билдов
├── domain/
│   ├── calculator.js           # публичный вход калькулятора
│   ├── calculator/             # оркестрация, поиск, скоринг, статистика, цены
│   ├── weaponAssembly.js       # дерево сборки и стабильные ID слотов
│   ├── weaponBuildEditor.js    # ручная замена модулей и валидация
│   ├── replacementChain.js     # цепочки замен (модуль + всё, что на нём)
│   ├── ownedItems.js           # «уже есть в наличии» и итоговая стоимость
│   ├── customConstraints.js    # оценка мягких ограничений
│   ├── customPriorityAttributes.js
│   ├── sightModes.js, scopeZoom.js, fireModes.js, itemCategories.js, ...
├── features/
│   ├── configurator/           # страница конфигуратора, хуки, компоненты
│   ├── buildTransfer/          # экспорт/импорт билдов в JSON
│   ├── moduleComparison/       # таблица сравнения модулей
│   ├── priceMode/              # контекст PvP/PvE и переключатель
│   ├── traderLevels/           # контекст уровней торговцев
│   ├── dataStatus/             # контекст и индикатор свежести каталога
│   ├── analytics/              # Umami
│   └── pwa/                    # установка и обновление PWA
├── i18n/                       # сообщения en/ru и провайдер
├── pages/                      # Home, Configurator, Builds, ModuleComparison, Settings
├── ui/                         # общие компоненты и их чистые помощники
└── workers/buildCalculator.worker.js
```

## Маршруты

Используется `HashRouter` — GitHub Pages не умеет отдавать `index.html` на произвольный путь, а с хешем это не нужно.

| Путь | Страница | Назначение |
| --- | --- | --- |
| `#/` | [`Home`](../src/pages/Home.jsx) | Каталог оружия: поиск, фильтры по типу, калибру и торговцу, сортировка |
| `#/configure/:weaponId` | [`ConfiguratorPage`](../src/features/configurator/ConfiguratorPage.jsx) | Генерация и редактирование билда |
| `#/configure/:weaponId?build=<id>` | то же | Открывает сохранённый билд для продолжения работы |
| `#/builds` | [`Builds`](../src/pages/Builds.jsx) | Сохранённые билды, сравнение до 4 штук, импорт/экспорт |
| `#/module-comparison` | [`ModuleComparison`](../src/pages/ModuleComparison.jsx) | Сравнение характеристик модулей одной категории |
| `#/settings` | [`Settings`](../src/pages/Settings.jsx) | Язык, тема, уровни торговцев, параметры цен |

Все страницы, кроме главной, загружаются лениво (`React.lazy`) — отдельными чанками.

## Глобальное состояние

Глобальное состояние хранится в React Context. Провайдеры подключаются в `App.jsx` в таком порядке:

```
I18nProvider            язык интерфейса (en/ru)              → useI18n()
└─ PriceModeProvider    режим цен PvP/PvE                     → usePriceMode()
   └─ TraderLevelsProvider  уровни торговцев, строгий режим, Ref → useTraderLevels()
      └─ CatalogStatusProvider  свежесть каталога, обновление → useCatalogStatus()
         └─ HashRouter → MainLayout (шапка, маршруты, PwaUpdatePrompt)
```

Каждый провайдер сам читает начальное значение из `localStorage` и сохраняет изменения обратно. Тема (`dark`/`light`) хранится отдельно хуком `useTheme` в `App.jsx` и выставляется атрибутом `data-theme` на `<html>`.

Остальное состояние локально для страниц. Самая насыщенная — страница конфигуратора: она держит параметры генерации, результат, ручные правки, отметки «уже есть», выбранные тактические устройства и прицелы.

## Поток данных конфигуратора

1. `ConfiguratorPage` получает `weaponId` из URL и вызывает [`useConfiguratorCatalog`](../src/features/configurator/hooks/useConfiguratorCatalog.js), который параллельно запрашивает `getWeaponDetails()` и `getAllMods()`. Оба берут данные из одного кэшированного каталога, так что сетевой запрос один.
2. Если в URL есть `?build=<id>`, хук [`useSavedBuild`](../src/features/configurator/hooks/useSavedBuild.js) восстанавливает части билда из `localStorage` по ID предметов.
3. Пользователь задаёт цель и ограничения. Они собираются в объект `options` (см. [Калькулятор](calculator.md#входные-параметры)).
4. По кнопке **Generate Build** хук [`useBuildCalculation`](../src/features/configurator/hooks/useBuildCalculation.js) отправляет задачу в Web Worker. Новый запрос отменяет предыдущий: старый worker завершается и создаётся новый.
5. Результат (`build` + `stats` + предупреждения) показывается в `WeaponSummary`, `BuildParts` и интерактивной диаграмме [`WeaponBuildDiagram`](../src/ui/WeaponBuildDiagram.jsx).
6. Ручная замена модуля идёт через [`replacementService`](../src/features/configurator/services/replacementService.js) и домен (`weaponBuildEditor.js`, `replacementChain.js`). Статистика пересчитывается синхронно через `recalculateBuildStats()`, без worker.
7. При смене режима цен каталог перезагружается для нового режима, а цены текущего билда пересчитываются без повторной оптимизации; пользователю предлагают пересчитать билд.
8. Сохранение — `createBuildSnapshot()` + `saveBuildSnapshot()` в `localStorage`.

## Модель билда

Билд — плоский массив частей. Каждая часть ссылается на слот родителя:

```js
{
  item,              // нормализованный предмет из каталога
  slotName,          // отображаемое имя слота
  slotId,            // `${slot.id || slot.nameId}:${индекс слота}`
  slotIndex,
  slotInstanceId,    // путь до слота от корня: 'weapon:…/slot:…/item:…/slot:…'
  parentItemId,
  parentInstanceId,
}
```

[`buildWeaponAssemblyTree()`](../src/domain/weaponAssembly.js) превращает этот массив в дерево (оружие → слоты → модули → их слоты). `slotInstanceId` стабилен и уникален даже при нескольких одинаковых модулях. На нём держатся ручная замена, отметки «уже есть в наличии» и экспорт. `rebindBuildPartsToCatalog()` переносит билд на каталог другого языка или режима цен.

## Ключевые решения

- **Frontend-only.** Нет сервера, нет аккаунтов. Данные пользователя живут только в его браузере; для переноса есть экспорт в файл.
- **Один каталог на (режим игры × язык × режим цен).** tarkov.dev отдаёт разные данные для `regular` и `pve`, а локализованные имена — отдельными файлами. Каталог нормализуется один раз и переиспользуется всеми страницами.
- **Расчёт в Web Worker.** Поиск билда может занимать секунды, поэтому он вынесен из UI-потока и отменяем.
- **Детерминированность.** При равенстве оценок калькулятор выбирает более дешёвый билд, а затем сравнивает отсортированный список ID предметов (`getBuildTieKey`). Один и тот же вход всегда даёт один и тот же результат, на этом построены тесты.
