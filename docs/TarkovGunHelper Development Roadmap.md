# TarkovGunHelper Development Roadmap

Документ описывает черновую дорожную карту дальнейшей разработки проекта TarkovGunHelper после проверки текущего baseline.

RoadMap фиксирует текущее состояние проекта как рабочую отправную точку и группирует дальнейшие задачи по этапам: стабилизация калькулятора, конфигурация источника цен, расширение модели расчёта билдов, улучшение UI/UX, кэширование данных, документация и developer workflow.

---

## Architectural direction

Проект развивается как frontend-only React/Vite приложение для подбора билдов оружия Escape from Tarkov.

Целевая архитектура:

- **UI layer** отвечает только за отображение, пользовательский ввод и навигацию.
- **API/data layer** отвечает за загрузку данных из внешних источников.
- **Domain/calculation layer** отвечает за расчёт билдов, constraints, scoring и итоговую структуру результата.
- **Tests layer** фиксирует ожидаемое поведение калькулятора и критичных data-transform сценариев.
- UI не должен содержать сложную business logic расчёта билдов.
- Калькулятор не должен зависеть от React, DOM или browser state.
- Источник цен должен быть явной частью конфигурации, а не неявным полем внутри данных item.
- PvP/PvE price mode должен быть выбран пользователем или настройкой приложения.
- Budget/scoring logic должна получать уже нормализованную price model.
- Hard constraints должны обрабатываться как обязательные условия валидности билда, а не как большие score-бонусы.
- Optional preferences должны влиять на scoring, но не подменять hard constraints.
- Алгоритм выбора модов должен постепенно уходить от простого greedy-подхода к более явной модели candidate graph / branch plan.
- Любое новое поведение калькулятора должно сопровождаться regression tests.
- Потенциально тяжёлые расчёты должны быть подготовлены к выносу из UI thread.
- Документация проекта должна быть достаточной для нового разработчика без опыта с JS/Vite.

Основная цель дальнейшей разработки — превратить текущий MVP в стабильный инструмент подбора билдов с предсказуемым алгоритмом, конфигурируемым источником цен и расширяемой scoring-моделью.

---

## Current baseline

На текущий момент проект содержит:

- React/Vite frontend application.
- HashRouter-based navigation.
- Главную страницу со списком оружия.
- Страницу конфигуратора оружия.
- API layer для работы с внешним GraphQL API.
- Calculator layer для подбора модов оружия.
- Unit tests для calculator logic.
- ESLint configuration.
- Production build через Vite.
- GitHub Pages deploy script.

Подтверждённый локальный baseline:

- `npm.cmd ci` успешно устанавливает зависимости.
- `npm.cmd run dev` успешно запускает dev server.
- `npm.cmd run lint` проходит без ошибок.
- `npm.cmd run build` успешно собирает production bundle.
- `npm.cmd test` запускает calculator tests.
- Текущее состояние тестов: 7 passed / 1 failed.

Известная failing regression:

- `requireSuppressor installs a compatible silencer`.

Смысл проблемы:

- При `requireSuppressor: true` итоговый build должен содержать совместимый `Silencer`.
- Сейчас calculator не гарантирует попадание suppressor в итоговый build.
- Это core-logic bug, а не проблема окружения, сборки или линтера.

Текущие ограничения проекта:

- Calculator использует слишком greedy-подход для задачи с nested slots, adapters и conflicting items.
- `requireSuppressor` фактически работает недостаточно строго.
- Suppressor mode в UI/logic требует уточнения: allow / forbid / require.
- Price source пока не является явной пользовательской настройкой.
- Budget mode зависит от текущей price model без явного выбора PvP/PvE.
- API cache существует только на уровне runtime memory.
- UI error handling минимальный.
- README остаётся недостаточным для нового разработчика.
- В проекте есть fixture/research файлы, которые стоит структурировать аккуратнее.

---

## RoadMap priorities

