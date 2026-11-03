# Validation

Status: source tests, scoped delivery, fresh authenticated `/gis`, import access, both original DWG uploads and persisted initial review passed. **The data remains in review; no GIS draft or asset publication was created.**

Evidence package in the main workspace: `output/shw-gis-crash/2026-09-14/`. Sanitized records are authoritative; credentials, bearer tokens and private snapshots are excluded.

## Regression evidence

The initial authenticated `/gis` failure called `sourceDevices.map` on a legacy seed that omitted the collection. The response contained 1,186 sample pipes. SHW lacked an explicit data-source setting, so the legacy default was selected.

`regression-proof.json` records 59 tests passing across nine suites, two pure runtime-policy tests passing separately, and app typecheck passing. The fixture is committed `apps/gis/src/shared/api/mocks/gis-full.json`. Tests preserve its pipes while supplying the absent collection, prevent malformed HTTP-200 payloads from mounting the map, preserve canonical devices, and prove the canonical empty landing makes no `/full` or map request while import remains reachable.

Run from `apps/gis`:

```sh
node_modules/.bin/vitest run \
  src/pages/gis/gis-home.test.tsx \
  src/pages/gis/legacy-gis-home.test.tsx \
  src/pages/gis/lib/legacy-gis-data.test.ts \
  src/pages/gis/lib/canonical-gis-data.test.ts \
  src/pages/gis/gis-runtime-landing.test.tsx \
  src/pages/gis/import-workspace/import-route.test.tsx \
  src/pages/gis/lib/tenant-home-view.test.ts \
  src/shared/config/runtime-config.test.ts \
  src/pages/gis/map-page.test.tsx
node_modules/.bin/tsc --noEmit
```

The existing Node-environment runtime suite hit `jest-dom` resolution in shared setup under temporary dependency symlinks. Its two pure assertions passed with a recorded temporary Node-only config and no DOM setup. This is a harness limitation, not a pass through unchanged standard setup. No lockfile changed.

`review-proof.json` records the later four-test legacy-home run, including one new render-error recovery case: an invalid nested device throws during rendering; one retry receives corrected data and restores the map. It also records removal of temporary package dependency links.

The SHW rollout helper's 11 stdlib tests passed:

```sh
python3 -m unittest discover \
  -s deploy/k3s/water-network-gis/overlays/shw-dev \
  -p test_prepare_canonical_patches.py -v
```

They cover exact owned changes, unknown-field/sidecar preservation, resource-version/image guards, strict scope and policy, provenance, readiness and shared-content drift. A concurrent overwrite was corrected by restoring the 11-test suite and rerunning it successfully.

## Verified frontend delivery

Sources: `build-manifest.json`, `build-metadata.json`, `frontend-release.json` and `frontend-public-smoke.json`.

| Item | Verified value |
| --- | --- |
| Source commit | `76962e9eef6c3ac7c0616a34fb46c0422f076694` |
| Snapshot SHA-256 | `7930b72fe54cc3ad1c7dbbb3663f2efef0e4e98317a7423f08f6159d2af247fe` |
| Source state | Clean git archive; 481 files |
| Platform | `linux/amd64` |
| FE image digest | `sha256:ce7224e1ddb45d6d2757970efe6bc2ad85e096938d1130578e575020404b2064` |
| Deployment and ConfigMap | `platform-core/water-network-gis-shw` |
| Runtime | `gisDataSource=canonical`; `gisViewerMode=rich` |
| Readiness | Two Ready replicas |
| Preserved scope | Other runtime fields; Deployment spec except image/provenance; shared FE Deployment, ConfigMap, Service and Ingress hashes |
| Public requests | `/health`, `/config.json`, `/gis` and referenced assets returned HTTP 200 |

This is a manual DEV release with immutable digest and clean source identity. The public results prove delivery and reachability, not authenticated API access.

## Entitlement source evidence

The first dependency correction has 27-unit/24-integration-test and release records under `bff-entitlement-dev-release/`. Later diagnosis required the additive app-access contract. `bff-access-build-manifest.json` records clean source `8e7d237f7c492d96ce137be60cd256ce11edc20b`, eight unit tests and 24 integration tests passing. The subsequent `bff-access-release.json` is authoritative for deployment: digest `sha256:c9994d97f405a30092758f4bd57bab71b15021be53f1ffe4501c891ed1f09313`, two updated/Ready replicas, environment preserved, and full spec unchanged except the intended image/provenance.

