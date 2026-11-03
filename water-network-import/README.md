# Water Network CAD import

Imports DWG/DXF through an auditable review workspace and the existing Design approval
workflow. Source drawings are immutable. Cleanup changes the candidate import only;
it never deletes existing GIS assets.

## Operator flow

1. Open GIS → **Import DWG / DXF** (`/gis#import`) in the selected organization.
2. Upload one or more drawings as a batch. Re-uploading the same set of file bytes in
   the same tenant returns the existing batch. Different tenants have separate jobs.
3. Review the layer and block inventory. Map pipe layers to confirmed diameter and
   material; map block placements to nodes or devices. Interior symbol strokes remain
   references. Unmapped objects must be explicitly classified, retained as references,
   or excluded.
4. Compare the source and candidate previews. Select individual objects to exclude or
   undo an exclusion. Exact duplicate lines with identical mapped attributes are merged
   with both source references retained. Attribute conflicts are errors. Near overlaps,
   crossings, possible tees and dangling endpoints require review.
5. Confirm the source CRS or pair CAD points with corresponding GIS locations and record the evidence. Meter tolerances are applied in a
   local metric working projection, after conversion. A local drawing can be calibrated
   through the review workspace with at least three non-collinear control points plus an
   independent check point. No CRS is inferred from coordinate magnitude or place name.
6. Re-run review. Resolve blocking errors and explicitly acknowledge relevant warnings.
   Optional snapping, short-line removal, simplification and confirmed tee splitting are
   recorded in the review configuration and per-feature provenance. Generic crossings
   never become connected nodes automatically.
7. Send the verified candidate to Design. The operation atomically creates a project,
   revision, drafts and import receipt; its stable import key makes retries idempotent.
   Review geometry is frozen once submission starts. Use the Design workflow to address
   a revision that has already been created.
8. Record the drawing's lifecycle evidence and approve with an authorized account.
   Follow the per-asset publication results until Design reports completion. Approval
   alone is not proof that GIS has received every asset, and import does not establish
   that a pipe is in active operation.

The workspace is a preparation view. Cross-job geometric reconciliation against an
existing authoritative network remains an operator responsibility. Identical source
batches and existing asset codes are protected against duplicate creation, but different
CAD revisions can describe the same physical asset with different source identifiers.

## Run locally

Use Python 3.11 or later and LibreDWG `dwg2dxf` for DWG files. DXF requires no converter.

```sh
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/pip install --no-deps -e .
.venv/bin/pytest -q

# Read-only inspection: no tenant, credentials, database or publication required.
.venv/bin/wn-import /path/drawing1.dwg /path/drawing2.dwg --output /path/review-output
# Repeat with an edited review-config.json to prepare a verified candidate.
.venv/bin/wn-import /path/drawing1.dwg /path/drawing2.dwg \
  --config /path/review-config.json --output /path/review-output
```

The CLI emits inventory, original-coordinate features, review configuration, diagnostics,
review results and prepared draft assets. Features in CAD coordinates must not be used
as longitude/latitude GeoJSON. `coordinateSpace` in the review declares the actual space.
`draft-assets.json` can be empty when the source coordinates have not been established.

For the authenticated HTTP service, configure `IMPORT_JWT_ISSUER`,
`IMPORT_JWT_AUDIENCE`, `IMPORT_ALLOWED_CLIENTS`, `IMPORT_DATA_DIR` and
`IMPORT_DESIGN_URL`, then run:

```sh
.venv/bin/uvicorn wn_import.api:create_app --factory --host 0.0.0.0 --port 8090 --workers 1
```

There is no development authentication bypass in the application. Production validates
RS256 signatures, issuer, audience, expiry, authorized client, permissions and exactly
one selected Keycloak organization. `organization:<alias>` must match its signed
`tenant_id=tnt_<alias>` attribute. A caller-supplied tenant header is never authoritative.
Legacy flat tenant claims require an explicit `IMPORT_ALLOW_FLAT_TENANT=true` opt-in;
the supplied manifest disables this fallback.

| Operation | Required permissions |
| --- | --- |
| Inspect jobs, features, reports | `network-design:read` |
| Upload and change candidate review | `network-design:write` |
| Send to Design and validate | `network-design:write`, `network-design:read`, `network-gis:read` |
| Approve and follow publication | `network-design:approve`, `network-design:read` |

## HTTP contract

All routes are under `/api/gis/imports`. The canonical BFF streams these requests to
`Downstream__Import__BaseUrl` with the original bearer token. It does not automatically
retry writes. Responses are direct JSON objects, without an additional data envelope.

| Method/path | Purpose |
| --- | --- |
| `GET /capabilities` | Formats, available converter, file and draft limits |
| `GET /`, `POST /` | Tenant jobs; multipart fields `files` repeated and `name` |
| `GET /{id}` | Current job/version, inventory, issues, submission receipt |
| `PUT /{id}/review` | `ReviewConfig`, including optimistic `expectedVersion` |
| `GET /{id}/features?view=raw|clean&offset=0&limit=2000` | Paged features and coordinate space |
| `GET /{id}/report` | Full result and actor/action/version audit download |
| `POST /{id}/submit` | `expectedVersion`, optional `projectName` up to 160 characters |
| `POST /{id}/publish` | `expectedVersion`, optional `reason`, lifecycle evidence |
| `GET /{id}/publish-result` | Refresh Design status and individual publication receipts |

