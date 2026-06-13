const query = `
{
  items(ids: ["618b9643526131765025ab35", "5b2388675acfc4771e1be0be", "5649a2464bdc2d91118b45a8", "58d399e486f77442e0016fe7", "623c2f652febb22c2777d8d7"]) {
    name
    categories { name }
  }
}
`;
fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)));
