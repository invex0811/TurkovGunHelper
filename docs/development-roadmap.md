# TarkovGunHelper Development RoadMap

Документ описывает актуальную дорожную карту дальнейшей разработки проекта TarkovGunHelper после обновления структуры проекта, стабилизации baseline calculator logic, внедрения suppressor constraints и добавления конфигурируемого источника цен.

RoadMap фиксирует текущее состояние проекта как рабочий baseline и оставляет в плане только актуальные нереализованные или частично реализованные задачи: расширение calculation model, разделение domain-модулей, улучшение search algorithm, UI/UX cleanup, persistent cache, API reliability, документация и developer workflow.

---

## Architectural direction

Проект развивается как frontend-only React/Vite приложение для подбора билдов оружия Escape from Tarkov.

Целевая архитектура:

- **UI layer** отвечает только за отображение, пользовательский ввод, состояние экрана и навигацию.
- **API/data layer** отвечает за загрузку, нормализацию, кэширование и диагностику внешних данных.
- **Price layer** отвечает за выбор price mode, нормализацию цены, fallback policy и price metadata.
- **Domain/calculation layer** отвечает за расчёт билдов, hard constraints, soft preferences, scoring и итоговую структуру результата.
- **Tests layer** фиксирует ожидаемое поведение calculator logic, price normalization и критичных data-transform сценариев.
- **Research layer** содержит экспериментальные скрипты и не считается production/test source.

Ключевые архитектурные правила:

- UI не должен содержать сложную business logic расчёта билдов.
- Calculator не должен зависеть от React, DOM, browser state или localStorage.
- Источник цен должен быть явной частью конфигурации.
- PvP/PvE price mode должен передаваться в data/calculation flow явно.
- Budget/scoring logic должна работать через normalized price model.
- Hard constraints должны обрабатываться как обязательные условия валидности билда.
- Optional preferences должны влиять на scoring, но не подменять hard constraints.
- Новое поведение calculator должно сопровождаться regression tests.
- Потенциально тяжёлые расчёты должны быть подготовлены к выносу из UI thread.
- Документация проекта должна быть достаточной для нового разработчика без опыта с JS/Vite.

Основная цель дальнейшей разработки — превратить текущий MVP в стабильный инструмент подбора билдов с предсказуемым алгоритмом, конфигурируемыми источниками данных и расширяемой scoring-моделью.

---

## Current baseline

На текущий момент проект содержит:

- React/Vite frontend application.
- HashRouter-based navigation.
- Главную страницу со списком оружия.
- Страницу конфигуратора оружия.
- API/data layer в `src/data/tarkovApi`.
- JSON GET client, item adapter и repository functions, разделённые по файлам.
- Price layer в `src/data/price`.
- Settings helper для сохранения выбранного price mode.
- Domain calculator layer для подбора модов оружия.
- Unit tests для calculator logic.
- Unit tests для price mapper / price mode behavior.
- Fixtures для calculator и data tests.
- Research scripts для ручной проверки API/calculator scenarios.
- ESLint configuration.
- Production build через Vite.
- GitHub Pages deploy script.

Подтверждённые реализованные направления:

- Test workflow восстановлен для вложенной структуры `tests/**/*.test.js`.
- Research scripts исключены из ESLint checks.
- `gh-pages` перенесён в `devDependencies`.
- README заменён с Vite template на описание проекта.
- `requireSuppressor` обрабатывается как hard constraint.
- Suppressor logic покрыта regression tests:
  - direct suppressor;
  - suppressor через adapter/muzzle chain;
  - impossible suppressor requirement;
  - forbidden suppressor;
  - optional suppressor;
  - suppressor conflicts;
  - max weight constraints.

- Evaluator возвращает selected branch plan, а не только score.
- UI suppressor setting заменён на явный mode:
  - `allow`;
  - `forbid`;
  - `require`.

- Configurator показывает inline warnings/errors вместо `alert`.
- Price source research выполнен и зафиксирован.
- API перенесён в data layer.
- JSON API adapter вынесен в data layer.
- Repository layer введён поверх JSON GET client.
- Mod price model нормализована.
- Добавлен price mode selector:
  - PvP;
  - PvE.

- Price mode сохраняется локально.
- Price provider выбирает соответствующий `gameMode` для tarkov.dev.
- Budget scoring использует selected price mode.
- Price mode behavior покрыт fixtures/tests.
- UI показывает price source, fallback warnings и missing price warnings.

