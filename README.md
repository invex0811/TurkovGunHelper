# Tarkov Gun Helper

Tarkov Gun Helper is a frontend-only React/Vite application for finding weapon builds for Escape from Tarkov.

The project is currently an MVP / work in progress. It provides a weapon list, a weapon configurator, integration with the tarkov.dev JSON API, and a domain-level calculator that selects compatible weapon parts according to selected build goals.

## Current status

The project currently includes:

- React/Vite frontend application.
- HashRouter-based navigation.
- Main weapon list page.
- Weapon configurator page.
- External JSON API integration with timeout, cancellation, translations, and short-lived in-memory caching.
- Domain calculator for weapon build generation.
- Calculator and API unit tests.
- Local fixtures for calculator regression tests.
- Research scripts for manual API/calculator experiments.
- ESLint configuration.
- Production build via Vite.
- GitHub Pages deploy script.

## Tech stack

- Vite
- React
- React Router
- Node.js test runner
- ESLint
- GitHub Pages / gh-pages

## Setup

Recommended setup on Windows / PowerShell:

```bash
npm.cmd ci
```

Start the local development server:

```bash
npm.cmd run dev
```

Vite will print the local development URL in the terminal.

## Available scripts

```bash
npm.cmd run dev
```

Starts the local Vite development server.

```bash
npm.cmd test
```

Runs unit tests through the Node.js test runner.

```bash
npm.cmd run lint
```

Runs ESLint for supported source and test files.

```bash
npm.cmd run build
```

Builds the production bundle.

```bash
npm.cmd run preview
```

Previews the production build locally.

```bash
npm.cmd run deploy
```

Builds the app and deploys the `dist` directory through `gh-pages`.

## Project structure

Current structure:

```text
docs/
  development-roadmap.md

research/
  calculator/
    test_*.js

src/
  data/
    tarkovApi/
      client.js
      itemMapper.js
      repository.js
      translations.js

  domain/
    calculator.js

  pages/
    Home.jsx
    Configurator.jsx

  workers/
    buildCalculator.worker.js

tests/
  calculator/
    calculator.test.js

  data/
    tarkovApi.test.js

  fixtures/
    mods.json
    weapon.json
```

### Main areas

`src/pages` contains application pages.

`src/data/tarkovApi` contains the JSON GET client, repository, item adapter, and translation mapper.

`src/domain` contains domain-level calculation logic. The calculator should not depend on React, DOM state, or browser UI concerns.

`tests` contains supported automated tests and local fixtures.

`research` contains manual scripts and experiments. Research scripts are not part of the normal test or lint workflow.

`docs` contains project planning and development documentation.

## Development workflow

Before committing changes, run the relevant checks:

```bash
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

For documentation-only changes, running the full check suite is optional, but it is still useful before merging larger batches of work.

For calculator changes, always run:

```bash
npm.cmd test
```

Any new calculator behavior should be covered by regression tests.

## Calculator notes and known limitations

The calculator is currently implemented as a domain-level module and supports several build modes:

- `meta`
- `max_ergo`
- `min_recoil`
- `budget`
- `custom`

Current known limitations:

- The algorithm still uses a relatively greedy approach.
- Nested slots, adapters, conflicting items, and full branch selection need further stabilization.
- `requireSuppressor` is a known sensitive scenario and should be treated as a hard constraint in the calculator stabilization stage.
- Hard constraints and soft preferences are still being clarified.
- Budget scoring currently depends on the available item price data shape.
- PvP/PvE price mode is exposed in the configurator; prices still depend on the freshness and schema of the external API.
- Price fields are normalized with primary and fallback values, but unavailable market data can still reduce result accuracy.

## Data and API assumptions

The application uses the frontend-compatible tarkov.dev JSON API at `https://json.tarkov.dev/`.

Important assumptions:

- PvP data comes from `regular/items`; PvE data comes from `pve/items`.
- English item names are loaded from `regular/items_en` or `pve/items_en` and applied to the translation paths advertised by the catalog response. Russian data endpoints are also supported by the repository adapter.
- Weapon, mod, slot, conflict, stats, trader, barter, and price data come from the external API.
- API availability and schema stability are external dependencies.
- Requests time out after 15 seconds by default and can be cancelled with an `AbortSignal`.
- A complete item catalog is loaded with one `items` GET per game mode and language, then weapons, mods, and weapon details are derived locally. Supporting translation, barter, and trader metadata use their corresponding JSON endpoints.
- Catalog bundles are cached in memory for five minutes per game mode and language; concurrent consumers share one in-flight pipeline, and the underlying requests are cancelled when every consumer cancels.
- PvP and PvE catalogs are loaded lazily and are never fetched together unless the user requests both modes.
- Price data is normalized by the API layer before it reaches the calculator.
- PvP/PvE price mode maps to the corresponding `regular`/`pve` JSON endpoint family.
- Missing or changed API fields may affect the configurator and calculator behavior.

## Troubleshooting

### PowerShell script execution issues

On Windows / PowerShell, prefer `npm.cmd` commands:

```bash
npm.cmd ci
npm.cmd run dev
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

This avoids common PowerShell script execution policy issues with direct npm script invocation.

### Dependency issues

For a clean dependency install, use:

```bash
npm.cmd ci
```

If dependencies are in a broken local state, remove `node_modules` and reinstall:

```bash
rd /s /q node_modules
npm.cmd ci
```

Avoid deleting `package-lock.json` unless the lockfile itself is intentionally being regenerated.

### Special characters in project path

Some tooling can behave unexpectedly when the project path contains special characters such as `#`.

If build, test, or dev server behavior is inconsistent, try moving the repository to a path without special characters.

### Build import errors

If production build fails with an unresolved import, check that import paths match the current project structure.

For example, calculator imports should point to the current domain module location:

```js
import { calculateBestBuild } from "../domain/calculator.js";
```

instead of an outdated path under `src/utils`.

### Research scripts

Scripts under `research/` are intended for manual experiments and API/calculator investigation.

They are not part of the normal test workflow and are intentionally ignored by ESLint.
