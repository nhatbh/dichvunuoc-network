# Validation

## Pre-release evidence, 2026-09-15

- Frontend: all 59 focused tests passed across import integration, source-CRS
  panel, georeference component/model, CAD preview and import-route regressions.
- Full application TypeScript checking passed. Existing non-failing test
  environment/ownership warnings are separate from browser verification.
- Worker: 90 tests passed, including explicit source axis/units, preserved raw
  coordinates, unsupported unit/CRS combinations, point-mode isolation and
  zero drafts when evidence is absent.
- Catalog: all 63 unique names and decimal meridians matched the official
  TT26/2024 Annex 01 PDF; printed pages 80–81 were also visually checked. EPSG
  identifiers and parameters were compared with the official PROJ database.
- A local fixture using the actual map engine and both provided DWGs rendered
  9,880 raw CAD features and 813 EPSG:4326 preview features, with zero asset
  drafts. Desktop and 640 px narrow layout checks passed. This validates the
  workflow under an explicitly supplied fixture CRS, not the true survey CRS
  of the user's drawings.

The real-workspace 409 regression starts with EPSG:5897 / Vĩnh Phúc / XY / metres,
receives server revision 7 with EPSG:3406 / Đắk Lắk / UTM49N / YX / millimetres,
checks every restored control, and verifies the next preview request uses the
recovered settings and expected version 7. Saved-source reopening also checks
raw CAD/geographic preview separation, no extra review POST and blocked
submission without evidence.

## SHW DEV release and authenticated verification

Source: `2ff8bdeaeddd03ecdb28f70b94518f1e2e95b243`, frozen from a clean Git archive.
Worker: `sha256:f3e9b79737d99568c6e6209224799758b3479dfb57a93a89e54d4271b39e3a8c`, Ready 1/1.
SHW frontend: `sha256:c09269cadfa60ac1a14221378ac7d63a49c1e0c1c5b20df2dd939e9d0cba68ce`, Ready 2/2.
The installed worker image also passed all 90 tests.

The public HTML exactly matches the verified image; its referenced assets return
200. The configured API import endpoint returns 401 without authentication.
An authenticated SHW tab loaded the two-DWG job at version 4 with all 9,880 raw
features, both alignment tabs, 63 locality options, three projection choices,
axis/unit controls and the real map. Explicit data reload succeeded. Source CRS
stayed unset; no review, evidence, submit or publish request was made.

Both SHW jobs remain version 4, with eight audit records. Deployment verification
confirmed every job row, audit record, stored file, unrelated deployment setting,
shared frontend and ConfigMap stayed unchanged. The user's existing tab contains
unsaved edits and was preserved; the verified interface is open in a separate tab.

One transient token-refresh console error occurred during browser reload;
subsequent authenticated selection and explicit data reload succeeded without
additional errors. There were no CAD/GIS rendering errors. One transient SSH
read failed and succeeded on a read-only retry; deployment was not reapplied.
No live survey CRS is certified by this release.

Evidence: `output/shw-import-map/2026-09-15/` at the parent workspace contains
`vn2000-frontend-tests.json`, `vn2000-frontend-regression-tests.json`,
`vn2000-local-smoke.json`, `vn2000-public-smoke.json`,
`vn2000-authenticated-smoke.json`, both `vn2000-*-release/verification.json`,
build provenance and `HUONG-DAN-VN2000.md`.

Sources: [TT26/2024](https://congbao.chinhphu.vn/van-ban/thong-tu-so-26-2024-tt-btnmt-43701.htm),
[PROJ/EPSG CRS identities](https://github.com/OSGeo/PROJ/blob/master/data/sql/projected_crs.sql),
[parameters](https://github.com/OSGeo/PROJ/blob/master/data/sql/conversion.sql).
