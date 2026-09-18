# Command line and MCP server

The `citygen` command runs the same engine as the web app without a browser:
generate a region, print its statistics, export frames, and serve the
assistant's tools to any MCP client.

```sh
pnpm build                                  # builds every package, including the CLI
pnpm --filter @citygen/cli exec citygen --help
# or, after `npm link` in packages/cli:  citygen --help
```

## Commands

| Command                                                                                                                                                                                       | What it does                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `citygen new -o region.citygen.json [--seed s] [--year 1925] [--width 20] [--height 15] [--name "…"]`                                                                                         | Write a new document. Sizes are in km.                                                                                                                                                       |
| `citygen generate region.citygen.json [--year 1890] [--save] [--json]`                                                                                                                        | Run the pipeline and print the statistics (settlements, facilities, rail). `--json` prints everything the web app's stats panel knows.                                                       |
| `citygen export region.citygen.json [--frame minX,minY,maxX,maxY \| --settlement id --radius m] --svg f.svg --geojson f.json --glb f.glb --csv f.csv [--theme ink] [--player] [--px-per-m 2]` | Export a frame. Without a frame the largest settlement's built-up area is used.                                                                                                              |
| `citygen directory region.citygen.json [--settlement id] [--query pub] [--limit 200]`                                                                                                         | Print the business and resident directory as CSV.                                                                                                                                            |
| `citygen interior region.citygen.json --building <id> [--floor 0] [--svg plan.svg] [--uvtt plan.dd2vtt] [--px-per-m 40]`                                                                      | Floor plans of a building (ids from `directory`) or a facility part (ids from `find_features` over MCP): rooms as text, an SVG per floor, a Universal VTT scene with walls and door portals. |
| `citygen packs <index-url> [--doc region.citygen.json --add <name>]`                                                                                                                          | List a hosted pack registry, or add one of its culture packs or feature types to a document. The index format is in docs/FEATURES.md.                                                        |
| `citygen mcp [--doc region.citygen.json] [--autosave]`                                                                                                                                        | Serve the assistant tools over MCP on stdio.                                                                                                                                                 |

Coordinates are model metres: x east, y north, origin at the region centre.
PNG, Universal VTT and Foundry exports need the web app's renderer; the SVG
can be rasterised with any SVG tool.

## MCP server

The server exposes every assistant tool (`get_region_summary`,
`describe_area`, `find_features`, `patch_spec`, `set_year`, `draw`,
`place_feature`, `name_features`, `add_event`, `undo`…) plus
`new_document`, `open_document`, `save_document`, `get_document` and
`export_frame`. Snapshots (`render_snapshot`) are not available without a
browser and return an error the model can read.

Claude Desktop or Claude Code configuration:

```json
{
  "mcpServers": {
    "citygen": {
      "command": "node",
      "args": [
        "/path/to/CityGenerator/packages/cli/bin/citygen.mjs",
        "mcp",
        "--doc",
        "/path/to/region.citygen.json",
        "--autosave"
      ]
    }
  }
}
```

Every mutating tool goes through the same command bus as the editor, so
`undo` works and a document edited over MCP opens in the web app unchanged.

## Headless use from code

```ts
import { createEngine } from '@citygen/engine';
import { createDocument } from '@citygen/core';

const engine = createEngine();
const doc = createDocument({
  now: new Date().toISOString(),
  seed: 'innsmouth',
  widthM: 12_000,
  heightM: 8_000,
});
const { stats } = await engine.setDocument(doc, { sketch: false });
const town = stats.settlements[0];
const model = await engine.exportFrame({
  minX: town.center[0] - 400,
  minY: town.center[1] - 400,
  maxX: town.center[0] + 400,
  maxY: town.center[1] + 400,
});
```

`EngineHost` in `@citygen/cli` wraps an engine and a command bus as a
`ToolHost` for the assistant package, which is how the MCP server and the
evaluation set share one implementation.
