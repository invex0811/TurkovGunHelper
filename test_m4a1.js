const query = `
{
  items(name: "m4a1") {
    id
    name
    shortName
    image512pxLink
    properties {
      ... on ItemPropertiesWeapon {
        defaultPreset {
          id
          image512pxLink
          iconLink
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
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
