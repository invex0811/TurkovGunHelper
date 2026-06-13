const query = `
{
  items(types: [mods]) {
    id
    name
    shortName
    image512pxLink
    accuracyModifier
    recoilModifier
    ergonomicsModifier
    conflictingItems { id }
    properties {
      ... on ItemPropertiesWeaponMod {
        slots {
          name
          nameId
          filters {
            allowedItems { id }
          }
        }
      }
    }
  }
}
`;
fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(d => console.log(d.data.items.length, 'mods fetched'));