Stale writes return 409. Submission persists its key before contacting Design and its
receipt before validation. Retry uses the same key and name. A status poll cannot mutate
the version owned by an in-flight write. On process restart, interrupted analysis is
requeued and interrupted writes become available for reconciliation. Bearer tokens are
never persisted in jobs or audit rows.

### Direct source CRS, axis order and units

Supply the verified `sourceCrs` (or per-file `fileCrs`) explicitly. Optional
`sourceAxisOrder` is `"xy"` (default) or `"yx"`; `sourceUnits` is `"m"` (default)
or `"mm"`. In direct-source mode, `yx` swaps each raw pair to easting/northing,
then `mm` divides both coordinates by1000 before the supported CRS-to-WGS84
operation. Millimetres require each effective source CRS to be projected with
two metre axes; geographic, geocentric and foot-based CRSs are rejected for `mm`.
The default `m` performs no scaling and preserves existing geographic CRS inputs.
The choices apply to every file in the batch; separate batches with differing CAD
axis/unit conventions. Original CAD coordinates are never modified.

`sourceCrsPresetId` is optional selection metadata (maximum120characters). It
does not determine or validate `sourceCrs`, assert a province-wide cadastral CRS,
or replace survey evidence. Datum transformations still use `allow_ballpark=False`.
For every mode, missing `crsEvidence` permits a valid geographic review overlay
but produces zero asset drafts. Confirm source documentation and control locations
before submitting a Design draft; a mathematically supported transform does not
prove survey accuracy.

Direct-source axis/unit options must remain `xy`/`m` whenever `controlPoints` or
`controlPointTargetCrs` is present, including incomplete pair drafts. Conflicting
nondefault options are rejected by request validation rather than silently applied.

### Corresponding CAD and GIS points

`ReviewConfig.controlPointTargetCrs: "EPSG:4326"` explicitly selects GIS point mode.
Keep `sourceCrs: null` and `fileCrs: []`: this mode does not assert that the CAD has
a known CRS. Each `controlPoints` entry is
`{source: [cadX, cadY] | null, target: [longitude, latitude] | null, checkOnly: boolean}`.
Half-pairs and incomplete sets can be saved and audited; they remain `needs_review`
and cannot create draft assets. There are at most100 pairs. Omitting the marker
retains the existing contract where targets are in the projected `sourceCrs`.

The server derives a local ellipsoidal WGS84 azimuthal-equidistant plane, in metres,
centered at the arithmetic mean of fitting-target longitude/latitude. Independent
check points do not affect the center or fit. All targets must be valid WGS84 and
span at most1degree in each axis; split larger areas or drawings with different CAD
frames into separate batches. One transform applies to the whole batch. It is not
inferred from a place name, coordinate magnitude or an invented CAD EPSG code.

An authoritative affine transform requires at least3 fitting pairs and1 independent
check pair, distinct locations and non-collinear distribution in both spaces.
The source coordinates are centered and normalized before least-squares fitting.
Near-degenerate fits (relative singular value≤1e-8), duplicate points, invalid
coordinates and errors above `controlPointMaxErrorM` are rejected. The threshold
defaults to0.2m and may be explicitly set in the range(0,10]m. Every fitting and check
point must meet it. Snapping, simplification and minimum-length settings remain
independent; matching points does not enable them.

The current job and report expose `georeference` diagnostics: `status`
(`incomplete`, `invalid`, `valid`), `targetCrs`, `fitPointCount`, `checkPointCount`,
`thresholdM`, `maxErrorM`, `rmseM`, `residuals:[{index,checkOnly,errorM}]`, `workingCrs`
and `error`. Unavailable numbers/CRS/error are null. Indices match saved pair order.
These diagnostics evaluate the transform; `valid` alone is not publication approval.
Use the server-produced `clean` features with `coordinateSpace: "EPSG:4326"` for
the geographic overlay. Raw features always retain CAD coordinates. A valid fit
without `crsEvidence` may show an overlay but produces no drafts. Existing material,
device host, warning, lifecycle and Design approval gates remain mandatory.

## Deployment and limits

The Dockerfile builds LibreDWG 0.14 from a checksum-verified release, pins both base-image
digests and Python dependencies, runs as a non-root user, and includes the converter's
corresponding source and GPL license. Review license obligations when distributing the
image outside the organization.

`deploy/runtime.yaml` supplies a **single replica** and a persistent volume. SQLite WAL,
source files, converted drawings and review versions share that volume. Do not increase
the replica count or start multiple API workers against it. Scale-out storage/queueing
and automatic retention are not implemented. Back up the full persistent volume using
a SQLite-consistent snapshot and monitor disk usage before running a shared service.

