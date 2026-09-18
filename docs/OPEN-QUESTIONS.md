# Open questions and suggested features

Answers to the questions below change the design or the roadmap. Each question
lists the default we will assume if there is no answer, so work can start.

## A. Questions that affect Phase 0 (please answer first)

**Q1. Licence and relationship to TownGeneratorOS.**
The reference is GPL-3.0. Do you want a clean-room reimplementation under a
permissive licence (MIT/Apache-2.0), or a port that stays GPL-3.0?
*Default: clean-room, MIT.*

**Q2. Primary map scale.**
Is the typical output a single town/city of 2–6 km across (like the reference),
or do you also need metropolitan regions of 20 km+ with suburbs and satellite
towns? This decides the rendering backend and raster resolutions.
*Default: 2–12 km, single city, Canvas 2D; regions deferred.*

**Q3. Aesthetic.**
Should the default look be the reference's hand-drawn ink style, a modern
atlas/OSM-like style, or both as switchable themes? Is a "satellite-like"
raster style wanted?
*Default: ink and atlas themes at v1; others later.*

**Q4. Era range and fantasy.**
Modern only, or the full medieval → modern spectrum? Any fantasy or sci-fi
elements (airship docks, walls around modern cities, magical districts)?
*Default: medieval through modern with mixed-era cities; no fantasy-specific
features at v1, but the feature library makes them easy to add.*

**Q5. LLM provider and key handling.**
Is bring-your-own-key in the browser acceptable? Do you want Anthropic only, or
also OpenAI-compatible and local (Ollama) adapters? Would you consider a tiny
serverless proxy (e.g. Cloudflare Worker) so users do not paste keys, even
though that is outside GitHub Pages?
*Default: BYOK, Anthropic first, adapter interface for others, no proxy.*

**Q6. Editing depth.**
Generate-and-tweak (sliders, pins, regenerate) or a full editor where users
draw roads and buildings by hand?
*Default: generate-and-tweak with pins, brushes and hint lines; no freehand
building drawing.*

**Q7. Export targets.**
Which virtual tabletops matter (Foundry, Roll20, Owlbear Rodeo, Fantasy
Grounds)? Is print (tiled PDF with grid) needed at v1?
*Default: PNG, SVG, GeoJSON, Universal VTT, Foundry; tiled PDF at v1.*

**Q8. Framework preference.**
React is proposed; Svelte or SolidJS are equally viable. Any preference or
existing team skills?
*Default: React.*

**Q9. Team and timeline.**
How many people, how much time per week, and is there a date this needs to be
usable by? The roadmap estimates assume 1–2 part-time developers.

## B. Questions that can wait until the relevant phase

**Q10. Topography inputs.** Noise presets and a brush are planned. Do you also
need import of real-world DEM tiles or hand-drawn heightmaps from other tools?

**Q11. Realism vs. gameability.** For example, should container ports be to
scale (a real large port is 5–10 km of quay, larger than most maps) or
compressed to fit a game map? *Default: a "scale compression" factor for large
facilities, on by default.*

**Q12. Wealth and density semantics.** Six classes each are proposed. Do you
want them exposed as numbers (0–1), as classes, or both? Should the overlay be
GM-only?

**Q13. Naming.** Which cultures/languages for street and district names?
Should naming be offline (wordlists) by default, with LLM refinement optional?

**Q14. Data model exposure.** Is GeoJSON export enough, or is a documented
public JavaScript API / npm package for the engine a goal?

**Q15. 3D.** Is an isometric or 3D view important enough to plan for early
(affects how buildings store height data)? *Default: store floors/height from
Phase 3 so 3D can be added later without regenerating.*

## C. Suggested additional features (for prioritisation)

Recommended for v1:

1. Era slider with mixed-era layouts (old core + modern periphery).
2. Naming and labels with collision-avoiding placement.
3. Grid overlays, scale bar, compass, legend, tiled print.
4. "Why is this here?" inspector showing placement scores.
5. Variations strip (six seeds) and history thumbnails.

Recommended for v2:

6. Points-of-interest layer (hospital, school, stadium, campus, prison,
   cemetery, military base, water treatment).
7. Utility networks: power lines, pipelines, canals with locks.
8. Growth timeline (city at year *t*) and condition layer (ruins, flooding,
   war damage).
9. Isometric/3D view with extruded buildings.
10. Player-facing export (hide GM-only labels and overlays).

Nice to have:

11. Culture/style packs; OSM import as a starting spec; PWA offline mode;
    shareable gallery without a backend; community plugin registry for feature
    types; localisation; MCP server and CLI for automation.
