# Документация Tarkov Gun Helper

Документация для разработчиков. Описание приложения для пользователей — в корневом [README](../README.md).

Tarkov Gun Helper — frontend-only приложение на React 19 и Vite 8. Сервера у проекта нет: данные о предметах и ценах загружаются в браузере напрямую из публичного JSON API [tarkov.dev](https://tarkov.dev/), расчёт билда выполняется в Web Worker, а сохранённые билды и настройки хранятся в `localStorage`. Сайт публикуется на GitHub Pages и устанавливается как PWA.

## Разделы

| Документ | О чём |
| --- | --- |
| [Быстрый старт](getting-started.md) | Установка, npm-скрипты, запуск, сборка и деплой |
| [Архитектура](architecture.md) | Слои, структура каталогов, маршруты, провайдеры, поток данных |
| [Слой данных и цены](data-layer.md) | Загрузка каталога из tarkov.dev, нормализация, кэширование, выбор цены, уровни торговцев |
| [Калькулятор билдов](calculator.md) | Режимы подбора, входные опции, алгоритм, формат результата, Web Worker |
| [Хранение и перенос билдов](storage.md) | Ключи `localStorage`, снимок сохранённого билда, формат экспорта/импорта |
| [Тестирование и CI](testing.md) | Unit-тесты на `node:test`, e2e на Playwright, фикстуры, GitHub Actions |
| [Правила разработки](contributing.md) | Локализация, иконки, стили, аналитика, чек-лист изменений |
| [Дорожная карта](development-roadmap.md) | План дальнейшей разработки |

## Коротко о главном

- **Точка входа:** [`src/main.jsx`](../src/main.jsx) → [`src/App.jsx`](../src/App.jsx).
- **Данные:** [`src/data/tarkovApi/repository.js`](../src/data/tarkovApi/repository.js) — единственное место, которое ходит в сеть за каталогом.
- **Расчёт билда:** [`calculateBestBuild`](../src/domain/calculator/orchestration.js) из `src/domain/calculator.js`, запускается в [`src/workers/buildCalculator.worker.js`](../src/workers/buildCalculator.worker.js).
- **Самая большая страница:** конфигуратор, [`src/features/configurator/ConfiguratorPage.jsx`](../src/features/configurator/ConfiguratorPage.jsx).
- **Проверка перед PR:** `npm test`, `npm run lint`, `npm run build`, при изменениях UI ещё и `npm run test:e2e`.
