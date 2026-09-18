# 0006. Seeded RNG with named, path-derived streams

Date: 2026-09-18
Status: Accepted

## Context

Determinism across browsers and stability of unrelated stages when one parameter changes.

## Decision

A small 32-bit generator (sfc32) seeded from a 128-bit hash of a path string. Forking appends a name to the path, so sibling streams do not depend on how many numbers their parent drew. Block and tile seeds derive from the region seed and their ids.

## Consequences

Math.random, Date.now and crypto.randomUUID are banned in engine code by ESLint. Golden hash tests guard output.