---

## Current limitations

Актуальные ограничения после обновления baseline:

- Calculator всё ещё расположен в одном крупном domain-файле.
- Scoring, constraints, stats calculation, category helpers и branch evaluation смешаны в одном модуле.
- Search algorithm остаётся улучшенным branch-plan greedy approach, но ещё не полноценной candidate graph model.
- Advanced options уже существуют, но требуют расширения:
  - custom scoring weights;
  - required sight;
  - required tactical device;
  - будущие hard/soft constraints.

- Custom mode всё ещё основан на переборе соотношений ergo/recoil, а не на явном weighted scoring profile.
- Configurator остаётся крупным компонентом с несколькими ответственностями.
- Home page error/empty states требуют улучшения.
- Inline styles всё ещё занимают значительную часть JSX.
- Persisted preferences пока покрывают не все build settings.
- API cache существует на runtime memory уровне.
- Persistent cache, cache metadata, manual refresh и stale-data diagnostics ещё не реализованы.
- API/data layer требует mocked JSON API response tests.
- CI workflow ещё не добавлен.
- Development/release workflow documentation требует отдельного оформления.

---

## Current structure direction

Текущая структура уже движется к целевому виду:

```text
docs/
  development-roadmap.md
  price-sources.md

research/
  calculator/

src/
  data/
    price/
      priceMapper.js
      priceModes.js
      priceProvider.js

    settings/
      buildPreferences.js

    tarkovApi/
      client.js
      index.js
      queries.js
      repository.js

  domain/
    calculator.js

  pages/
    Configurator.jsx
    Home.jsx

tests/
  calculator/
  data/
  fixtures/
```

Целевая структура на ближайшие этапы:

```text
docs/
  development-roadmap.md
  calculation-model.md
  price-sources.md
  development-workflow.md

src/
  app/
    App.jsx
    routes.jsx

  features/
    weapons/
    configurator/
      Configurator.jsx
      WeaponSummary.jsx
      BuildModeSelector.jsx
      AdvancedBuildOptions.jsx
      BuildResultSummary.jsx
      BuildPartsList.jsx
      BuildWarnings.jsx
      LoadingState.jsx
      ErrorState.jsx

  domain/
    calculator/
      index.js
      calculateBestBuild.js
      branchEvaluation.js
      scoring.js
      scoringProfiles.js
      constraints.js
      stats.js
      categories.js
      itemAttributes.js

  data/
    tarkovApi/
      client.js
      queries.js
      repository.js
      mappers.js

    price/
      priceModes.js
      priceMapper.js
      priceProvider.js

    cache/
      itemCache.js
      cacheMetadata.js

    settings/
      buildPreferences.js

  shared/
    components/
    formatters/
    constants/
    storage/

tests/
  fixtures/
  calculator/
  data/
```

Эта структура не должна вводиться одним большим коммитом. Переход должен быть постепенным и без изменения поведения там, где задача является refactor/chore.

---

## RoadMap priorities

Актуальные приоритеты дальнейшей разработки:

1. Зафиксировать текущую calculation model в документации.
2. Разделить calculator domain на поддерживаемые модули.
3. Подготовить явную scoring profile model.
4. Нормализовать mod attributes для расчётов.
5. Расширить custom scoring и advanced options.
6. Сделать search algorithm устойчивее к nested slots, conflicts и adapters.
7. Добавить top build alternatives и score breakdown.
8. Разделить Configurator на focused components.
9. Улучшить Home/API empty/error/retry states.
10. Перенести повторяющиеся inline styles в reusable classes.
11. Расширить persisted build preferences.
12. Добавить persistent item cache с metadata.
13. Добавить manual data refresh.
14. Покрыть API/data layer mocked JSON API tests.
15. Добавить CI для test/lint/build.

---

# Stage 1. Calculation model specification and domain cleanup

Цель этапа: зафиксировать будущую модель расчёта билдов и подготовить calculator к расширению без дальнейшего разрастания одного файла.

## Commits

### 1. `research(calculator): document extended scoring parameters`

Сделать:

- Создать `docs/calculation-model.md`.
- Описать текущую scoring model.
- Описать текущие calculator modes:
  - `meta`;
  - `max_ergo`;
  - `min_recoil`;
  - `budget`;
  - `custom`.