Актуальные приоритеты дальнейшей разработки:

1. Стабилизировать calculator baseline и получить полностью зелёные тесты.
2. Сделать suppressor behavior явным и предсказуемым.
3. Подготовить calculator к более сложным constraints и nested slot chains.
4. Добавить возможность конфигурации PvP/PvE источника цен.
5. Исследовать доступные источники PvE price data и ограничения внешних API.
6. Нормализовать price model для budget/scoring расчётов.
7. Исследовать и постепенно расширить набор параметров, влияющих на расчёт билдов.
8. Разделить UI, API и calculation responsibilities более явно.
9. Улучшить UX ошибок, warning states и explainability результата.

---

# Stage 0. Baseline stabilization and first calculator fix

Цель этапа: привести проект к стабильной отправной точке, где dev/lint/build/test проходят полностью, а известный suppressor bug исправлен.

## Commits

### 1. `fix(calculator): enforce required suppressor builds`

Сделать:

- Исправить failing test `requireSuppressor installs a compatible silencer`.
- Рассматривать `requireSuppressor` как hard constraint.
- Не считать билд валидным, если suppressor обязателен, но не установлен.
- Не решать проблему только большим score-бонусом.
- Проверять наличие suppressor по категории `Silencer`.
- Учитывать suppressor, установленный через nested slot / adapter chain.
- При невозможности собрать compatible suppressor build возвращать controlled warning/error result.
- Сохранить текущее поведение для `forbidSuppressor`.

Результат:

- `npm.cmd test` проходит полностью.
- Suppressor requirement становится реальным constraint.
- Текущий baseline становится пригодным для дальнейшей разработки.

---

### 2. `refactor(calculator): return selected branch plan from evaluator`

Сделать:

- Переработать evaluator так, чтобы он возвращал не только score, но и конкретный набор выбранных parts.

- Устранить расхождение между “веткой, которую algorithm оценил” и “деталями, которые реально попали в build”.

- Ввести промежуточную структуру результата branch evaluation:
  - `score`;
  - `items`;
  - `statsDelta`;
  - `hasSuppressor`;
  - `hasSight`;
  - `conflicts`;
  - `isValid`;
  - `warnings`.

- Подготовить evaluator к constraints, которые зависят от всей цепочки выбранных модов.

Результат:

- Calculator становится предсказуемее.
- Nested slot choices больше не теряются между scoring и build construction.
- Будущие constraints проще добавлять и тестировать.

---

### 3. `test(calculator): cover suppressor chains and impossible constraints`

Сделать:

- Добавить regression tests для suppressor scenarios:
  - suppressor required and available directly;
  - suppressor required through adapter/muzzle chain;
  - suppressor required but impossible;
  - suppressor forbidden;
  - suppressor optional;
  - suppressor conflicts with another selected part.

- Добавить тесты для warning/error behavior.

- Зафиксировать expected result structure для impossible build.

- Убедиться, что budget/meta/min_recoil/max_ergo modes продолжают работать.

Результат:

- Suppressor behavior закреплён тестами.
- Будущие изменения calculator не смогут случайно сломать этот сценарий.

---

### 4. `refactor(configurator): split suppressor mode options`

Сделать:

- Заменить неоднозначную boolean-модель suppressor settings на явный mode:
  - `allow`;
  - `forbid`;
  - `require`.

- Обновить UI controls в Configurator.

- Обновить mapping UI options → calculator options.

- Не превращать “не require suppressor” в автоматический запрет suppressor.

- Добавить понятные подписи для пользователя:
  - Allow suppressors;
  - Forbid suppressors;
  - Require suppressor.

- Сохранить backward-compatible defaults.

Результат:

- Поведение suppressor становится понятным.
- Пользователь может разрешить suppressor без обязательного требования.
- Calculator получает более точные options.

---

### 5. `feat(ui): show build warnings and calculation errors inline`

