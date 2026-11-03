# 0009 API Route Prefix: Service Routes Stay `/api/network/`, Versioning Belongs To The Gateway

Date: 2026-06-13

## Status

Accepted

## Context

The implementation roadmap (`docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`
§4.4) sketches API routes as `/api/v1/gis/...`, but the code shipped in GIS-1
(nodes, pipes) exposes unversioned routes `/api/network/nodes` and
`/api/network/pipes`. The GIS-2 backlog follow-up required this divergence to be
resolved before or during GIS-2, so a third resource (`devices`) does not deepen
the inconsistency.

Two questions were tangled together: (1) what URL prefix each service exposes,
and (2) where platform-wide API versioning lives.

## Decision

- Each service exposes routes as `/api/{bounded-context}/{resource}` with **no
  version segment**. GIS-2 ships `POST /api/network/devices` and
  `GET /api/network/devices/{id}`, consistent with the existing node/pipe routes.
- **URL versioning (`/v1/`) is the YARP gateway's responsibility**, to be
  introduced with the cross-cutting gateway slice (US-X). The gateway will map
  `/api/v1/network/*` to the service's internal `/api/network/*` route. Services
  do not self-version their routes.
- This is independent of **event payload versioning**: integration events keep
  their `EventVersion` field (e.g. `network.device.installed` v1) regardless of
  HTTP routing.

## Consequences

- GIS-2 and every new service use `/api/{bounded-context}/{resource}`. Read the
  roadmap's `/api/v1/gis/...` route sketches through this decision.
- The backlog follow-up "versioning prefix toàn platform" is closed.
- When US-X introduces the gateway, route-version mapping is added there, not by
  editing each service's endpoint modules.
