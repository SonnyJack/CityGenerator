import type { RegionSummary, SettlementSummary } from './host.js';

/** The system prompt: units, compass, year, and the rule that nothing counts as done until a tool succeeded. */
export function systemPrompt(summary: RegionSummary): string {
  return [
    'You are the CityGenerator assistant: you help a game master shape a procedurally generated region and its towns for a tabletop campaign (Call of Cthulhu style, but any period from 1100 to 2100).',
    '',
    'Coordinates: model metres. x grows east, y grows north, the origin is the centre of the region, which is ' +
      `${summary.extentM.width / 1000} × ${summary.extentM.height / 1000} km, so x runs from ${-summary.extentM.width / 2} to ${summary.extentM.width / 2} and y from ${-summary.extentM.height / 2} to ${summary.extentM.height / 2}. ` +
      'North is +y. "Upstream" and "downhill" come from describe_area. Distances are in metres.',
    `The region is in the year ${summary.year} (${summary.era}); culture pack ${summary.culture}; biome ${summary.biome}.`,
    '',
    'Rules:',
    '- Prefer commands over coordinates: change the spec, the year, request facilities, regenerate, rename. Author geometry only when the user asks for a specific shape; use coordinates taken from summaries and describe_area rather than guesses.',
    '- Nothing is done until a tool succeeded. Report exactly what the tool results say, including warnings, and say when something was only requested rather than placed.',
    '- Do several tool calls in one turn for multi-step requests. Read before you write when ids or positions are unknown.',
    '- Keep answers short and concrete: names, ids, coordinates, distances. Do not restate the whole summary.',
    '- The user can undo every command; mention it when you make a large change.',
    '- Never invent names, ids or places that no tool returned.',
  ].join('\n');
}

export function summaryText(summary: RegionSummary): string {
  const s = summary.settlements
    .map(
      (t) =>
        `${t.id}: ${t.name} (${t.kind}, pop ${t.population}, centre ${Math.round(t.center[0])}, ${Math.round(t.center[1])}, r ${Math.round(t.radiusM)} m${t.walled ? ', walled' : ''})`,
    )
    .join('\n');
  const f = summary.facilities
    .map(
      (x) =>
        `${x.id}: ${x.name} [${x.type}] at ${Math.round(x.center[0])}, ${Math.round(x.center[1])}${x.settlement ? ` (${x.settlement})` : ''}${x.pinned ? ', pinned' : ''}`,
    )
    .join('\n');
  const a = summary.annotations
    .map((x) => `${x.id}: ${x.kind}${x.gmOnly ? ' (GM)' : ''} "${x.text}"`)
    .join('\n');
  return [
    `Region "${summary.regionName}" (document "${summary.name}", seed ${summary.seed}), year ${summary.year} (${summary.era}), culture ${summary.culture}, biome ${summary.biome}, terrain preset ${summary.terrain.preset}, rivers: ${summary.terrain.rivers.join(', ') || 'none'}.`,
    `Rail: ${summary.rail.stations} stations, ${Math.round(summary.rail.trackKm)} km of track${summary.rail.tramLines ? `, ${summary.rail.tramLines} tram lines` : ''}.`,
    `Settlements:\n${s || '(none)'}`,
    `Facilities:\n${f || '(none)'}`,
    `Authored features: ${summary.authored.count}${
      summary.authored.count
        ? ` (${Object.entries(summary.authored.byLayer)
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')})`
        : ''
    }; overrides: ${summary.overrides}.`,
    a ? `Annotations:\n${a}` : 'Annotations: none.',
    summary.warnings.length ? `Engine warnings: ${summary.warnings.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function settlementText(s: SettlementSummary): string {
  return [
    `Focused settlement ${s.id}: ${s.name} (${s.kind}, pop ${s.population}, centre ${Math.round(s.center[0])}, ${Math.round(s.center[1])}, r ${Math.round(s.radiusM)} m${s.founded ? `, founded ${s.founded}` : ''}).`,
    `Districts (${s.districts}): ${s.districtList.map((d) => `${d.name}${d.ward ? ` [${d.ward}]` : ''} at ${Math.round(d.center[0])}, ${Math.round(d.center[1])}`).join('; ') || 'none'}.`,
    `Facilities: ${s.facilities.map((f) => `${f.name} [${f.type}] (${f.id})`).join('; ') || 'none'}. Stations: ${s.stations.map((x) => x.name).join(', ') || 'none'}.`,
    `${s.premises} premises; notable: ${s.businesses
      .slice(0, 12)
      .map((b) => `${b.name} (${b.use}${b.address ? `, ${b.address}` : ''})`)
      .join('; ')}.`,
  ].join('\n');
}
