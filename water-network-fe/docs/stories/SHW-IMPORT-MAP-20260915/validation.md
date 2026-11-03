# Validation

Required: map is visible first; selecting geometry highlights and opens inspector; selected layer edits remain scoped; paired CAD/GIS points can be added/edited/removed and preserved through save/reload; drag does not place points; inverse mapping preserves aspect/pan/zoom; incomplete/collinear/duplicate/large-residual configurations cannot become GIS-ready. Existing auth, stale response and import behavior must remain.

Fixtures test numeric transforms and UI interaction; actual SHW session tests layout, real files and readonly map interaction. Real SHW geographic control points must be provided/confirmed by the reviewer; no invented pairs are saved for deployment smoke. Final command and release evidence will be appended after verification.

## Pre-release evidence

- Worker: 58 tests passed, including persisted partial pairs, WGS84/local metric fit, independent checks, degenerate/large-origin input and original CAD preservation.
- Browser at 1280×720 and 640×840: both original DWGs rendered as 9,880 CAD features; actual OpenLayers basemap loaded, CAD/GIS mouse picks yielded matching numbered markers; compact inspector and stacked narrow layout verified. Synthetic local points were never saved to SHW.
- Frontend regression covers map-first selection/edit/save, Escape and mode cancellation, partial-pair save, saved alignment reopen without a review POST, CAD/clean coordinate separation and existing import/auth behavior.
- Map-runtime: typecheck and 6 focused style tests passed, including numbered markers and unchanged unlabeled styles.
- Temporary UI fixture files were removed before source freeze. Release/data preservation proof follows the immutable image rollout.

Final frontend gate: 49/49 focused tests passed; full application `tsc --noEmit` passed. A non-failing Solid ownership warning appeared in mocked integration setup; browser behavior was verified separately.

## DEV release and authenticated smoke

- Clean build source: `4c59534db8e5349a8488f95d34b4bd198484735c`. Worker digest `82e3007071a7b6a9913b311cb64163a962b3bbcb42897aa0b4d7c3e6a3b97fc6` Ready 1/1; SHW frontend digest `4bf641b1f3ac97848ad6e97d1a49d033ec019f32d4778b0e885bbc3b40db15d8` Ready 2/2. Installed Linux worker image also passed all 58 tests.
- Guarded image/provenance patches preserved all unrelated spec, SHW/shared ConfigMaps and shared frontend. Both persisted jobs, 6 audit records and every stored file remained identical.
- Public index matches the verified frontend image byte-for-byte; six linked assets returned HTTP 200. Anonymous import access still returns 401. Strict SHW organization/canonical/rich runtime unchanged.
- User reauthenticated; actual SHW browser loaded original job version 4 with both DWGs, progressively loaded all 9,880 raw features, opened 813 clean features and showed the contextual inspector after selection. Alignment then retained raw CAD on the left and loaded the actual GIS basemap on the right. No console errors, no pending review edits, and no live control-point writes.
- Evidence: main workspace `output/shw-import-map/2026-09-15/review-evidence.json`, `public-smoke.json`, `worker-dev-release/verification.json`, `fe-dev-release/verification.json`, plus the Vietnamese operator guide.
- Real geographic point correspondences and remaining material/host/quality evidence still belong to the reviewer; this release does not certify or publish the source drawings.
