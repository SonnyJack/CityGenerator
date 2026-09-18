# Authoring guide: feature types and culture packs

Both kinds of plugin are plain JSON, live inside the document
(`spec.customFeatureTypes` and `spec.customCulturePacks`), travel with it,
and are validated on import. Drop the file on **Import…** in the toolbar (or
`citygen import` is not needed: paste it into the document), pick the pack
under **Culture** or request the feature from a settlement, and the engine
uses it exactly like a built-in. A pack or type with the same `id` as a
built-in replaces it for that document.

## Feature types

A feature type says how big something is, where it may go, how it should
face, and what parts it is made of. The engine places it, adapts around it,
reserves its land and draws its parts in every theme.

```json
{
  "id": "cannery",
  "name": "Cannery",
  "category": "industry",
  "years": [1860, 1990],
  "footprintM": [140, 70],
  "orientation": "alignCoast",
  "radial": [0.6, 1.4],
  "placement": { "shore": true, "maxSlope": 0.08, "nearRail": 0.6, "downwind": 0.5 },
  "connectors": { "rail": true, "road": true },
  "nuisance": { "radiusM": 300, "strength": 0.5 },
  "ward": "industrial",
  "parts": [
    {
      "shape": "rect",
      "kind": "shed",
      "u": 0,
      "v": 0,
      "lengthM": 90,
      "widthM": 40,
      "name": "Packing hall",
      "floors": 2
    },
    { "shape": "rect", "kind": "quay", "u": 0, "v": 0.5, "lengthM": 120, "widthM": 8 },
    { "shape": "circle", "kind": "tank", "u": -0.4, "v": -0.3, "radiusM": 6 },
    { "shape": "point", "kind": "chimney", "u": 0.4, "v": -0.3 }
  ]
}
```

| Field         | Meaning                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `years`       | The type exists between these years; requests outside them fail with a reason.                                                                                                                                       |
| `footprintM`  | `[length, width]` in metres for the medium size; `small` is ×0.6 and `large` ×1.6. Scale compression (document setting) shrinks footprints over 300 m.                                                               |
| `orientation` | `free`, or align the long axis with the coast, the nearest railway, the town centre (radial), the wind, or a river.                                                                                                  |
| `radial`      | Where it sits from the settlement centre, as a fraction of the built-up radius `[min, max]`.                                                                                                                         |
| `placement`   | Hard limits (`shore`, `river`, `maxSlope`, `minCentreDist` in metres) and soft preferences as weights (`nearRail`, `downwind`, `farFromCentre`, `elevated`; negative pulls the other way).                           |
| `connectors`  | Whether the engine routes a rail spur and an access road to it.                                                                                                                                                      |
| `nuisance`    | Pushes the wealth field down within the radius, by strength.                                                                                                                                                         |
| `ward`        | Which reserved ward the town patches under it take: `port`, `industrial`, `institution`, `campus`, `cemetery`, `airfield`.                                                                                           |
| `parts`       | The local layout in a frame of the footprint: `u` runs along the length and `v` across the width, both in −0.5…0.5 (0, 0 is the centre). Shapes are `rect`, `circle`, `line` (points in u/v), `point` and `polygon`. |

Part kinds and how themes draw them: `building`, `shed`, `warehouse`, `hall`,
`hangar`, `terminal`, `chapel` (solid buildings, extruded in 3D and exported
to glTF); `quay`, `pier`, `slipway`, `dock`, `breakwater`, `runway`, `apron`,
`yard`, `grounds`, `graves`, `wall`, `fence`, `track` (surfaces and lines);
`crane`, `tank`, `gasholder`, `chimney`, `mast`, `dome` (point marks). The
front of the footprint (positive `v`) faces the sea, railway or town when
the orientation aligns with one.

Requests reference the type by id, on a settlement (`spec.settlements[].features`)
or on the region (`spec.features`):

```json
{ "id": "cannery-1", "type": "cannery", "size": "large", "hint": "east of the harbour" }
```

A pinned request (`"pin": { "x": 1200, "y": -300, "rotation": 15 }`) is
placed exactly there.

## Culture packs

A culture pack names things and sets the habits of building. A grammar is
`{ "patterns": [...], "parts": { token: [...] } }`: `{token}` expands to a
random entry of that part, `{given}` and `{family}` draw from the pack's
name lists, `{suffix}` in a street pattern takes the class's suffix, and
generated names are unique within their scope.

