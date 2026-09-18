# 0003. Hierarchical region/settlement/block model with lazy block generation

Date: 2026-09-18
Status: Accepted

## Context

Metropolitan regions contain on the order of a million buildings; generating and holding them eagerly is infeasible in a browser.

## Decision

Region and settlement stages run eagerly and produce block polygons with generation recipes. Parcels, buildings and fill are generated lazily per block, keyed by block id and input hash, cached with an LRU bound, and assembled into tiles.

## Consequences

Determinism must hold per block (tile-derived seeds). Editing recomputes only the affected scope. Exports at full detail stream block by block.
