const query = `
{
  item(id: "5a33e75ac4a2826c6e06d759") {
    name
    ergonomicsModifier
    recoilModifier
    conflictingItems { id name }
  }
}
`;
fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
