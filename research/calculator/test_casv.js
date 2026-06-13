const query = `
{
  item(id: "59e0bed186f774156f04ce84") {
    name
    ergonomicsModifier
    recoilModifier
  }
}
`;
fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