```json
{
  "id": "lowlands",
  "name": "Lowlands",
  "language": "nl",
  "naming": {
    "given": ["Jan", "Pieter", "Maria", "Anna", "Willem", "Geertje"],
    "family": ["de Vries", "Jansen", "Bakker", "Visser", "Smit", "Mulder"],
    "settlement": {
      "patterns": ["{family}dam", "{water}dijk", "Nieuw {given}stad", "{water}sluis"],
      "parts": { "water": ["Amstel", "Vecht", "Spaarne"] }
    },
    "street": {
      "patterns": ["{family}{suffix}", "{tree}{suffix}", "Oude {suffix}"],
      "parts": { "tree": ["Linden", "Eiken", "Beuken"] }
    },
    "streetSuffix": {
      "artery": ["weg", "laan"],
      "road": ["dijk", "weg"],
      "collector": ["straat", "kade"],
      "street": ["straat", "gracht"],
      "lane": ["steeg", "hof"]
    },
    "district": {
      "patterns": ["{family}kwartier", "{side}buurt"],
      "parts": { "side": ["Noord", "Zuid", "Oost", "West"] }
    },
    "water": { "patterns": ["{name}"], "parts": { "name": ["Amstel", "Vecht", "Spaarne", "Maas"] } },
    "business": { "patterns": ["{family} & Zonen", "Handelshuis {family}"] },
    "quarters": {
      "core": "Binnenstad",
      "cathedral": "Kerkbuurt",
      "castle": "Burcht",
      "market": "Grote Markt",
      "port": "Haven",
      "industrial": "Werkstad",
      "station": "Stationsbuurt"
    }
  },
  "conventions": {
    "earlyPattern": "grid",
    "modernFrom": 1650,
    "blockSizeScale": 0.85,
    "buildingKinds": { "house": "grachtenpand", "townhouse": "herenhuis", "warehouse": "pakhuis" },
    "religious": ["Grote Kerk", "Oude Kerk", "Doopsgezinde kerk"],
    "civic": ["stadhuis", "waag", "gasthuis"],
    "materials": {
      "preIndustrial": { "brick": 6, "timber": 2 },
      "industrial": { "brick": 6, "stone": 1 },
      "modern": { "brick": 3, "concrete": 3, "glass": 1 }
    },
    "transport": { "rail": 1839, "tram": 1880 },
    "walls": true
  },
  "colonial": { "culture": "england", "from": 1900, "share": 0.1 }
}
```

| Field                                     | Meaning                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `naming.*`                                | Grammars for settlement, street, district, water and business names; `given` and `family` feed `{given}`/`{family}` and households. Street patterns run through the class suffix table. `quarters` name the old town and the special wards. |
| `conventions.earlyPattern` / `modernFrom` | The growth pattern before the era table's own grids take over (an organic medina, an early grid), and the year the standard eras apply.                                                                                                     |
| `conventions.blockSizeScale`              | Multiplies block sizes (alleys under 1, wide grids over 1).                                                                                                                                                                                 |
| `conventions.buildingKinds`               | Display names by generic kind (house, townhouse, mansion, shophouse, shack, workshop, barracks, rowhouse, tenement, villa, apartment, tower, warehouse, office, shop).                                                                      |
| `conventions.materials`                   | Weights per era band; they colour the Sanborn theme and appear in the inspector and directory.                                                                                                                                              |
| `conventions.transport`                   | Years the modes arrive, overriding the era table (rail, tram, motorway, container).                                                                                                                                                         |
| `colonial`                                | A second pack that contributes a share of names from a year (to an optional year).                                                                                                                                                          |

Packs are validated against the schema; a missing list or an empty grammar
is refused with the field named. The eight built-in packs in
`packages/core/src/naming/packs.ts` are complete examples.

## Sharing

A pack or type is one JSON file; a document that uses it carries a copy, so
sharing the document is enough. Publish the file anywhere (a gist works) and
others import it with **Import…** or **Open ▾ → Open URL**. Contributions of
packs and types to the repository are welcome: add the pack to
`packages/core/src/naming/packs.ts` (with the checks in `naming.test.ts`) or
the type to `packages/core/src/placement/library.ts`.