Сделать:

- Заменить `alert`-подход на inline error/warning state в Configurator.

- Показывать controlled message, если build невозможно собрать.

- Показывать warning, если часть пользовательских constraints была недостижима.

- Разделить:
  - API loading error;
  - missing weapon data;
  - calculation error;
  - impossible constraints;
  - empty build result.

- Добавить визуальный блок warning/error над результатом билда.

Результат:

- Пользователь понимает, почему билд не собран.
- Ошибки calculator становятся видимыми и диагностируемыми.
- UI готов к будущим constraints.

---

### 6. `chore(repo): organize calculator fixtures and research scripts`

Сделать:

- Перенести test fixtures в `tests/fixtures`.
- Отделить research/debug scripts от production source.
- Убедиться, что test fixtures не используются runtime UI.
- Обновить test imports.
- Проверить `npm.cmd test`.
- Проверить `npm.cmd run lint`.
- Проверить `npm.cmd run build`.

Результат:

- Корень проекта становится чище.
- Тестовые данные отделены от application source.
- Новому разработчику проще ориентироваться в репозитории.

---

### 7. `docs: replace vite template readme`

Сделать:

- Описать назначение проекта.

- Описать tech stack:
  - Vite;
  - React;
  - React Router;
  - Node test runner;
  - ESLint.

- Добавить setup instructions для Windows/PowerShell:
  - `npm.cmd ci`;
  - `npm.cmd run dev`;
  - `npm.cmd test`;
  - `npm.cmd run lint`;
  - `npm.cmd run build`.

- Добавить troubleshooting:
  - PowerShell execution policy;
  - `#` in project path;
  - dependency install issues.

- Описать структуру проекта.

- Описать текущие ограничения calculator.

- Описать known data/API assumptions.

Результат:

- Проект становится удобнее для нового разработчика.
- Базовые проблемы запуска документированы.

---

# Stage 1. Price source configuration and data foundation

Цель этапа: добавить явную конфигурацию источника цен, подготовить поддержку PvP/PvE price mode и убрать жёсткую зависимость budget scoring от одного неявного поля цены.

## Research goals

Перед реализацией необходимо выяснить:

- Какие price fields доступны в текущем GraphQL API.
- Есть ли надёжный PvE price source в текущем API.
- Нужно ли подключать отдельный provider для PvE цен.
- Как часто обновляются цены.
- Есть ли metadata freshness/update timestamp.
- Какой fallback использовать, если выбранный price source недоступен.
- Можно ли использовать trader prices как fallback.
- Нужно ли показывать пользователю source/freshness рядом с итоговой ценой билда.

---

## Commits

### 1. `research(data): evaluate pvp and pve price sources`

Сделать:

- Изучить текущие поля item price data.

- Проверить наличие или отсутствие PvE-specific price fields.

- Проверить альтернативные источники PvE цен.

- Описать ограничения каждого источника:
  - доступность;
  - бесплатность;
  - необходимость API key;
  - freshness;
  - rate limits;
  - CORS;
  - стабильность схемы;
  - legal/ToS considerations.

- Зафиксировать вывод в `docs/price-sources.md`.

- Не менять runtime logic в этом коммите.

Результат:

- Принято осознанное решение, откуда брать PvP/PvE цены.
- RoadMap по ценам не опирается на неподтверждённые API assumptions.

---

### 2. `refactor(api): introduce item data repository`

Сделать:

- Ввести промежуточный data access layer поверх raw API functions.
- Отделить GraphQL queries от потребностей UI/calculator.
- Подготовить normalized item shape.
- Скрыть API-specific field names внутри repository/mapper.
- Сохранить текущие публичные функции или добавить совместимые wrappers.
- Не менять calculator behavior.

Результат:

- UI и calculator меньше зависят от конкретной схемы внешнего API.
- Добавление альтернативного price source становится проще.

---

### 3. `refactor(data): normalize mod price model`

