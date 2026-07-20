export const GET_WEAPONS_QUERY = `
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

export const GET_ALL_MODS_QUERY = `
  query GetAllMods($gameMode: GameMode) {
    items(types: [mods], gameMode: $gameMode) {
      id
      name
      shortName
      image512pxLink
      weight
      basePrice
      avg24hPrice
      updated
      lastLowPrice
      low24hPrice
      high24hPrice
      lastOfferCount
      buyFor {
        price
        priceRUB
        currency
        vendor {
          __typename
          name
          normalizedName
          ... on TraderOffer {
            minTraderLevel
            buyLimit
            taskUnlock { id }
          }
        }
      }
      bartersFor {
        id
        level
        buyLimit
        taskUnlock { id }
        trader {
          name
          normalizedName
        }
        requiredItems {
          count
          item {
            id
            name
            shortName
            updated
            avg24hPrice
            lastLowPrice
            low24hPrice
            buyFor {
              price
              priceRUB
              currency
              vendor {
                __typename
                name
                normalizedName
                ... on TraderOffer {
                  minTraderLevel
                  buyLimit
                  taskUnlock { id }
                }
              }
            }
          }
        }
        rewardItems {
          count
          item { id }
        }
      }
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
            required
            filters {
              allowedItems { id }
            }
          }
        }
        ... on ItemPropertiesBarrel {
          slots {
            name
            nameId
            required
            filters {
              allowedItems { id }
            }
          }
        }
        ... on ItemPropertiesMagazine {
          capacity
          loadModifier
          ammoCheckModifier
          malfunctionChance
          slots {
            name
            nameId
            required
            filters {
              allowedItems { id }
            }
          }
        }
        ... on ItemPropertiesScope {
          zoomLevels
          slots {
            name
            nameId
            required
            filters {
              allowedItems { id }
            }
          }
        }
      }
    }
  }
`;

export const GET_WEAPON_DETAILS_QUERY = `
  query GetWeaponDetails($id: ID!, $gameMode: GameMode) {
    item(id: $id, gameMode: $gameMode) {
      id
      name
      shortName
      normalizedName
      link
      image512pxLink
      weight
      basePrice
      avg24hPrice
      updated
      lastLowPrice
      low24hPrice
      high24hPrice
      lastOfferCount
      buyFor {
        price
        priceRUB
        currency
        vendor {
          __typename
          name
          normalizedName
          ... on TraderOffer {
            minTraderLevel
            buyLimit
            taskUnlock { id }
          }
        }
      }
      bartersFor {
        id
        level
        buyLimit
        taskUnlock { id }
        trader {
          name
          normalizedName
        }
        requiredItems {
          count
          item {
            id
            name
            shortName
            updated
            avg24hPrice
            lastLowPrice
            low24hPrice
            buyFor {
              price
              priceRUB
              currency
              vendor {
                __typename
                name
                normalizedName
                ... on TraderOffer {
                  minTraderLevel
                  buyLimit
                  taskUnlock { id }
                }
              }
            }
          }
        }
        rewardItems {
          count
          item { id }
        }
      }
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
            required
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