- Описать текущие hard constraints:
  - suppressor mode;
  - max weight;
  - conflicts;
  - duplicate installed items.

- Описать текущие soft preferences:
  - ergonomics;
  - recoil;
  - price;
  - weight penalty.

- Составить таблицу candidate parameters:
  - recoil vertical;
  - recoil horizontal;
  - ergonomics;
  - accuracy modifier;
  - weight;
  - item price;
  - total build price;
  - muzzle/adapter/suppressor chains;
  - sight requirement;
  - tactical device requirement;
  - magazine preference;
  - trader availability;
  - flea availability;
  - unlock level;
  - trader loyalty level;
  - price/performance ratio;
  - required/forbidden categories;
  - required/forbidden item IDs.

- Для каждого параметра указать:
  - gameplay value;
  - source data;
  - data reliability;
  - implementation complexity;
  - impact on algorithm;
  - testability.

- Отдельно разделить:
  - доступно сейчас;
  - доступно после изменения API query;
  - доступно только через другой data provider;
  - слишком дорого/сложно для ближайшей версии;
  - нецелесообразно для MVP.

Результат:

- Появляется понятная спецификация будущего calculator.
- Новые параметры не добавляются хаотично.
- Следующие refactor/feature commits опираются на documented model.

---

### 2. `refactor(calculator): split domain module boundaries`

Сделать:

- Превратить `src/domain/calculator.js` в модульную директорию `src/domain/calculator`.
- Вынести public export `calculateBestBuild` в `index.js`.
- Вынести основной orchestration в `calculateBestBuild.js`.
- Вынести branch evaluation helpers.
- Вынести scoring helpers.
- Вынести constraint helpers.
- Вынести stats calculation.
- Вынести category checks.
- Вынести item/slot utility functions.
- Сохранить текущий public API calculator.
- Не менять runtime behavior.
- Обновить imports в UI и tests.
- Проверить:
  - `npm.cmd test`;
  - `npm.cmd run lint`;
  - `npm.cmd run build`.

Результат:

- Domain layer становится читаемее.
- Calculator перестаёт быть одним монолитным файлом.
- Следующие изменения scoring/search logic становятся безопаснее.

---

### 3. `refactor(calculator): introduce scoring profile model`

Сделать:

- Ввести структуру `scoringProfile`.
- Перенести mode-specific веса в явную модель.
- Описать profiles для:
  - `meta`;
  - `max_ergo`;
  - `min_recoil`;
  - `budget`;
  - `custom`.

- Разделить:
  - hard constraints;
  - soft weights;
  - required features;
  - forbidden features;
  - fallback policy.

- Сохранить текущее поведение существующих modes.
- Добавить tests, подтверждающие backward compatibility.

Результат:

- Calculator modes становятся данными, а не набором разрозненных условий.
- Custom mode становится проще расширять.
- Hard constraints и soft scoring перестают смешиваться.

---

### 4. `refactor(calculator): normalize mod attributes for scoring`

Сделать:

- Ввести normalized attributes для mods:
  - `ergonomicsDelta`;
  - `recoilDelta`;
  - `accuracyDelta`;
  - `weight`;
  - `price`;
  - `categories`;
  - `conflicts`;
  - `slots`;
  - `availabilityMetadata`, если данные доступны.

- Скрыть raw API fields за mapper/helper layer.
- Упростить scoring function.
- Сохранить совместимость с текущими fixtures.
- Добавить tests для normalized attributes mapper/helper.

Результат:

- Calculator меньше зависит от внешней схемы API.
- Новые параметры проще подключать.
- Scoring получает более стабильный input.

---

# Stage 2. Advanced scoring and user-controlled preferences

Цель этапа: добавить расширяемую custom scoring model и связать её с UI без перегрузки базового сценария.

## Commits

### 1. `feat(calculator): add weighted custom scoring`

Сделать:

- Расширить custom mode через configurable weights.
- Поддержать веса:
  - recoil;
  - ergonomics;
  - price;
  - weight;
  - accuracy.

- Задать безопасные min/max ranges.
- Добавить default custom profile.
- Поддержать reset-to-default на уровне options/model.
- Сохранить backward-compatible behavior для старого custom mode, если weights не переданы.
- Не смешивать weighted custom scoring с hard constraints.

Результат:

