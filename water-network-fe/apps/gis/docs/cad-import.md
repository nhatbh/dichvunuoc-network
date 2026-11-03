# CAD import workspace

The `/gis#import` entry opens independently of published GIS data, including an empty tenant and deployments in Design editor mode. The rich GIS navigation and scalable viewer both link to it. This replaces the former demo import workflow; all jobs, uploads and decisions use the authenticated `/api/gis/imports` service (or `${VITE_API_URL}/imports`).

## Behavior

- Upload multiple original DWG/DXF files into one durable job; server capabilities control formats, converter availability, per-file bytes and file count. The browser never sends a tenant override.
- Inspect source checksums, per-layer inventory, suggested mappings, raw entities and clean output. Apply layer classifications singly or in a batch; missing diameter/material remain missing. Material input validates against the canonical catalog: HDPE, PVC, DuctileIron, Steel, CastIron and Concrete; unsupported hints require an explicit reviewer decision.
- Classify INSERT blocks explicitly as reference, excluded, node or device. Type and host selections are explicit. Child symbol geometry remains reference material. Device hosts use original feature IDs, validated by the service for permitted host kind and distance.
- Exclude individual raw features reversibly. Undo restores the previous inclusion decision. Source files are never modified.
- Record source CRS and documentary evidence. An unknown CRS permits raw drawing review but blocks submission. Lifecycle evidence can be recorded in review or by an authorized approver at publication.
- Preview has pan, keyboard zoom, fit, file/layer filters and an accessible feature selector. It loads 2,000 features per page, up to 10,000. UI shows loaded/displayed counts separately from server totals; reports cover the complete job. The list selector shows 200 filtered entries.
- **Lưu bản nháp** persists the current import review against `expectedVersion` even while CAD/network quality errors remain. Uploaded source files are already durable. Reopen an incomplete draft from **Hồ sơ bản vẽ**, whose options include its status, and continue editing. Saving reanalyzes asynchronously; it never submits to Design. **Ready · sẵn sàng gửi duyệt** is assigned by the server only after errors are resolved and warnings are acknowledged. **Gửi duyệt bản Ready** then creates Design drafts and submits for approval. Invalid request values and foreign/stale references still fail rather than corrupting the saved draft. Submission requires `network-design:read`, `network-design:write` and `network-gis:read`; publication requires `network-design:approve` and `network-design:read`, a reason and lifecycle evidence. The service remains the authority for all permissions and quality gates.
- A failed Design submission can be retried from its stored `Draft`/`RetryRequired` receipt. HTTP 409 or ambiguous 502 refreshes the persisted job before further action.

## Isolation and failure handling

Every request captures a user/tenant scope and checks it before acquiring credentials and again before dispatch. Session changes abort active requests, clear source files, jobs, selection and review state, and ignore late results. Feature pages carry a version; pages from different versions or coordinate spaces are never combined. Mutations are disabled while processing; a stale review is refreshed instead of silently overwriting another reviewer.

Legacy `tenant_id` sessions are explicitly blocked from CAD jobs before requests are made, with guidance to contact an administrator for an Organization-scoped login. DEV can preserve the existing GIS login through the explicit runtime compatibility policy `organization: { context: "disabled", allowLegacyTenantIdFallback: true }`; this does not relax the CAD worker's Organization requirements or provision a tenant. Local backend-session tests without a provenance field remain supported.

API responses are parsed with Zod. Optional nullable CAD attributes normalize to undefined; no material, diameter or coordinate system is fabricated. Errors from unavailable services, expired sessions and missing permissions are visible without falling back to sample data. Quality reports use authenticated fetch and a short-lived blob URL.

## Verification

Run from `apps/gis`:

```sh
npm exec -- tsc --noEmit
npm exec -- vitest run src/pages/gis/import-workspace/import.test.tsx src/pages/gis/import-workspace/import-route.test.tsx src/pages/gis/gis-home.test.tsx
npm run build
npm run size
```

Tests cover multipart uploads/auth scope, editable row focus, layer mapping, reversible exclusions, CRS evidence gating, block/device host selection, approval evidence and permission gating, persisted submission retries, stale versions, tenant-switch cancellation, response parsing, service failures, and import access without a published network.

The repository's Harness instructions were read; `scripts/bin/harness-cli` is absent in this checkout. The overall CAD import implementation plan and backend verification are maintained by the coordinating task.

## Original DWG integration evidence (local, 2026-09-14)

The actual Solid app uploaded both supplied original DWGs through native browser multipart into an ephemeral local service bound to 127.0.0.1. Only the test login response was injected; conversion, inventory, paging, review and storage used the real implementation. No production auth bypass was added. The resulting local job `fbf7cdaa-6452-4078-9f6b-9691c763165c` contained 9,880 raw entities across 28 layers and 16 block definitions. Five pages loaded the full preview without JavaScript errors.

