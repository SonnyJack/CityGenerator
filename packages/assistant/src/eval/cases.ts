import type { EvalCase } from './types.js';

/** Fifty scripted requests: questions, single edits, multi-step edits and drawing. */
export const EVAL_CASES: EvalCase[] = [
  {
    id: 'q-region-name',
    category: 'question',
    prompt: 'What is this region called and what year is it?',
    tools: [],
    readOnly: true,
    answerIncludes: ['Greyton', '1925'],
  },
  {
    id: 'q-largest',
    category: 'question',
    prompt: 'Which settlement is the largest?',
    tools: ['get_region_summary'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'get_region_summary',
        text: 'New Boston',
      },
    ],
    answerIncludes: ['New Boston'],
  },
  {
    id: 'q-rivers',
    category: 'question',
    prompt: 'Name the rivers.',
    tools: ['get_region_summary'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'get_region_summary',
        text: 'Miskatonic River',
      },
    ],
    answerIncludes: ['Miskatonic'],
  },
  {
    id: 'q-port-where',
    category: 'question',
    prompt: 'Where is the port?',
    tools: ['find_features'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'find_features',
        text: 'city-port-1',
      },
    ],
    answerIncludes: ['2000'],
  },
  {
    id: 'q-point',
    category: 'question',
    prompt: 'What is at 1250, -850?',
    tools: ['describe_area'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'describe_area',
        text: 'Gilman House',
      },
    ],
    answerIncludes: ['Gilman'],
  },
  {
    id: 'q-stations',
    category: 'question',
    prompt: 'How many railway stations are there and where?',
    tools: ['find_features'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'find_features',
        text: 'New Boston Central',
      },
    ],
    answerIncludes: ['New Boston Central'],
  },
  {
    id: 'q-districts',
    category: 'question',
    prompt: 'List the districts of New Boston.',
    tools: ['get_settlement_summary'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'get_settlement_summary',
        text: 'The Docks',
      },
    ],
    answerIncludes: ['Docks'],
  },
  {
    id: 'q-businesses',
    category: 'question',
    prompt: 'What businesses are on Water Street?',
    tools: ['find_features'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'find_features',
        text: 'Gilman House',
      },
    ],
    answerIncludes: ['Gilman'],
  },
  {
    id: 'q-hospital',
    category: 'question',
    prompt: 'Is there a hospital, and in which town?',
    tools: ['find_features'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'find_features',
        text: 'Mercy Hospital',
      },
    ],
    answerIncludes: ['Mercy'],
  },
  {
    id: 'q-village',
    category: 'question',
    prompt: 'Tell me about the village.',
    tools: ['get_settlement_summary'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'get_settlement_summary',
        text: 'The Green',
      },
    ],
    answerIncludes: ['Martin'],
  },
  {
    id: 'q-spec',
    category: 'question',
    prompt: 'What terrain preset and relief is the region using?',
    tools: ['get_spec'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'get_spec',
        text: '"preset":"coast"',
      },
    ],
    answerIncludes: ['coast'],
  },
  {
    id: 'q-nearby-station',
    category: 'question',
    prompt: 'What is near the station within 600 m?',
    tools: ['describe_area'],
    readOnly: true,
    resultIncludes: [
      {
        tool: 'describe_area',
        text: 'Water Street',
      },
    ],
    answerIncludes: ['Water Street'],
  },
  {
    id: 'e-year',
    category: 'edit',
    prompt: 'Move the region to 1890.',
    tools: ['set_year'],
    doc: [
      {
        path: '/spec/year',
        equals: 1890,
      },
    ],
  },
  {
    id: 'e-year-modern',
    category: 'edit',
    prompt: 'Jump forward to 1985.',
    tools: ['set_year'],
    doc: [
      {
        path: '/spec/year',
        equals: 1985,
      },
    ],
  },
  {
    id: 'e-theme',
    category: 'edit',
    prompt: 'Switch to the blueprint theme.',
    tools: ['set_theme'],
    doc: [
      {
        path: '/ui/theme',
        equals: 'blueprint',
      },
    ],
  },
  {
    id: 'e-rename-port',
    category: 'edit',
    prompt: 'Rename the port to Innsmouth Wharf.',
    tools: ['name_features'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'setProperty',
      },
      {
        path: '/overrides/0/value',
        equals: 'Innsmouth Wharf',
      },
    ],
  },
  {
    id: 'e-rename-city',
    category: 'edit',
    prompt: 'Call the city Arkham instead of New Boston.',
    tools: ['name_features'],
    doc: [
      {
        path: '/overrides/0/target',
        equals: 'city',
      },
      {
        path: '/overrides/0/value',
        equals: 'Arkham',
      },
    ],
  },
  {
    id: 'e-note',
    category: 'edit',
    prompt: 'Add a GM note at the port: smugglers land here on new moons.',
    tools: ['annotate'],
    doc: [
      {
        path: '/annotations/0/kind',
        equals: 'note',
      },
      {
        path: '/annotations/0/gmOnly',
        equals: true,
      },
    ],
  },
  {
    id: 'e-label',
    category: 'edit',
    prompt: "Label the hospital hill 'Gallows Hill'.",
    tools: ['annotate'],
    doc: [
      {
        path: '/annotations/0/kind',
        equals: 'label',
      },
      {
        path: '/annotations/0/text',
        equals: 'Gallows Hill',
      },
    ],
  },
  {
    id: 'e-marker',
    category: 'edit',
    prompt: 'Put a marker on the meeting house in the village.',
    tools: ['annotate'],
    doc: [
      {
        path: '/annotations/0/kind',
        equals: 'marker',
      },
    ],
  },
  {
    id: 'e-frame',
    category: 'edit',
    prompt: 'Make a handout frame 400 m square around the docks.',
    tools: ['annotate'],
    doc: [
      {
        path: '/annotations/0/kind',
        equals: 'handoutFrame',
      },
      {
        path: '/annotations/0/geometry/type',
        equals: 'Polygon',
      },
    ],
  },
  {
    id: 'e-relief',
    category: 'edit',
    prompt: 'Make the terrain much more mountainous.',
    tools: ['patch_spec'],
    doc: [
      {
        path: '/spec/terrain/relief',
        equals: 0.9,
      },
    ],
  },
  {
    id: 'e-sea',
    category: 'edit',
    prompt: 'Raise the sea level by 5 metres.',
    tools: ['get_spec', 'patch_spec'],
    doc: [
      {
        path: '/spec/terrain/seaLevel',
        equals: 5,
      },
    ],
  },
  {
    id: 'e-inequality',
    category: 'edit',
    prompt: 'Make society far more unequal.',
    tools: ['patch_spec'],
    doc: [
      {
        path: '/spec/society/inequality',
        equals: 0.9,
      },
    ],
  },
  {
    id: 'e-no-rail',
    category: 'edit',
    prompt: 'Remove the railways entirely.',
    tools: ['patch_spec'],
    doc: [
      {
        path: '/spec/networks/rail/enabled',
        equals: false,
      },
    ],
  },
  {
    id: 'e-mainlines',
    category: 'edit',
    prompt: 'Give the region two mainline railways.',
    tools: ['patch_spec'],
    doc: [
      {
        path: '/spec/networks/rail/mainlines',
        equals: 2,
      },
    ],
  },
  {
    id: 'e-regen-region',
    category: 'edit',
    prompt: 'Regenerate the whole layout with a new seed but keep my edits.',
    tools: ['regenerate'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'reseed',
      },
      {
        path: '/overrides/0/target',
        equals: 'region',
      },
    ],
  },
  {
    id: 'e-regen-village',
    category: 'edit',
    prompt: 'Re-roll the village layout.',
    tools: ['regenerate'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'reseed',
      },
      {
        path: '/overrides/0/target',
        equals: 'village',
      },
    ],
  },
  {
    id: 'e-remove-gasworks',
    category: 'edit',
    prompt: 'Get rid of the gasworks.',
    tools: ['remove_feature'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'remove',
      },
      {
        path: '/overrides/0/target',
        equals: 'city-gasworks-1',
      },
    ],
  },
  {
    id: 'e-move-hospital',
    category: 'edit',
    prompt: 'Move the hospital north of the city to 1100, 900.',
    tools: ['move_feature'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'pin',
      },
      {
        path: '/overrides/0/x',
        equals: 1100,
      },
    ],
  },
  {
    id: 'm-year-note',
    category: 'multi',
    prompt: 'Set the year to 1928 and add a GM note at the docks saying the Marsh refinery has opened.',
    tools: ['set_year', 'annotate'],
    doc: [
      {
        path: '/spec/year',
        equals: 1928,
      },
      {
        path: '/annotations',
        length: 1,
      },
    ],
  },
  {
    id: 'm-find-remove',
    category: 'multi',
    prompt: 'Find the bank and remove it.',
    tools: ['find_features', 'remove_feature'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'suppress',
      },
      {
        path: '/overrides/0/target',
        equals: 'b-2',
      },
    ],
  },
  {
    id: 'm-find-rename',
    category: 'multi',
    prompt: 'Rename the hotel on Water Street to the Marsh Hotel.',
    tools: ['find_features', 'name_features'],
    doc: [
      {
        path: '/overrides/0/target',
        equals: 'b-1',
      },
      {
        path: '/overrides/0/value',
        equals: 'The Marsh Hotel',
      },
    ],
  },
  {
    id: 'm-add-village',
    category: 'multi',
    prompt: 'Add a fishing village of 300 people on the coast at 2600, 2200 called Kingsport.',
    tools: ['add_settlement'],
    doc: [
      {
        path: '/spec/settlements/0/name',
        equals: 'Kingsport',
      },
      {
        path: '/spec/settlements/0/site/center',
        equals: [2600, 2200],
      },
    ],
  },
  {
    id: 'm-place-annotate',
    category: 'multi',
    prompt: "Give New Boston a cemetery and mark it as GM-only 'the ghoul warren'.",
    tools: ['place_feature', 'annotate'],
    doc: [
      {
        path: '/spec/features/0/type',
        equals: 'institution.cemetery',
      },
      {
        path: '/annotations',
        length: 1,
      },
    ],
  },
  {
    id: 'm-wealth',
    category: 'multi',
    prompt: 'Make the North End of New Boston poorer.',
    tools: ['get_settlement_summary', 'brush'],
    doc: [
      {
        path: '/authored/features/0/properties/layer',
        equals: 'fieldEdit',
      },
      {
        path: '/authored/features/0/properties/delta',
        equals: -0.5,
      },
    ],
  },
  {
    id: 'm-two-facilities',
    category: 'multi',
    prompt: 'Add a brewery and a tannery to the city.',
    tools: ['place_feature'],
    doc: [
      {
        path: '/spec/features',
        length: 2,
      },
    ],
  },
  {
    id: 'm-reroll-area',
    category: 'multi',
    prompt: 'Re-roll just the blocks around the village green.',
    tools: ['regenerate'],
    doc: [
      {
        path: '/overrides/0/op',
        equals: 'reroll',
      },
    ],
  },
  {
    id: 'm-freeze',
    category: 'multi',
    prompt: 'Freeze the Gilman House so regeneration keeps it, and note that room 428 is haunted.',
    tools: ['freeze', 'annotate'],
    doc: [
      {
        path: '/authored/features/0/properties/origin',
        equals: 'frozen',
      },
      {
        path: '/authored/features/0/properties/frozenFrom',
        equals: 'b-1',
      },
      {
        path: '/annotations',
        length: 1,
      },
    ],
  },
  {
    id: 'm-undo',
    category: 'multi',
    prompt: 'Set the year to 1700, then undo that.',
    tools: ['set_year', 'undo'],
    doc: [
      {
        path: '/spec/year',
        equals: 1925,
      },
    ],
  },
  {
    id: 'm-patch-year',
    category: 'multi',
    prompt: 'Make it a hillier region in 1850 with no motorways.',
    tools: ['patch_spec', 'set_year'],
    doc: [
      {
        path: '/spec/terrain/relief',
        equals: 0.7,
      },
      {
        path: '/spec/networks/roads/motorways',
        equals: false,
      },
      {
        path: '/spec/year',
        equals: 1850,
      },
    ],
  },
  {
    id: 'm-move-village',
    category: 'multi',
    prompt: 'Add a hamlet at -1000, 3000 and then move it to -1500, 3200.',
    tools: ['add_settlement', 'move_feature'],
    doc: [
      {
        path: '/spec/settlements/0/site/center',
        equals: [-1500, 3200],
      },
    ],
  },
  {
    id: 'd-street',
    category: 'draw',
    prompt: 'Draw a road from the station to the port.',
    tools: ['draw'],
    doc: [
      {
        path: '/authored/features/0/properties/layer',
        equals: 'street',
      },
      {
        path: '/authored/features/0/properties/name',
        equals: 'Harbour Road',
      },
    ],
  },
  {
    id: 'd-rail',
    category: 'draw',
    prompt: 'Draw a railway siding from the station east 400 m.',
    tools: ['draw'],
    doc: [
      {
        path: '/authored/features/0/properties/layer',
        equals: 'rail',
      },
    ],
  },
  {
    id: 'd-building',
    category: 'draw',
    prompt: 'Draw a 30 by 20 m warehouse at 1950, -1450.',
    tools: ['draw'],
    doc: [
      {
        path: '/authored/features/0/properties/layer',
        equals: 'building',
      },
      {
        path: '/authored/features/0/properties/kind',
        equals: 'warehouse',
      },
    ],
  },
  {
    id: 'd-park',
    category: 'draw',
    prompt: 'Make a park zone 200 m across in the North End.',
    tools: ['draw'],
    doc: [
      {
        path: '/authored/features/0/properties/layer',
        equals: 'zone',
      },
      {
        path: '/authored/features/0/properties/kind',
        equals: 'park',
      },
    ],
  },
  {
    id: 'd-canal',
    category: 'draw',
    prompt: 'Cut a canal from the docks inland to 1500, -600.',
    tools: ['draw'],
    doc: [
      {
        path: '/authored/features/0/properties/layer',
        equals: 'water',
      },
    ],
  },
  {
    id: 'd-hill',
    category: 'draw',
    prompt: 'Raise a 40 m hill at -200, -500.',
    tools: ['brush'],
    doc: [
      {
        path: '/authored/features/0/properties/op',
        equals: 'raise',
      },
      {
        path: '/authored/features/0/properties/amount',
        equals: 40,
      },
    ],
  },
  {
    id: 'd-flatten',
    category: 'draw',
    prompt: 'Flatten the ground along the line from 0,0 to 500,0 for an airfield.',
    tools: ['brush'],
    doc: [
      {
        path: '/authored/features/0/properties/op',
        equals: 'flatten',
      },
      {
        path: '/authored/features/0/geometry/type',
        equals: 'LineString',
      },
    ],
  },
  {
    id: 'd-bad-geometry',
    category: 'draw',
    prompt: 'Draw a street way outside the map at 90000, 0 to 95000, 0.',
    tools: [],
    allowErrors: true,
    readOnly: true,
    answerIncludes: ['outside'],
  },
];
