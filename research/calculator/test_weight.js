const query = `
{
  item(id: "5447a9cd4bdc2dbd208b4567") {
    weight
  }
}
`;
fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