A pipe-layer selection and individual exclusion were exercised, undone, reapplied, saved and verified after browser reload (version 4). Source CRS, missing diameters and materials stayed unknown; server validation continued to block submission. A 390 px viewport had no horizontal overflow. This is local integration evidence, not publication into the operational SHW network.

## Draft map and issue navigation

In the rich network map, **Mạng đã xuất bản** and **Bản nháp đang chỉnh sửa** switch between published network data and the durable CAD review workspace (`#map-drafts`). The draft opens in the existing GIS alignment view with source CAD alongside the map. It remains a review overlay, never a published asset. Unknown CRS or invalid alignment still needs correction before a geographic overlay can be drawn. Users choose a saved job and return to drawing edits without submitting it.

The quality panel filters by severity, code and text/feature ID, with 50 issues per page across the full report rather than truncating after 200. Common issue groups explain the next action. Locating an issue clears file/layer filters before selecting its source object; preview limits still apply. The layer panel documents existing automatic cleanup and makes clear that edits take effect on saving. Closed pipes can be split explicitly with the draft editing tools; field attributes are never inferred.

## Draft line editing

The CAD review canvas now exposes draw, move vertex/endpoint, insert vertex, split, exclude/restore, per-pipe DN/material and unsaved undo/redo (50 steps). Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z work outside form fields; Escape cancels the current sketch. Pick mode reuses the CAD screen transform, vertex snapping and the editor model's segment projection. Line snapping is limited to pipe candidates and 8 screen pixels. Endpoint-to-body topology changes require **Xác nhận đấu nối đầu tuyến** and server reanalysis; generic crossings stay unconnected.

Geometry is recorded as `lineEdits` in raw CAD coordinates with stable IDs, source file and optional original feature reference. This avoids guessing an inverse CRS transform. The aligned GIS map updates after saving and reanalysis. Original source files remain immutable. Split children use new `draft-` IDs and exclude their parent without deleting it. Unknown DN/material remain empty and continue to block Ready. Saved candidates and reports carry manual-edit provenance. The displayed raw candidate is labelled **Bản CAD đang sửa** rather than implying unchanged source geometry.

The worker validates file ownership, original feature type/file/layer, source references, unique IDs, finite geometry and size limits. This additive review contract must deploy to the worker before the new frontend. Existing jobs without edits remain valid; submission still freezes review and requires all quality gates. Tests cover reload/restart, source immutability, tenant isolation, missing-attribute gates, drawing/splitting, undo/redo and projection.

For canonical-rich SHW, `#editor` opens the same saved import draft workspace. Returning from GIS alignment selects the raw CAD editing view immediately.

## File management and guided issues (2026-09-24)

Visible file cards distinguish new-job upload from appending to the current job. Pending selections can be removed individually. `POST /imports/{id}/files` uses multipart `files` plus `expectedVersion`; the worker enforces tenant/write permission, version, draft state, content deduplication and the existing 10-file/50-MiB limits. Appending preserves existing review decisions, clears warning acceptances and rebuilds the source set under a new cache identity. Unclassified new layers appear for review, never silently Ready.

`excludedFileIds` on review is reversible removal from the working draft, not permanent source deletion. File cards offer Restore, and explicit Save persists removal/restoration along with other review edits. Removed files are excluded from raw/clean candidate results and their attributable issues; old source bytes and mapping decisions remain available. Empty drafts are valid but cannot become Ready. The ten-file storage limit includes removed files. Saving/processing status and dirty changes are visible above the workbench. Selecting an issue retains its explanation over the canvas with next-issue navigation; the banner clears after reanalysis.

The active file list now contains only currently used sources and offers **Xóa tệp**. Deleted files disappear immediately from that list and move into a separate, collapsed **Tệp đã xóa** section; Restore lives only there. Both actions remain explicit draft changes until saved. This is a trash-style UI, not permanent deletion of original source bytes.

### CAD positioning before layer mapping

The first clean feature page now includes an optional `drawing` overlay (features, coordinateSpace, bbox, total, hasMore, error). This read-only server projection uses saved source CRS/axis/units or validated control points, independently of pipe classification, and excludes XREF and explicitly removed sources/features. It is capped at 10,000 displayed CAD objects. Invalid transforms return an empty overlay and an actionable error; no raw CAD coordinates enter the GIS map. The positioning map fits this overlay even when clean network features are empty. This does not create drafts, supply survey evidence, accept warnings or relax Ready gates.
