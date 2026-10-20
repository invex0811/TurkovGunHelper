# Адреса страниц и статические страницы (SEO)

Сайт индексируется поисковиками: у каждой страницы свой обычный адрес (без `#`), а для каждого оружия при сборке создаётся статический HTML с заголовком, описанием и текстом. Поисковик получает их сразу, без выполнения JS; приложение загружается поверх и заменяет статический текст.

## Схема адресов

| Адрес | Что открывается | Статический файл |
| --- | --- | --- |
| `/` | Каталог оружия | `dist/index.html` |
| `/weapon/<slug>/` | Конфигуратор оружия | `dist/weapon/<slug>/index.html` |
| `/weapon/<slug>/?build=<id>` | Сохранённый билд этого оружия | тот же |
| `/builds/` | Сохранённые билды | `dist/builds/index.html` |
| `/builds?share=1.…` | Импорт билда по ссылке | GitHub Pages отвечает 301 на `/builds/?share=1.…` |
| `/module-comparison/` | Сравнение модулей | `dist/module-comparison/index.html` |
| `/settings/`, `/settings/#traders` | Настройки (с прокруткой к торговцам) | `dist/settings/index.html` |
| любой другой путь | Оболочка приложения | `dist/404.html` (копия `index.html`, статус 404) |

Канонические адреса заканчиваются на `/`: так их отдаёт GitHub Pages (адрес без слэша получает 301 со слэшем, query сохраняется). Ссылки внутри приложения ведут сразу на адрес со слэшем.

### Slug оружия

Slug — `normalizedName` оружия из tarkov.dev (`colt-m4a1-556x45-assault-rifle`). Его строит один модуль [`src/domain/weaponSlugs.js`](../src/domain/weaponSlugs.js), общий для приложения и скрипта сборки:

- `normalizedName` не локализуется, поэтому slug не зависит от языка;
- если у нескольких оружий одинаковый `normalizedName`, они упорядочиваются по `id`: первое получает чистый slug, остальные — `-2`, `-3`…; результат не зависит от порядка списка;
- оружие без `normalizedName` получает slug из своего `id`.

Внутри приложения (сохранённые билды, экспорт и импорт, ссылки на билды, `localStorage`) по-прежнему хранится `weapon.id`; slug нужен только для адреса. Приложение получает индекс slug ↔ id из того же каталога, что показывает главная (`loadWeaponSlugIndex()` в [`repository.js`](../src/data/tarkovApi/repository.js)), — отдельного запроса нет.

### Старые адреса

До перехода на `BrowserRouter` адреса были с хешем (`/#/builds?share=…`). Такие ссылки уже разосланы, поэтому они продолжают работать:

1. До запуска роутера [`redirectLegacyHashUrl()`](../src/features/routing/legacyHashUrl.js) в `main.jsx` переписывает адрес через `history.replaceState`: `#/builds?share=X` → `/builds/?share=X`, `#/settings#traders` → `/settings/#traders`, `#/configure/<id>?build=y` → `/configure/<id>?build=y`.
2. Маршрут `/configure/:weaponId` ([`LegacyConfigureRoute`](../src/features/routing/WeaponRoutes.jsx)) находит slug и делает `replace`-редирект на `/weapon/<slug>/`, сохраняя query, hash и `state` навигации. Если оружия нет в каталоге, конфигуратор открывается прямо по старому адресу, как раньше.
3. `/weapon/<id>/` (id вместо slug) тоже редиректит на правильный slug.

## Заголовки и мета-теги

Тексты заголовков и описаний лежат в одном месте — [`src/features/seo/pageMeta.js`](../src/features/seo/pageMeta.js). Их используют и приложение, и скрипт сборки, поэтому `title`, `description` и `canonical` после загрузки JS совпадают со статическим HTML.

