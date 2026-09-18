# 0002. TypeScript, React and Vite

Date: 2026-09-18
Status: Accepted

## Context

The site must run on GitHub Pages with industry-standard tools; the owner chose React.

## Decision

TypeScript strict everywhere; React 19 with Zustand for the editor; Vite for build and workers; pnpm workspaces monorepo.

## Consequences

Engine packages stay DOM-free so they run in Node for tests, a CLI and an MCP server.