`catalog-access-dev-release/deployment-result.sanitized.json` records catalog digest `sha256:a5cfbe10d9a5a7e1c9f328410d87ee68103e62e06cc03b375ea9da4c146a49e8` from clean source `fc398cd8d573df2ad70b746983674afa66042841`, one Ready replica and the trusted `ml-0` to `water-network-gis-fe` binding. Other spec fields, namespace ConfigMaps and catalog database state were unchanged; the four existing migrations were retained. No IAM or network-policy write was made by that catalog release. The anonymous new endpoint remained 401.

`app-catalog-access/validation.json` records all 71 catalog tests passing with no failures or skips. Actual route tests cover anonymous 401; enabled SHW 204; malformed/conflicting selections, missing binding/app and disabled entitlement 403; unchanged role-filtered `/me`; ignored tenant headers; and no database saves/events during access reads.

Catalog tests used SDK 10.0.101 in a frozen copy referencing exact deployed assemblies. The normal repository restore otherwise fails NU1605 because floating EF.Design resolves newer than pinned Relational. No tracked dependency or repository SDK setting changed. The isolated handler supplies controlled authenticated claims; this is not cryptographic JWT verification.

## Final authenticated and import proof

The coordinating agent confirmed the real logged-in SHW browser at `/gis#dashboard` showed `Đơn vị chưa có dữ liệu GIS`, one `Import CAD` link and no global map error. Import capabilities and jobs loaded without 403: the DWG reader was ready, the configured limits were ten files/50 MB, and the job list was initially empty.

Correlated evidence in `catalog-access-dev-release/authenticated-path-observation.sanitized.json` and its deployment result records catalog access 204 and import capabilities, job list and canonical bootstrap 200 during `2026-09-14T11:08:14Z`–`2026-09-14T11:08:56Z`. `database.after-authenticated-read.sanitized.json` confirms those reads left catalog data and migrations unchanged. Bearer tokens were not read or logged in the proof.

The coordinating agent subsequently verified fresh navigation to exact `https://gis-shw-dev.dichvunuoc.vn/gis`, which rendered the valid empty-tenant state. `authenticated-browser-progress.json` records the final real-session result. The two originals were uploaded once into tenant `tnt_shw`, creating one job and no job in another tenant:

| Item | Verified result |
| --- | --- |
| Job | `8aa0a8c0-a4d8-4d8a-a217-790534afa232` |
| First original | `1.MB-PP-Vinh Thinh - Dot 3.dwg`; 221,952 bytes |
| First SHA-256 | `fd913a6346e8896c59a08e8aebf1ed5dad7ba8f1f20db199fd0cf5ca7158e452` |
| Second original | `2. MB Ong Dich vu- Vinh Thinh 123.dwg`; 711,787 bytes |
| Second SHA-256 | `8b0321c105f6b2ddcff8d2828148ba39357780acb2a9441db9e3c9933385646e` |
| Persisted UI review | Version 4 at `2026-09-14T11:11:34Z`; 28 layer rules and 16 block rules |
| Clean preview | 813/813 features loaded and visually checked |
| Review summary | 786 retained pipes; 9,007 excluded features; 815 blocking issues; six warnings |
| Publication | No GIS draft or publication |

`catalog-access-dev-release/shw-upload-storage-receipt.sanitized.json` verifies stored originals against the supplied hashes; its initial version-2 analysis is an upload checkpoint, not the final mapped review. The final `catalog-access-dev-release/final-review-receipt.sanitized.json` independently verifies persisted version4, 786 pipe candidates, 27 mapped Valve candidates, zero valid device drafts, 60 unresolved features and no GIS submission. Its stored review rules match the previously reviewed configuration exactly, apart from the expected-version guard. Neither checkpoint substitutes one set of counts for the other.

A legitimate empty published network is the correct landing result while this job is still under review. Missing source CRS/material evidence, 27 device-host assignments and 60 intentionally unresolved features remain blocking review items. The user has not confirmed CRS or lifecycle evidence. Completion of this repair and initial review does not authorize approval or publication of unresolved assets.
