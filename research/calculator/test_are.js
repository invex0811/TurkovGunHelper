const query = `
{
  item(id: "5c793fb92e221644f31bfb64") {
    name
    properties {
      ... on ItemPropertiesWeaponMod {
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
