import { calculateBestBuild } from './src/utils/calculator.js';
import fs from 'fs';

async function run() {
  const modMapRaw = JSON.parse(fs.readFileSync('./mods.json'));
  const weaponRaw = JSON.parse(fs.readFileSync('./weapon.json'));
  const modMap = {};
  modMapRaw.data.items.forEach(i => modMap[i.id] = i);
  const weapon = weaponRaw.data.item;

  const result = calculateBestBuild(weapon, 'custom', 70, 50, modMap);
  console.log(JSON.stringify(result.stats, null, 2));
  console.log(result.build.map(b => b.item.shortName).join(', '));
}

// Need to fetch and save mods.json and weapon.json first
async function fetchAll() {
  if (!fs.existsSync('./mods.json')) {
    const q1 = `query { items(types: [mods]) { id name shortName image512pxLink weight categories { name } accuracyModifier recoilModifier ergonomicsModifier conflictingItems { id } properties { ... on ItemPropertiesWeaponMod { slots { name nameId filters { allowedItems { id } } } } ... on ItemPropertiesBarrel { slots { name nameId filters { allowedItems { id } } } } } } }`;
    const r1 = await fetch('https://api.tarkov.dev/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q1 }) }).then(r => r.json());
    fs.writeFileSync('./mods.json', JSON.stringify(r1));
  }
  if (!fs.existsSync('./weapon.json')) {
    const q2 = `query { item(id: "5447a9cd4bdc2dbd208b4567") { id name shortName image512pxLink weight categories { name } properties { ... on ItemPropertiesWeapon { defaultPreset { id } ergonomics recoilVertical recoilHorizontal slots { name nameId filters { allowedItems { id } } } } } } }`;
    const r2 = await fetch('https://api.tarkov.dev/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q2 }) }).then(r => r.json());
    fs.writeFileSync('./weapon.json', JSON.stringify(r2));
  }
  run();
}
fetchAll();
