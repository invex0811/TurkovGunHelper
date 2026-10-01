# Тестирование и CI

В проекте два вида тестов:

| Вид | Инструмент | Где | Запуск |
| --- | --- | --- | --- |
| Unit | Встроенный раннер Node (`node:test` + `node:assert/strict`) | `tests/**/*.test.js` | `npm test` |
| E2E | Playwright, Chromium | `tests/e2e/*.spec.js` | `npm run test:e2e` |

## Unit-тесты

`npm test` выполняет `node --test`. Раннер сам находит файлы `*.test.js`. Файлы `*.spec.js` (e2e) и скрипты из `research/` под этот шаблон не попадают.

```bash
node --test tests/calculator/calculator.test.js
```

```bash
node --test --test-name-pattern="suppressor"
```

```bash
node --test --watch
```

### Структура

Каталоги `tests/` повторяют структуру `src/`:

| Каталог | Что проверяется |
| --- | --- |
| `tests/calculator/` | Подбор билда во всех режимах, ограничения, приоритеты, предупреждения, MOA, дальность пристрелки, протокол worker и его жизненный цикл |
| `tests/data/` | Клиент и репозиторий tarkov.dev, IndexedDB-кэш, цены и бартеры, Ref, уровни торговцев, настройки, сохранённые билды |
| `tests/domain/` | Дерево сборки, ручное редактирование, цепочки замен, «уже есть», категории, режимы огня, лимит цены |
| `tests/features/` | Экспорт/импорт, цели билда, уведомления конфигуратора, прицелы, тактические устройства, группы частей, аналитика, сравнение модулей |
| `tests/ui/` | Чистые помощники компонентов: диаграмма билда, шкалы характеристик, радар, фильтры главной, ссылки на tarkov.dev, подмножество иконок |
| `tests/i18n/` | Интерполяция и отдельные тексты интерфейса на обоих языках |
| `tests/pages/` | Помощники страниц |

Тесты калькулятора на реальных фикстурах медленные: секунды на тест. Раннер Node параллелит только файлы, а тесты внутри одного файла идут последовательно. Поэтому тесты `calculateBestBuild` разбиты по темам на файлы `tests/calculator/calculator*.test.js`, а общие фикстуры и проверки лежат в `calculatorTestHelpers.js`. Медленный тест добавляйте в подходящий по теме файл. Если какой-то файл стал заметно дольше остальных (больше ~10 с), разбейте его.

React-компоненты в unit-тестах не рендерятся. Тестируется логика, вынесенная из компонентов в чистые функции (например, `src/ui/weaponBuildDiagram.js` рядом с `WeaponBuildDiagram.jsx`). Поведение самих компонентов проверяют e2e-тесты.

### Фикстуры

`tests/fixtures/`:

- `weapon.json`, `mods.json` — реальные данные оружия и модулей для калькулятора;
- `priceModes.json` — предметы с ценами PvP/PvE;
- `tarkovJson.js` — `createTarkovJsonFixture(language)`, синтетический ответ JSON API tarkov.dev (предметы, переводы, бартеры, торговцы) на `en` и `ru`;
- `buildTransferM4a1.js` — билд для тестов экспорта и импорта.

### Окружение браузера в Node

- `fetch` подменяется в тесте через `globalThis.fetch = …`.
- IndexedDB даёт пакет `fake-indexeddb` (`import 'fake-indexeddb/auto'`).
- Для `localStorage` в функции хранения передаётся объект-заглушка: большинство функций принимают `storage` последним аргументом.
- `import.meta.env` в Node не определён, поэтому модули, которые импортируются в unit-тестах, обращаются к нему через `import.meta.env?.DEV`.

### Как писать тест калькулятора

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBestBuild } from '../../src/domain/calculator.js';

test('requires a suppressor when requested', () => {
  const result = calculateBestBuild(weapon, 'meta', 0, 0, modMap, {
    requireSuppressor: true,
    priceMode: 'pvp',
  });
  assert.equal(result.error, undefined);
  assert.ok(result.build.some(part => hasCategory(part.item, 'Silencer')));
});
```

Проверяйте конкретный исход (какие предметы стоят, какая ошибка), а не только «что-то вернулось»: калькулятор детерминирован, и тест должен ловить смену выбора.

## E2E-тесты

[`playwright.config.js`](../playwright.config.js):

- перед тестами выполняется `npm run build && npm run preview` на `http://127.0.0.1:4173`, так что проверяется production-сборка вместе с service worker;
- один worker, без параллельности и без повторов;
- трейс и скриншоты сохраняются только при падении, HTML-отчёт — в `playwright-report/`.

Сеть к tarkov.dev **не используется**: [`tests/e2e/fixtures/tarkovApi.js`](../tests/e2e/fixtures/tarkovApi.js) перехватывает запросы `mockTarkovApi(page)` и отдаёт синтетический каталог. Перед каждым тестом очищаются сохранённые билды и выставляются язык `en` и режим `pvp`.

Сценарии в [`tarkovGunHelper.spec.js`](../tests/e2e/tarkovGunHelper.spec.js): создание билда, цели билда и их сохранение, ограничения и приоритеты, «уже есть», уровни торговцев, переключатель цен, офлайн-режим и манифест PWA, замена части и восстановление билда, экспорт/импорт, ловушка фокуса в диалогах, `prefers-reduced-motion`.

```bash
npx playwright test -g "replaces a part"
```

```bash
npx playwright show-report
```

## CI/CD

### [`ci.yml`](../.github/workflows/ci.yml)

Запускается только на pull request (Node 20, Ubuntu). После мержа в `main` CI повторно не запускается: тот же код уже проверен в PR.

1. `npm ci`
2. `npm test`
3. `npm run lint`
4. `npm run build`
5. `npx playwright install --with-deps chromium`
6. `npm run test:e2e`

### [`deploy.yml`](../.github/workflows/deploy.yml)

Push в `main` → `npm ci` → сборка → публикация `dist/` на GitHub Pages. Тесты и линтер при деплое не запускаются: к этому моменту они уже прошли в CI на pull request.

Поэтому в `main` всё должно попадать **только через pull request с зелёным CI**. Прямой push в `main` уйдёт на сайт без проверок. Чтобы GitHub не пропускал такое, включите защиту ветки: Settings → Branches → правило для `main` с «Require a pull request before merging» и «Require status checks to pass» (проверка «Test, lint, and build»).

### Перед pull request

```bash
npm test && npm run lint && npm run build
```

Если менялся UI, маршруты, хранилище или PWA, запустите ещё `npm run test:e2e`.