- Пользователь сможет гибче управлять расчётом.
- Calculator получит первый практический шаг к расширяемой scoring model.

---

### 2. `feat(configurator): extend advanced calculation options`

Сделать:

- Расширить существующую Additional/Advanced section.
- Добавить controls для custom weights.
- Добавить optional required sight.
- Добавить optional required tactical device.
- Сохранить suppressor mode, price mode и max weight в advanced options.
- Не перегружать основной экран.
- Оставить базовый flow простым:
  - выбрать weapon;
  - выбрать build mode;
  - generate build.

- Передавать новые options в calculator через явную структуру.
- Показывать warning/error, если required sight/tactical device невозможно установить.

Результат:

- Advanced options становятся реальным центром пользовательских constraints/preferences.
- Новые параметры доступны без ухудшения UX для базового сценария.

---

### 3. `test(calculator): cover weighted scoring profiles`

Сделать:

- Добавить tests для scoring profiles.
- Проверить, что увеличение веса recoil реально меняет предпочтения.
- Проверить, что увеличение веса ergonomics реально меняет предпочтения.
- Проверить price-sensitive custom scoring.
- Проверить weight-sensitive custom scoring.
- Проверить accuracy-sensitive custom scoring, если данные доступны.
- Проверить, что hard constraints сильнее soft weights.
- Проверить fallback behavior при отсутствующих данных.
- Проверить custom weights edge cases:
  - missing weights;
  - zero weights;
  - out-of-range weights;
  - invalid numeric values.

Результат:

- Расширенная scoring model становится безопасной для изменений.
- Hard/soft behavior закрепляется тестами.

---

# Stage 3. Search algorithm robustness and performance

Цель этапа: сделать алгоритм подбора билдов более устойчивым к nested slots, conflicting items, adapters и будущему росту параметров.

## Commits

### 1. `refactor(calculator): model build search as candidate graph`

Сделать:

- Формализовать build search как обход candidate graph.
- Явно моделировать:
  - root weapon slots;
  - nested item slots;
  - allowed items;
  - conflicts;
  - already installed IDs;
  - branch validity;
  - accumulated stats;
  - accumulated price;
  - accumulated weight;
  - required features;
  - forbidden features.

- Убрать неявные side effects из scoring.
- Сделать branch result immutable или максимально близким к immutable.
- Подготовить pruning rules.
- Сохранить совместимый result shape для UI.

Результат:

- Calculator становится более корректным для сложных build chains.
- Будущие constraints легче добавлять.
- Search behavior становится проще объяснять и тестировать.

---

### 2. `perf(calculator): prune incompatible branches early`

Сделать:

- Рано отбрасывать branches, которые:
  - превышают hard max weight;
  - конфликтуют с уже выбранными items;
  - нарушают forbidden categories;
  - не могут выполнить required features;
  - дублируют unique item IDs;
  - используют несовместимые nested chains.

- Добавить diagnostic counters для debug/development mode:
  - evaluated branches;
  - pruned branches;
  - invalid branches;
  - selected branch score.

- Не показывать debug counters в основном UI без отдельного режима.

Результат:

- Более сложный search остаётся производительным.
- Debugging algorithm становится проще.

---

### 3. `feat(calculator): return top build alternatives`

Сделать:

- Подготовить возможность вернуть top-N alternatives.
- Для начала использовать top-N только внутренне или в debug/advanced result data.
- В result хранить:
  - score;
  - score breakdown;
  - satisfied constraints;
  - warnings/fallbacks;
  - selected parts.

- Не менять UI радикально в этом коммите.
- Сохранить single best build как основной результат.

Результат:

- Появляется база для сравнения билдов.
- В будущем пользователь сможет выбирать между альтернативами.

---

### 4. `test(calculator): add complex nested slot regression fixtures`

Сделать:

- Добавить fixtures для сложных chains:
  - muzzle adapter → suppressor;
  - mount → sight;
  - handguard → rail → foregrip/tactical;
  - mutually exclusive sights;
  - conflicting barrel/handguard options;
  - suppressor + sight + weight limit;
  - price mode + nested chain.

- Проверить корректность итоговых stats.
- Проверить отсутствие duplicate parts.
- Проверить correct warning/error behavior.
- Проверить hard constraints vs soft preferences.

Результат:

- Алгоритм защищён от регрессий на реалистичных случаях.
- Candidate graph/search changes становятся безопаснее.

---

### 5. `perf(calculator): move build generation to web worker`

Сделать:

- Вынести тяжёлый расчёт в Web Worker.
- Сохранить простой API вызова из Configurator.
- Добавить loading state.
- Добавить cancel/ignore stale result behavior.
- Обработать worker errors.
- Убедиться, что pure calculator tests остаются без browser worker dependency.
- Не смешивать worker migration с изменением algorithm behavior.

Результат:

- UI не зависает при сложных расчётах.
- Проект готов к более тяжёлой search model.

---

# Stage 4. Configurator UI/UX cleanup

Цель этапа: улучшить читаемость Configurator, разделить большой компонент на части и сделать результат расчёта более понятным.

## Commits

### 1. `refactor(ui): split configurator into focused components`

Сделать:

- Разделить Configurator на focused components:
  - `WeaponSummary`;
  - `BuildModeSelector`;
  - `AdvancedBuildOptions`;
  - `BuildResultSummary`;
  - `BuildPartsList`;
  - `BuildWarnings`;
  - `LoadingState`;
  - `ErrorState`.

- Оставить data flow в Configurator.
- Не менять calculation behavior.
- Не менять визуальный стиль радикально.
- Проверить lint/build.

Результат:

- Configurator проще читать и менять.
- UI изменения меньше затрагивают calculation logic.
- Дальнейшие controls проще добавлять без разрастания одного файла.

---

### 2. `feat(ui): add score breakdown to build result`

Сделать:

- Показывать пользователю, почему build выбран.
- Добавить compact breakdown:
  - recoil contribution;
  - ergonomics contribution;
  - price contribution;
  - weight contribution;
  - constraints satisfied;
  - warnings/fallbacks.

- Для простого режима показывать short summary.
- Для advanced/debug режима показывать больше деталей.
- Использовать данные calculator result, не пересчитывать score в UI.

Результат:

- Результат calculator становится объяснимым.
- Легче отлаживать спорные build choices.

---

### 3. `feat(ui): add home empty retry and api failure states`

Сделать:

- Добавить empty state для списка оружия.
- Добавить error state при ошибке загрузки weapons.
- Добавить retry action.
- Убрать silent console-only errors для user-facing сценариев.
- Сохранить loading state.
- Согласовать визуальный стиль с Configurator inline messages.

Результат:

- Пользователь получает понятную обратную связь.
- Приложение выглядит стабильнее при сетевых сбоях.

---

### 4. `style(ui): move inline styles to reusable classes`

Сделать:

- Постепенно вынести повторяющиеся inline styles в CSS classes.
- Сохранить текущий visual style.
- Не смешивать style cleanup с business logic.
- Подготовить reusable classes для:
  - panels/cards;
  - form groups;
  - buttons;
  - inline messages;
  - option grids;
  - stat rows;
  - result sections.

- Убрать наиболее шумные inline style blocks из Configurator и App.

Результат:

- JSX становится чище.
- UI проще поддерживать.
- Будущие компоненты легче стилизовать единообразно.

---

### 5. `feat(ui): persist all build preferences`

Сделать:

- Расширить текущий preferences storage.
- Сохранять локально последние выбранные options:
  - build mode;
  - suppressor mode;
  - price mode;
  - custom ergo target;
  - custom recoil target;
  - custom weights;
  - max weight;
  - required sight option;
  - required tactical device option.

- Использовать localStorage только для UI preferences.
- Добавить reset preferences action.
- Не сохранять временные calculation results как source of truth.
- Корректно обрабатывать устаревшие или invalid stored values.

Результат:

- Пользователь не настраивает одно и то же каждый раз.
- Settings flow готов к дальнейшему развитию.

---

# Stage 5. Data cache, reliability and API boundaries

Цель этапа: сделать работу с внешними данными более устойчивой, диагностируемой и удобной для пользователя.

## Commits

### 1. `feat(api): add persistent item cache with metadata`

Сделать:

- Добавить persistent cache для item/mod data.
- Хранить metadata:
  - source;
  - fetchedAt;
  - schemaVersion;
  - itemCount;
  - priceMode;
  - query/source version.

- Использовать in-memory cache поверх persistent cache.
- Добавить safe invalidation.
- Не использовать stale price data без visible warning.
- Поддержать отдельный cache по price mode.
- Не блокировать basic UI, если persistent cache повреждён.

