# Contributing

Thanks for helping build CityGenerator. Please read the
[design document](docs/DESIGN.md) and the [roadmap](docs/ROADMAP.md) first.

## Clean-room policy

CityGenerator is inspired by watabou's TownGeneratorOS, which is licensed under
GPL-3.0. This project is MIT-licensed and is a **clean-room reimplementation**:

- Do **not** copy, translate or closely paraphrase code from TownGeneratorOS or
  any other GPL project into this repository.
- Ideas, algorithms described in prose, and published papers are fine. If you
  learned an approach from the reference, describe it in your own words and
  implement it from that description.
- Pull requests that appear to contain ported code will be closed.

## Determinism

The generation engine (`packages/core`, `packages/features`, `packages/tiles`)
must be deterministic: the same document produces byte-identical results on
every browser and on Node.

- Never use `Math.random`, `Date.now`, `crypto.randomUUID` or iteration order
  of hashed collections in engine code. ESLint enforces the first three.
- Take randomness from a seeded `Rng`; fork a named stream per stage
  (`rng.fork('terrain')`) so unrelated stages stay stable when one parameter
  changes.
- Sort with explicit, total comparators. Break ties by id.
- Add or update the golden hash tests when you intentionally change output.

## Workflow

```sh
pnpm install
pnpm dev          # start the editor
pnpm check        # lint, typecheck, unit tests, build
pnpm e2e          # Playwright end-to-end tests (see apps/web/README.md)
```

- Branch from `main`; open a pull request; CI must be green.
- Keep commits focused and messages descriptive.
- New architectural decisions get an ADR in `docs/adr/`.
- New feature types, zone profiles, era profiles, biome packs and culture
  packs are data in `packages/features`; include a reference gallery seed list
  in the pull request so reviewers can judge the output.

## Code style

TypeScript strict, Prettier formatting, ESLint clean. Prefer small pure
functions in the engine; keep DOM and React out of `packages/*` except
`packages/editor` (framework-agnostic) and `apps/web`.
