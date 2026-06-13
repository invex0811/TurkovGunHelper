const query = `
{
  item(id: "623c2f652febb22c2777d8d7") {
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