- Страницы разделов: `useStaticRouteMeta()` в [`App.jsx`](../src/App.jsx) при смене пути вызывает [`applyPageMeta()`](../src/features/seo/documentMeta.js), который обновляет `<title>`, `description`, `canonical`, `og:*` и `twitter:*`.
- Страница оружия: [`WeaponRoute`](../src/features/routing/WeaponRoutes.jsx) ставит мета-теги, когда оружие найдено в каталоге. Название берётся из каталога на текущем языке.
- `index.html` содержит мета-теги главной, Open Graph, Twitter Card и JSON-LD `WebApplication`. JSON-LD остаётся только на главной.
- Картинка для превью ссылок — [`public/og-image.png`](../public/og-image.png) (1200×630). Её рисует `npm run og-image` ([`scripts/render-og-image.mjs`](../scripts/render-og-image.mjs)) в Chromium из Playwright; после изменения дизайна PNG нужно перегенерировать и закоммитить.

## Статическая генерация

`npm run build` = `vite build && node scripts/prerender.mjs`. Скрипт [`scripts/prerender.mjs`](../scripts/prerender.mjs):

1. Читает `dist/index.html` и проверяет, что в нём нет относительных путей (`./assets/…` сломались бы на `/weapon/<slug>/`).
2. Загружает список оружия из того же JSON API tarkov.dev, что и приложение (`regular/items` + `regular/items_en`), той же нормализацией и тем же фильтром `isBuildableWeapon()` ([`scripts/lib/weaponCatalog.mjs`](../scripts/lib/weaponCatalog.mjs)).
3. Для каждого оружия пишет `dist/weapon/<slug>/index.html`: свои `title`, `description`, `canonical`, `og:*`, `twitter:*` и статический блок внутри `#root` — `<h1>{Название} build</h1>`, два абзаца (тип, калибр, что можно сделать на странице) и ссылки на главную.
4. Пишет `index.html` для `/builds/`, `/module-comparison/`, `/settings/`, затем `404.html`, `sitemap.xml` (главная, `/builds/`, `/module-comparison/` и все страницы оружия) и `robots.txt`.

Замены в HTML ([`scripts/lib/prerenderHtml.mjs`](../scripts/lib/prerenderHtml.mjs)) требуют ровно одного совпадения: если шаблон `index.html` изменится и, например, пропадёт `<link rel="canonical">`, сборка упадёт, а не выпустит страницы с заголовком главной. Блок `#root` ограничен комментариями `<!--prerender-->…<!--/prerender-->`, JSON-LD — `<!--json-ld-->…<!--/json-ld-->`.

Статический блок использует те же классы, что приложение (`.topbar`, `.brand`, `.app__main`, `.page-title`), плюс `.prerender__main` в [`index.css`](../src/index.css), поэтому шапка и заголовок не прыгают, когда `createRoot()` заменяет блок. Небольшой inline-скрипт в `<head>` заранее ставит `data-theme` из `localStorage`, чтобы светлая тема не мигала тёмной.

### Снимок данных

Если tarkov.dev недоступен или вернул заметно меньше оружия, чем в снимке (меньше 90%), скрипт берёт закоммиченный [`scripts/data/weapons-snapshot.json`](../scripts/data/weapons-snapshot.json) и пишет об этом в лог. Сборка не падает и не теряет страницы.

```bash
npm run weapons:snapshot
```

Команда перезаписывает снимок свежими данными (id, `normalizedName`, название, калибр, тип). Обновляйте и коммитьте его, когда в игре появляется новое оружие.

```bash
PRERENDER_OFFLINE=1 node scripts/prerender.mjs
```

Так страницы строятся только из снимка, без сети (после `vite build`).

## Service worker

- `navigateFallback: '/index.html'` — оболочка отвечает на любой адрес и офлайн; `sitemap.xml` и `robots.txt` исключены (`navigateFallbackDenylist`).
- Статические страницы создаются после `vite build`, поэтому в precache не попадают: у пользователя с установленным service worker все адреса открывает `index.html`, а мета-теги ставит приложение.
- `start_url` и `scope` манифеста — `/`.