Сделать:

- Ввести явную структуру цены:
  - `value`;
  - `currency`;
  - `mode`;
  - `source`;
  - `fallbackUsed`;
  - `updatedAt`;
  - `confidence`.

- Поддержать fallback, если цена недоступна.

- Не смешивать raw API fields и normalized calculator input.

- Обновить budget scoring так, чтобы он работал через normalized price.

- Сохранить текущие результаты там, где данные совпадают.

Результат:

- Budget mode становится независимым от одного конкретного API-поля.
- Появляется основа для PvP/PvE переключения.

---

### 4. `feat(settings): add price mode selector`

Сделать:

- Добавить настройку price mode:
  - PvP;
  - PvE;
  - Auto/fallback, если потребуется после research.

- Добавить UI control в Configurator или общий settings area.

- Сохранять выбор пользователя локально.

- Применять выбранный mode при генерации билда.

- Показывать текущий mode рядом с итоговой ценой.

- Не ломать default behavior для существующих пользователей.

Результат:

- Пользователь может явно выбрать, какие цены использовать для расчёта.
- Budget builds становятся более прозрачными.

---

### 5. `feat(api): support configurable price provider`

Сделать:

- Добавить abstraction для price provider.
- Поддержать текущий источник как default provider.
- Добавить PvE provider, если research подтвердит доступный источник.
- Если PvE provider недоступен — добавить controlled fallback.
- Возвращать diagnostic metadata по цене.
- Не позволять calculator silently использовать неправильный price mode.

Результат:

- Price data становится конфигурируемым.
- Проект готов к нескольким источникам данных.

---

### 6. `feat(calculator): use selected price mode in budget scoring`

Сделать:

- Передавать выбранный price mode в calculator input.
- Использовать normalized price для budget score.
- Добавить fallback behavior для missing price.
- Добавить warnings, если часть build price рассчитана по fallback.
- Убедиться, что non-budget modes не ломаются.

Результат:

- Budget mode учитывает выбранный пользователем источник цен.
- Итоговый build может объяснить, какие цены использовались.

---

### 7. `test(data): add price mode fixtures`

Сделать:

- Добавить fixtures для:
  - PvP price available;
  - PvE price available;
  - selected price missing;
  - fallback price used;
  - mixed source build.

- Добавить tests для normalized price mapper.

- Добавить tests для budget scoring с разными price modes.

- Проверить, что отсутствующая цена не ломает build generation.

Результат:

- Price source behavior покрыт тестами.
- Budget mode становится безопаснее для дальнейших изменений.

---

### 8. `feat(ui): show price source and fallback warnings`

Сделать:

- В result summary показывать:
  - selected price mode;
  - total price;
  - source/fallback info;
  - warning при mixed/fallback prices.

- В списке parts показывать цену детали из выбранного source.

- Если цена отсутствует, показывать аккуратный placeholder.

- Не перегружать UI техническими деталями.

Результат:

- Пользователь понимает, откуда взялась стоимость билда.
- PvP/PvE переключение становится visible feature, а не скрытой настройкой.

---

# Stage 2. Build calculation model research

Цель этапа: исследовать возможность учёта большего количества параметров при расчёте сборок и подготовить calculator к расширяемой scoring model.

## Research goals

Исследовать, какие параметры реально можно учитывать:

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
- ammo compatibility, если данные доступны;
- trader availability;
- flea availability;
- unlock level;
- trader loyalty level;
- build availability by player progression;
- suppressor preference;
- loud/quiet build mode;
- recoil vs ergo balance;
- price/performance ratio;
- weight limit;
- required/forbidden categories;
- required/forbidden item IDs;
- aesthetic/manual overrides, если появятся user-defined builds.

Не все параметры должны быть реализованы сразу. Цель этапа — разделить:

