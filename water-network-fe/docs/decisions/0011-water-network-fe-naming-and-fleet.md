# 0011 water-network-fe naming + fleet (amends 0010)

## Status
Accepted — 2026-06-18

## Context
The fleet needs stable artifact names before MiniApps deploy to k8s and get
Keycloak clients. "gis-core" conflated the deployable app with reusability.

## Decision
- Service (deployable MiniApp): dir `apps/<slug>`, artifact `water-network-<slug>`.
- Reusable "core": shared `@wn/*` packages (e.g. `@wn/map-runtime`), never the app slug.
- Rename `gis-core → gis` (`water-network-gis`). Fleet (reserved): `gis`,
  `monitoring`, `simulation`, `importer`, `workflow`. The deferred "Analytics MFE"
  dissolves into `monitoring`/`simulation`.
- IOC (cross-domain read layer) reuses water-network MiniApps via app-catalog
  shell + shared realm SSO + `@wn/*` packages + read-models; it does not rename
  or copy them. Adding an IOC-hosted entry = adding a redirect URI to the existing
  `water-network-<slug>` client.

## Consequences
Artifact names are stable for k8s/Keycloak. Reuse is a package concern.
