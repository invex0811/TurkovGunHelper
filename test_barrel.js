const query = `
{
  item(id: "55d35ee94bdc2d61338b4568") {
    name
    properties {
      ... on ItemPropertiesWeaponMod {
        slots { name }
      }
      ... on ItemPropertiesBarrel {
        slots { name }
      }
    }
  }
}
`;
fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