Limits: 10 files per batch, 50 MiB per file, 100 MiB request body, 100,000 extracted
features, 2,000,000 curve vertices per file, 180-second DWG conversion timeout and
20,000 prepared assets per Design revision. Curve flattening uses 0.01 drawing units;
it is distinct from the explicitly selected meter cleanup tolerances. Diagnostic logs
are retained, and skipped converter entities or missing XREFs are review warnings.

The worker reports HTTP 503 if its required background worker exits. It uses one process
and restarts deterministic analysis after interruption; deployment uses `Recreate` to
avoid concurrent volume ownership. Kubernetes imposes CPU/memory/temp-space limits.

Before enabling the route, deploy the additive Design receipt migration and compatible
Design/BFF images. Configure the Design S3 provider against the existing private MinIO
with a restricted credential. Add only the import route to APISIX and the matching
NetworkPolicy rules; preserve existing routes. Use the backend
[rollout runbook](../water-network-be/docs/superpowers/plans/2026-09-14-cad-import-backend-runbook.md)
for exact service names, permissions, storage setup and rollback considerations.

## Scoped DEV gateway rollout

The DEV gateway owns a new water-network-cad-import route for /api/gis/imports and /api/gis/imports/*, priority 130. It retains bearer-only JWKS authentication and the existing CORS origin list. The route points to canonical water-network-bff:8080, with 5s connect and 120s read/send timeouts. The worker and BFF enforce a 100 MiB request limit. The separate ingress-dev.yaml applies the same limit to this path on both existing API hosts, with request buffering disabled.

prepare-route-patch.rb creates a resourceVersion-guarded JSON patch from a fresh live apisix-config. It verifies that all existing routes and other gateway configuration remain structurally unchanged. It never edits the older manual-staging reconciler or its approved three-route manifest. Treat input/patch backups as potentially sensitive configuration: keep mode 0600, do not log their contents, and apply only after worker/BFF readiness.

After applying, restart the APISIX Deployment through its rolling strategy because its ConfigMap files are mounted with subPath. Verify the exact live route and unchanged prior-route fingerprint, CORS preflight, unauthenticated 401, and health of the pre-existing bootstrap/map routes. For rollback, remove only this exact new route from a fresh live ConfigMap with a resourceVersion guard, roll APISIX, and remove the dedicated ingress. Do not restore an old whole ConfigMap over later changes from other workstreams.

## Supplied Vĩnh Thịnh drawings

The two supplied originals are retained at their original paths and identified by SHA-256.
Inspection found unspecified CAD units, no trustworthy embedded CRS and a missing shared
background XREF. The distribution lines overlap between files and must be reconciled by
segment. Service-pipe material is not identified in the second file. These gaps remain
blocking evidence requirements, not values that the importer invents.

The 2026-09-14 SHW inspection package contains the actual-file analysis and a suggested
mapping configuration with unknown values left blank. Local upload/preview verification
is separate from a production upload: no SHW organization existed in the inspected live
realm, and provisioning requires the actual administrator/contact details.

## Editable draft lines (2026-09-24)

Review config accepts optional `lineEdits`: pipe records with `id`, `fileId`, `layer`, raw CAD `coordinates`, optional DN/material and `sourceFeatureId`. Existing IDs replace only editable source LineStrings in their original file/layer. New IDs start with `draft-`; split children retain their source reference and their parent is excluded. The server rejects foreign references and duplicate IDs and limits total edited vertices to 100,000. Edits are applied to a copy before the existing CRS, cleanup, topology and Ready gates. They never overwrite source-features.json or uploaded files. Missing metadata is accepted in a draft and remains a quality error. `connectEndpointFeatureIds` records explicit tee confirmation; no automatic connectivity is inferred from a generic crossing.

### Append and remove draft CAD files

`POST /api/gis/imports/{job_id}/files` accepts multipart files and expectedVersion. It adds content-addressed originals atomically to an editable job, preserves review mappings, clears warning acceptance and queues a fresh source-set cache. Existing tenant/write/version/frozen-job gates apply. At most ten source files (including reversibly removed files) may belong to a job. Duplicate/empty/unsupported files are rejected without altering the job. Failed CAS may leave unreferenced immutable bytes, not partially committed file lists.

Review accepts excludedFileIds (up to ten owned file IDs). Analysis excludes those files and attributable source issues from candidate outputs; source bytes/configuration remain for restoration. Removing all sources produces a needs_review empty draft. Existing legacy inventories without file attribution conservatively retain unassignable global diagnostics. New conversion diagnostics include fileId.

### CAD positioning before layer mapping

The first clean feature page now includes an optional `drawing` overlay (features, coordinateSpace, bbox, total, hasMore, error). This read-only server projection uses saved source CRS/axis/units or validated control points, independently of pipe classification, and excludes XREF and explicitly removed sources/features. It is capped at 10,000 displayed CAD objects. Invalid transforms return an empty overlay and an actionable error; no raw CAD coordinates enter the GIS map. The positioning map fits this overlay even when clean network features are empty. This does not create drafts, supply survey evidence, accept warnings or relax Ready gates.
