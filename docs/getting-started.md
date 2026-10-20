# Быстрый старт

## Требования

- **Node.js 20.19+** или **22.12+** (минимум для Vite 8; CI использует Node 20).
- **npm** (в репозитории лежит `package-lock.json`, поэтому ставьте зависимости через `npm ci`).
- Доступ в интернет к `json.tarkov.dev`: без него приложение запустится, но каталог оружия загрузится только из ранее сохранённого кэша.

Переменных окружения и API-ключей проекту не нужно — tarkov.dev отдаёт данные публично.

## Установка и запуск

```bash
npm ci
```

```bash
npm run dev
```

Dev-сервер Vite поднимается на `http://localhost:5173`. Навигация построена на `BrowserRouter`, адреса страниц обычные: `http://localhost:5173/weapon/<slug>/` (см. [Адреса страниц и SEO](seo.md)). Dev-сервер отдаёт `index.html` на любой путь, статические страницы оружия есть только в production-сборке.

## npm-скрипты

| Скрипт | Что делает |
| --- | --- |
| `npm run dev` | Dev-сервер Vite с HMR |
| `npm run build` | Production-сборка в `dist/` (включая service worker и манифест PWA), затем статические страницы оружия, `404.html`, `sitemap.xml` и `robots.txt` ([`scripts/prerender.mjs`](../scripts/prerender.mjs)) |
| `npm run preview` | Локальный сервер для уже собранного `dist/` |
| `npm test` | Unit-тесты через встроенный раннер Node (`node --test`) |
| `npm run test:e2e` | E2E-тесты Playwright (сам собирает проект и запускает `preview` на порту 4173) |
| `npm run lint` | ESLint по всему проекту |
| `npm run icons` | Скачивает подмножество шрифта Material Symbols для иконок из `src/ui/materialSymbolNames.js` |
| `npm run weapons:snapshot` | Обновляет `scripts/data/weapons-snapshot.json` — список оружия, из которого строятся страницы, если tarkov.dev недоступен |
| `npm run og-image` | Перерисовывает `public/og-image.png` (картинка превью ссылок) в Chromium из Playwright |
| `npm run deploy` | Ручной деплой `dist/` в ветку `gh-pages` (обычно не нужен — см. ниже) |

Перед первым запуском e2e установите браузер Playwright:

```bash
npx playwright install chromium
```

## Сборка

`vite.config.js` задаёт `base: '/'`: ассеты подключаются по абсолютным путям (`/assets/…`), поэтому грузятся и со вложенных страниц вроде `/weapon/<slug>/`. Сайт должен лежать в корне домена (`tarkovgunhelper.com`); старый адрес `invex0811.github.io/TurkovGunHelper/…` GitHub перенаправляет на домен без префикса.

После `vite build` скрипт [`scripts/prerender.mjs`](../scripts/prerender.mjs) создаёт статические страницы — см. [Адреса страниц и SEO](seo.md#статическая-генерация). Ему нужен доступ к `json.tarkov.dev`; без сети он берёт закоммиченный снимок, и сборка не падает.

Плагин `vite-plugin-pwa` генерирует service worker (Workbox) и манифест:

- `start_url` и `scope` — `/`, `navigateFallback` — `/index.html`: оболочка отвечает на любой адрес и офлайн (кроме `sitemap.xml` и `robots.txt`).
- `registerType: 'prompt'` — новая версия не активируется сама; пользователь видит баннер [`PwaUpdatePrompt`](../src/features/pwa/PwaUpdatePrompt.jsx) и обновляется по кнопке.
- В precache попадают `js`, `css`, `html` и `woff2`. Шрифты Google Fonts кэшируются во время работы.
- Данные tarkov.dev service worker **не** кэширует — для них есть собственный кэш в IndexedDB (см. [Слой данных](data-layer.md#кэширование)).

## Деплой

Деплой автоматический: каждый push в `main` запускает [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), который собирает проект (вместе со статическими страницами) и публикует `dist/` через GitHub Pages Actions. Тесты при деплое не повторяются: они проходят в CI на pull request (см. [Тестирование и CI](testing.md#cicd)).

Публичный адрес: <https://tarkovgunhelper.com/>.

## Отладка

- **Состояние каталога** показывает индикатор в шапке ([`CatalogStatus`](../src/features/dataStatus/CatalogStatus.jsx)): свежие данные, устаревшие, офлайн или ошибка обновления. По клику каталог перезагружается принудительно.
- **Сбросить кэш каталога:** DevTools → Application → IndexedDB → база `tarkov-gun-helper`, хранилище `catalogs`.
- **Сбросить настройки и билды:** DevTools → Application → Local Storage, ключи `tarkovGunHelper.*` и `tarkov-gun-helper:saved-builds` (полный список — в [Хранение](storage.md#localstorage)).
- **Предупреждения в консоли** в dev-режиме: недоступность IndexedDB и иконки, которых нет в подмножестве шрифта.
- **Аналитика** в dev-режиме не отправляется: Umami подключается только на `tarkovgunhelper.com`.

## Каталог `research/`

`research/calculator/` — старые экспериментальные скрипты для ручной проверки сценариев калькулятора. Они не входят в сборку, тесты и линтинг (`eslint.config.js` их игнорирует) и могут не соответствовать текущему коду.
