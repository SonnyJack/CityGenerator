# 0005. MapDocument: spec + authored + overrides + annotations, unconstrained size

Date: 2026-09-18
Status: Accepted

## Context

A full editor needs hand-drawn geometry to persist and survive regeneration. The owner does not require small documents; JSON import/export is the persistence contract.

## Decision

The document holds the generation spec, authored and frozen GeoJSON features, overrides, annotations and viewport. Derived results are never stored. Versioned schema with migrations. Autosave to IndexedDB; explicit .citygen.json export; URL hash only for small documents.

## Consequences

Every edit is a command that mutates the document; undo is by inverse JSON patch. Regeneration treats authored geometry as fixed.
