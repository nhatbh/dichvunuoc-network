# Design

## Data boundary and recovery

The runtime default is `gisDataSource=legacy`. The historical `canonicalViewer` feature flag does not select that backend boundary. The isolated SHW ConfigMap declares `gisDataSource=canonical` and `gisViewerMode=rich`, preserving its other fields and strict Organization policy.

`parseLegacyGisData(raw: unknown)` checks required outer arrays/objects, finite positive world dimensions, and dashboard/dataflow collections. Only an absent legacy `sourceDevices` becomes `[]`. Explicit malformed values and canonical data passed into the legacy parser are rejected. Canonical data never falls back to the global seed, and the canonical adapter retains its source devices.

The legacy route owns a render error boundary. Retry awaits the new response before resetting it, allowing one action to recover when corrected data arrives. This complements outer contract checks; those checks do not validate every nested legacy geometry.

`TenantGisState` exposes one `Import CAD` link to `/gis#import`. Import can open before any network is published. No geometry, tenant identity or CRS evidence is fabricated.

## Entitlement dependency

Catalog `/me` retains its role-filtered menu contract. The additive authenticated `GET /api/platform/app-catalog/me/apps/{appCode}/access` instead checks a trusted app/client binding, the signed selected Organization, application existence and enabled tenant/application record. Ambiguous or conflicting identity claims fail closed. Alias and canonical tenant rules match the BFF contract.

The BFF forwards the original bearer and still enforces each GIS endpoint's permissions. Headers cannot provide another selected tenant. No broad realm-role grant or change to menu visibility is used to unlock GIS.

Catalog source tests use a frozen harness against exact deployed assemblies, avoiding an unrelated production dependency upgrade. Passing that harness does not replace final runtime verification.

## Scoped delivery

The FE rollout changes only the SHW image, two runtime keys and merged provenance annotations. Preparation guards resource versions and the reviewed prior image. Verification compares the Deployment spec, unrelated ConfigMap content, provenance, two Ready replicas and shared-resource hashes.

Shared GIS FE remains unchanged. The FE helper does not own gateway, IAM, probes, resource limits or network-policy changes. Necessary BFF/catalog delivery is verified by its owning work; the FE image alone does not prove that dependency works.
