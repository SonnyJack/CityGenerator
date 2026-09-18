# 0007. Browser-side bring-your-own-key assistant, Anthropic only

Date: 2026-09-18
Status: Accepted

## Context

GitHub Pages cannot host a proxy; the owner accepts bring-your-own-key and Anthropic only to start.

## Decision

Use the official @anthropic-ai/sdk in the browser with its explicit browser opt-in. Keys are stored only in localStorage on opt-in, never in documents or URLs. A minimal adapter interface allows other providers later.

## Consequences

Cost is shown per session. The assistant edits through the command bus only.
