const API_URL = 'https://api.tarkov.dev/graphql';

async function fetchGraphQL(query, variables = {}) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  
  const result = await response.json();
  if (result.errors) {
    throw new Error(result.errors[0].message);
  }
  
  return result.data;
}

export async function getWeapons() {
  const query = `
    query GetWeapons {
      items(types: [gun]) {
        id
        name
        shortName
        image512pxLink
        categories {
          name
        }
        properties {
          ... on ItemPropertiesWeapon {
            defaultPreset {
              image512pxLink
            }
          }
        }
      }
    }
  `;
  const data = await fetchGraphQL(query);
  return data.items.filter(item => item.name && item.shortName);
}

let cachedMods = null;

export async function getAllMods() {
  if (cachedMods) return cachedMods;
  const query = `
    query GetAllMods {
      items(types: [mods]) {
        id
        name
        shortName
        image512pxLink
        weight
        basePrice
        avg24hPrice
        categories { name }
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
          ... on ItemPropertiesBarrel {
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
  const data = await fetchGraphQL(query);
  const modMap = {};
  data.items.forEach(item => {
    modMap[item.id] = item;
  });
  cachedMods = modMap;
  return modMap;
}

export async function getWeaponDetails(id) {
  const query = `
    query GetWeaponDetails($id: ID!) {
      item(id: $id) {
        id
        name
        shortName
        image512pxLink
        weight
        basePrice
        avg24hPrice
        categories { name }
        properties {
          ... on ItemPropertiesWeapon {
            defaultPreset {
              image512pxLink
            }
            ergonomics
            recoilVertical
            recoilHorizontal
            slots {
              name
              nameId
              filters {
                allowedItems {
                  id
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await fetchGraphQL(query, { id });
  return data.item;
}