- доступные сейчас;
- доступные после изменения API query;
- доступные только через другой data provider;
- слишком дорогие/сложные для ближайшей версии;
- нецелесообразные для MVP.

---

## Commits

### 1. `research(calculator): document extended scoring parameters`

Сделать:

- Создать `docs/calculation-model.md`.

- Описать текущую scoring model.

- Описать текущие calculator modes:
  - meta;
  - max_ergo;
  - min_recoil;
  - budget;
  - custom.

- Составить таблицу candidate parameters.

- Для каждого параметра указать:
  - gameplay value;
  - source data;
  - data reliability;
  - implementation complexity;
  - impact on algorithm;
  - testability.

- Отдельно описать hard constraints и soft preferences.

Результат:

- Появляется понятная спецификация будущего calculator.
- Новые параметры не добавляются хаотично.

---

### 2. `refactor(calculator): introduce scoring profile model`

Сделать:

- Ввести структуру `scoringProfile`.

- Перенести текущие mode-specific веса в явную модель.

- Разделить:
  - hard constraints;
  - soft weights;
  - required features;
  - forbidden features;
  - fallback policy.

- Сохранить текущее поведение modes.

- Добавить tests, подтверждающие backward compatibility.

Результат:

- Calculator modes становятся данными, а не набором разрозненных условий.
- Custom mode проще расширять.

---

### 3. `refactor(calculator): normalize mod attributes for scoring`

Сделать:

- Ввести normalized attributes для mods:
  - ergonomicsDelta;
  - recoilDelta;
  - accuracyDelta;
  - weight;
  - price;
  - categories;
  - conflicts;
  - slots;
  - availability metadata, если есть.

- Скрыть raw API structure за mapper.

- Упростить scoring function.

- Добавить tests для mapper.

Результат:

- Calculator становится меньше завязан на внешнюю схему данных.
- Новые параметры проще подключать.

---

### 4. `feat(calculator): add weighted custom scoring`

Сделать:

- Расширить custom mode.

- Разрешить пользователю настраивать веса:
  - recoil;
  - ergonomics;
  - price;
  - weight;
  - accuracy.

- Задать безопасные min/max ranges.

- Добавить reset to default.

- Не добавлять слишком много controls без группировки.

Результат:

- Пользователь может гибче управлять расчётом.
- Calculator получает первый практический шаг к расширяемой scoring model.

---

### 5. `feat(configurator): add advanced calculation options`

Сделать:

- Добавить collapsible Advanced section.

- Перенести туда расширенные параметры.

- Поддержать:
  - max weight;
  - suppressor mode;
  - price mode;
  - custom weights;
  - optional required sight;
  - optional required tactical device.

- Не перегружать основной экран.

- Сохранять default flow простым.

Результат:

- Новые параметры становятся доступны без ухудшения UX для базового сценария.

---

### 6. `test(calculator): cover weighted scoring profiles`

Сделать:

- Добавить tests для scoring profiles.
- Проверить, что увеличение веса recoil реально меняет предпочтения.
- Проверить, что hard constraints сильнее soft weights.
- Проверить fallback behavior при отсутствующих данных.
- Проверить custom weights edge cases.

Результат:

- Расширенная scoring model становится безопасной для изменений.

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
  - accumulated stats.

- Убрать неявные side effects из scoring.

- Сделать branch result immutable или максимально близким к immutable.

- Подготовить pruning rules.

Результат:

- Calculator становится более корректным для сложных build chains.
- Будущие constraints легче добавлять.

---

### 2. `perf(calculator): prune incompatible branches early`

Сделать:

- Рано отбрасывать branches, которые:
  - превышают hard max weight;
  - конфликтуют с уже выбранными items;
  - нарушают forbidden categories;
  - не могут выполнить required features;
  - дублируют unique item IDs.

- Добавить diagnostic counters для debug режима:
  - evaluated branches;
  - pruned branches;
  - selected branch score.

Результат:

- Более сложный search остаётся производительным.
- Debugging algorithm становится проще.

---

### 3. `feat(calculator): return top build alternatives`

Сделать:

- Вместо одного build result подготовить возможность вернуть top-N alternatives.
- Для начала использовать top-N только внутренне или в debug mode.
- В result хранить reasons/score breakdown.
- Не менять UI радикально в этом коммите.

Результат:

- Появляется база для сравнения билдов.
- Пользователь в будущем сможет выбирать между альтернативами.

---

### 4. `perf(calculator): move build generation to web worker`

Сделать:

- Вынести тяжёлый расчёт в Web Worker.
- Сохранить простой API вызова из Configurator.
- Добавить loading/cancel state.
- Обработать worker errors.
- Убедиться, что tests для pure calculator остаются без browser worker dependency.

Результат:

- UI не зависает при сложных расчётах.
- Проект готов к более тяжёлой search model.

---

### 5. `test(calculator): add complex nested slot regression fixtures`

Сделать:

- Добавить fixtures для сложных chains:
  - muzzle adapter → suppressor;
  - mount → sight;
  - handguard → rail → foregrip/tactical;
  - mutually exclusive sights;
  - conflicting barrel/handguard options.

- Проверить корректность итоговых stats.

- Проверить отсутствие duplicate parts.

- Проверить correct warning behavior.

Результат:

- Алгоритм защищён от регрессий на реалистичных случаях.

---

# Stage 4. Configurator UI/UX cleanup

Цель этапа: улучшить читаемость Configurator, разделить большой компонент на части и сделать результат расчёта более понятным.

## Commits

### 1. `refactor(ui): split configurator into focused components`

Сделать:

- Разделить Configurator на компоненты:
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

- Проверить lint/build.

Результат:

- Configurator проще читать и менять.
- UI изменения меньше затрагивают calculation logic.

---

### 2. `feat(ui): add score breakdown to build result`

Сделать:

- Показывать пользователю, почему build выбран.

- Добавить breakdown:
  - recoil contribution;
  - ergonomics contribution;
  - price contribution;
  - weight contribution;
  - constraints satisfied;
  - warnings/fallbacks.

- Для простого режима показывать compact summary.

- Для advanced/debug режима показывать больше деталей.

Результат:

- Результат калькулятора становится объяснимым.
- Легче отлаживать спорные build choices.

---

### 3. `feat(ui): add empty states and api failure states`

Сделать:

- Добавить empty state для списка оружия.
- Добавить error state при ошибке загрузки weapons.
- Добавить error state при ошибке загрузки weapon details.
- Добавить retry action.
- Убрать silent console-only errors для user-facing сценариев.

Результат:

- Пользователь получает понятную обратную связь.
- Приложение выглядит стабильнее при сетевых сбоях.

---

### 4. `style(ui): move inline styles to reusable classes`

Сделать:

- Постепенно вынести повторяющиеся inline styles в CSS classes.
- Сохранить текущий visual style.
- Не смешивать style cleanup с business logic.
- Подготовить tokens/utility classes для повторяющихся panels/cards/buttons.

Результат:

- JSX становится чище.
- UI проще поддерживать.

---

### 5. `feat(ui): persist user build preferences`

Сделать:

- Сохранять локально последние выбранные options:
  - build mode;
  - suppressor mode;
  - price mode;
  - custom weights;
  - max weight.

- Использовать localStorage только для UI preferences.

- Добавить reset preferences action.

- Не сохранять временные calculation results как source of truth.

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
  - priceMode, если применимо.

- Использовать in-memory cache поверх persistent cache.

- Добавить safe invalidation.

- Не использовать stale price data без visible warning.

Результат:

- Приложение меньше зависит от повторных API запросов.
- Пользователь видит, если данные могут быть устаревшими.

---

### 2. `feat(api): add manual data refresh action`

Сделать:

- Добавить кнопку refresh data.
- Показать loading state.
- Показать last updated timestamp.
- Обработать failure без потери старого cache, если он есть.
- Не блокировать basic UI при временной ошибке API.

Результат:

- Пользователь может обновить данные вручную.
- API failures становятся менее критичными.

---

### 3. `refactor(api): isolate graphql query definitions`

Сделать:

- Вынести GraphQL query strings в отдельный модуль.
- Добавить понятные names для queries.
- Упростить `api.js`.
- Подготовить tests/mocks для API layer.

Результат:

- API layer становится легче поддерживать.
- Изменения схемы API проще локализовать.

---

### 4. `test(api): add mocked graphql response tests`

Сделать:

- Добавить tests для data mappers.
- Использовать локальные fixtures.
- Проверить missing optional fields.
- Проверить malformed data behavior.
- Проверить price normalization.

Результат:

- API/data layer получает защиту от schema-related regressions.
- Calculator получает более стабильный input.

---

## Recommended implementation order

Рекомендуемый порядок реализации:

1. Stage 0 — Baseline stabilization and first calculator fix.
2. Stage 1 — Price source configuration and data foundation.
3. Stage 2 — Build calculation model research.
4. Stage 3 — Search algorithm robustness and performance.
5. Stage 4 — Configurator UI/UX cleanup.
6. Stage 5 — Data cache, reliability and API boundaries.

Stage 0 стоит сделать первым, потому что нельзя развивать calculator поверх failing regression.

Stage 1 стоит делать до полноценного budget/scoring расширения, потому что цена является одним из ключевых параметров расчёта.

Stage 2 стоит делать до больших алгоритмических изменений, чтобы заранее понять, какие параметры действительно имеют смысл.

Stage 3 стоит делать после уточнения scoring model, потому что более сложный search algorithm должен обслуживать уже понятные constraints и weights.

Stage 4 можно частично делать параллельно, но крупный UI cleanup лучше не смешивать с изменениями calculator.

Stage 5 логично делать после уточнения data needs.

---

## Planned commits

Единый список актуальных запланированных коммитов:

1. `fix(calculator): enforce required suppressor builds`
2. `refactor(calculator): return selected branch plan from evaluator`
3. `test(calculator): cover suppressor chains and impossible constraints`
4. `refactor(configurator): split suppressor mode options`
5. `feat(ui): show build warnings and calculation errors inline`
6. `chore(repo): organize calculator fixtures and research scripts`
7. `docs: replace vite template readme`
8. `research(data): evaluate pvp and pve price sources`
9. `refactor(api): introduce item data repository`
10. `refactor(data): normalize mod price model`
11. `feat(settings): add price mode selector`
12. `feat(api): support configurable price provider`
13. `feat(calculator): use selected price mode in budget scoring`
14. `test(data): add price mode fixtures`
15. `feat(ui): show price source and fallback warnings`
16. `research(calculator): document extended scoring parameters`
17. `refactor(calculator): introduce scoring profile model`
18. `refactor(calculator): normalize mod attributes for scoring`
19. `feat(calculator): add weighted custom scoring`
20. `feat(configurator): add advanced calculation options`
21. `test(calculator): cover weighted scoring profiles`
22. `refactor(calculator): model build search as candidate graph`
23. `perf(calculator): prune incompatible branches early`
24. `feat(calculator): return top build alternatives`
25. `perf(calculator): move build generation to web worker`
26. `test(calculator): add complex nested slot regression fixtures`
27. `refactor(ui): split configurator into focused components`
28. `feat(ui): add score breakdown to build result`
29. `feat(ui): add empty states and api failure states`
30. `style(ui): move inline styles to reusable classes`
31. `feat(ui): persist user build preferences`
32. `feat(api): add persistent item cache with metadata`
33. `feat(api): add manual data refresh action`
34. `refactor(api): isolate graphql query definitions`
35. `test(api): add mocked graphql response tests`

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
