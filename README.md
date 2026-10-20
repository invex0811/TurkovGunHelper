# Tarkov Gun Helper

**Tarkov Gun Helper** is a web application for creating and editing weapon builds for **Escape from Tarkov**.

It helps players quickly find compatible modules for their preferred weapon characteristics, estimate the total build cost, and save completed builds.

[Open Tarkov Gun Helper](https://tarkovgunhelper.com/)

## Features

- Weapon catalog with search, filters by type, caliber, and trader, sorting, and favorites.
- Automatic generation of optimized Meta builds.
- Custom priorities for weapon characteristics.
- Separate PvP and PvE price modes.
- Flea Market and trader price support, with your trader levels and Flea Market access.
- Build limits for budget and weight.
- Suppressor, magazine, sight, laser, and flashlight settings.
- Required modules that must be included in the build.
- Final price, ergonomics, recoil, and weight calculations.
- Highlighting of critical weapon modules.
- Manual replacement of parts with compatible alternatives, including stat and price comparisons.
- Interactive diagram of installed modules and available slots.
- Direct links to weapon and module pages on tarkov.dev.
- Local build saving with the ability to continue editing later.
- Comparison of multiple saved builds.
- Side-by-side comparison of weapon mods of one category.
- Import and export of individual builds or the entire collection.
- Sharing any build as a link.
- English and Russian interface, dark and light themes, installable as an app (PWA).

## How to Use

1. Select a weapon from the catalog.
2. Choose the build goal and configure the required limits.
3. Click **Generate Build**.
4. Review the weapon characteristics, estimated price, and installed parts.
5. Replace individual modules or edit the build through the interactive diagram when needed.
6. Save the result to reopen or compare it later on the **Builds** page.

## Data and Storage

Weapon, module, compatibility, and price data is provided by [tarkov.dev](https://tarkov.dev/).

Saved builds are stored locally in the browser. To move builds to another browser or device, export them to a file and import them again.

Prices are estimates and may differ from current in-game prices.

## Feedback

Found a bug or have an idea? [Open an issue](https://github.com/invex0811/TurkovGunHelper/issues/new). The **Feedback** button in the site header leads to the same place.

## Development

```bash
npm ci
npm run dev
```

Pages have plain URLs: every weapon has its own page at `/weapon/<slug>/` (for example `https://tarkovgunhelper.com/weapon/colt-m4a1-556x45-assault-rifle/`). `npm run build` creates a static HTML page with its own title and description for each weapon, plus `sitemap.xml` and `robots.txt`, so search engines can index the site. Old `/#/…` links keep working.

Developer documentation (in Russian) lives in [`docs/`](docs/README.md): architecture, data layer and pricing, build calculator, storage and build transfer, testing, and contribution guidelines.

## Disclaimer

Tarkov Gun Helper is an independent, unofficial project and is not affiliated with Battlestate Games.