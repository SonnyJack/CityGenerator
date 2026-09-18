# 0004. MapLibre GL with in-browser vector tiles and a synthetic CRS

Date: 2026-09-18
Status: Accepted

## Context

Zooming from a 60 km region to a doorstep needs level of detail, culling and label collision. Writing that on Canvas 2D is a large project in itself.

## Decision

Render with MapLibre GL JS. Workers build MVT tiles from the model with geojson-vt and vt-pbf and serve them through addProtocol. Model coordinates are planar metres; the tile builder converts to a synthetic lon/lat around (0, 0) where Mercator distortion is negligible. Themes compile to MapLibre style JSON and to SVG styles.

## Consequences

The ink theme is approximated in MapLibre (hatch sprites, cased lines, sketch jitter); a PixiJS renderer behind the same tile source is the fallback if a Phase 1 spike fails. SVG export is a separate walker over the model.