Результат:

- Приложение меньше зависит от повторных API запросов.
- Пользователь видит, если данные могут быть устаревшими.
- Runtime cache получает устойчивое продолжение.

---

### 2. `feat(api): add manual data refresh action`

Сделать:

- Добавить кнопку refresh data.
- Показать loading state.
- Показать last updated timestamp.
- Обработать failure без потери старого cache, если он есть.
- Не блокировать basic UI при временной ошибке API.
- Обновлять cache metadata после успешного refresh.
- Показывать warning при использовании stale cached data.

Результат:

- Пользователь может обновить данные вручную.
- API failures становятся менее критичными.
- Data freshness становится видимой частью UX.

---

### 3. `test(api): add mocked JSON API response tests`

Сделать:

- Добавить tests для JSON API/data mappers.
- Использовать локальные fixtures.
- Проверить:
  - successful weapons response;
  - successful weapon details response;
  - successful mods response;
  - missing optional fields;
  - malformed data behavior;
  - price normalization;
  - PvP/PvE gameMode mapping;
  - fallback price fields.

- Не делать tests зависимыми от live API.

Результат:

- API/data layer получает защиту от schema-related regressions.
- Calculator получает более стабильный input.
- Будущие изменения queries/repository безопаснее.

---

## Recommended implementation order

Рекомендуемый порядок реализации:

1. Stage 1 — Calculation model specification and domain cleanup.
2. Stage 2 — Advanced scoring and user-controlled preferences.
3. Stage 3 — Search algorithm robustness and performance.
4. Stage 4 — Configurator UI/UX cleanup.
5. Stage 5 — Data cache, reliability and API boundaries.
6. Stage 6 — Developer workflow and release hygiene.

Пояснения:

- Stage 1 стоит делать первым, потому что calculator уже стабилизирован, но всё ещё монолитен.
- Stage 2 стоит делать после разделения domain boundaries, чтобы custom scoring не усложнял текущий файл.
- Stage 3 стоит делать после уточнения scoring model, потому что search algorithm должен обслуживать уже понятные constraints и weights.
- Stage 4 можно частично делать параллельно, но крупный UI cleanup лучше не смешивать с calculator refactor.
- Stage 5 логично делать после уточнения data needs и price behavior.

---

## Planned commits

Единый список актуальных запланированных коммитов:

1. `research(calculator): document extended scoring parameters`
2. `refactor(calculator): split domain module boundaries`
3. `refactor(calculator): introduce scoring profile model`
4. `refactor(calculator): normalize mod attributes for scoring`
5. `feat(calculator): add weighted custom scoring`
6. `feat(configurator): extend advanced calculation options`
7. `test(calculator): cover weighted scoring profiles`
8. `refactor(calculator): model build search as candidate graph`
9. `perf(calculator): prune incompatible branches early`
10. `feat(calculator): return top build alternatives`
11. `test(calculator): add complex nested slot regression fixtures`
12. `perf(calculator): move build generation to web worker`
13. `refactor(ui): split configurator into focused components`
14. `feat(ui): add score breakdown to build result`
15. `feat(ui): add home empty retry and api failure states`
16. `style(ui): move inline styles to reusable classes`
17. `feat(ui): persist all build preferences`
18. `feat(api): add persistent item cache with metadata`
19. `feat(api): add manual data refresh action`
20. `test(api): add mocked JSON API response tests`

---

## Deferred features

Эти задачи не входят в ближайшую дорожную карту, но могут быть добавлены позже:

- Сохранение пользовательских билдов.
- Export/import билдов.
- Shareable build URLs.
- Compare builds screen.
- Manual part override в Configurator.
- Lock selected part and recalculate rest.
- Exclude selected item from future builds.
- Favorite weapons.
- Recently configured weapons.
- Build presets.
- Player progression profile.
- Trader loyalty level constraints.
- Flea market availability constraints.
- Ammo-aware build recommendations.
- Full equipment loadout builder.
- Localization.
- Theme switcher.
- Mobile-first UI redesign.
- Backend/proxy layer для API normalization.
- Server-side cache.
- External price providers requiring API keys.
- Offline mode with bundled snapshot.
- Automated changelog generation.
- Automated release workflow.
- Visual regression tests.
- E2E tests for main user flow.
