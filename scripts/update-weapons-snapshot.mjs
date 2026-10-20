// Refreshes scripts/data/weapons-snapshot.json, the weapon list the prerender
// falls back to when tarkov.dev is unreachable. Run with
// `npm run weapons:snapshot` and commit the result.
import { fetchWeaponSummaries, readWeaponSnapshot, SNAPSHOT_PATH, writeWeaponSnapshot } from './lib/weaponCatalog.mjs';

const previous = await readWeaponSnapshot().catch(() => ({ weapons: [] }));
const snapshot = await writeWeaponSnapshot(await fetchWeaponSummaries(), previous.weapons);
console.log(`Wrote ${snapshot.weapons.length} weapons to ${SNAPSHOT_PATH}.`);
