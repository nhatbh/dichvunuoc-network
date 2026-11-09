# EDT — The SYSTEM 3D editor on the live network

**Date:** 2026-11-09
**Status:** Proposed — awaiting review
**Services:** water-network-fe (gis-3d); design-be/BFF `/api/gis/editor/*` (read and write as today, no backend change expected)

## Outcome

"Biên tập" opens the SYSTEM 3D editor (branch gate, OpenLayers workspace, change set, rules,
command palette, save draft / submit) on the real network in live mode. The older network
editor and the hidden `/gis/editor` page are removed. Branches come from the server, never from
the browser.

Done when, on the local stack with the Vĩnh Thịnh Đợt 3 network:
1. Biên tập → gate lists the official network and every open design revision of the tenant.
2. Clone the official network → move a valve, add a pipe and a valve, delete a pipe →
   Lưu nháp → Gửi duyệt → approve in Versions → publish → the map and topology show the change.
3. Reopening a saved branch restores its change set; another browser sees the same branches.
4. A finished CAD import opens in the editor as its own branch.
5. Suites green (gis-3d, contracts); live test against the BFF passes.

## Findings (tried on the local stack, 2026-11-09)

| Finding | Where |
|---|---|
| In live mode the `editor` route is not in `CANONICAL_SUPPORTED_ROUTES`; `#editor` is caught by `gis-runtime-page` and opens `network-editor/workspace` (the older editor) | `gis-app.tsx`, `gis-runtime-page.tsx` |
| With both switched, the SYSTEM 3D editor opens and draws without errors on live data | — |
| Its gate has only "Tạo bản trắng": live mode keeps no branches (the browser store is not tenant-scoped), so the official network cannot be cloned and saved revisions cannot be reopened | `gis-app.tsx` (`branches = []`), `lib/branch-store.ts` |
| "Nhập từ tệp" in the editor loads generated demo features | `editor/model.ts` `genImportFeatures` |
| The EAM picker lists demo records | `editor/panels.tsx` `EamModal` |
| `/gis/editor` page (DigitizeToolbar) is behind `newEditor = false` everywhere | `routes/gis_.editor.tsx`, `pages/gis/editor/index.tsx` |
| `editor/revision-sync.ts` already saves through `network-editor/api.ts` + `model.ts` | — |

## Slices (each: tests first, green suites, conventional commit)

### EDT-1 Route Biên tập to the SYSTEM 3D editor
- [ ] `editor` joins the live-mode routes; `gis-runtime-page` no longer intercepts `#editor`.
- [ ] Move `network-editor/api.ts` and `model.ts` (used by revision-sync) to `editor/revision-api.ts`,
      `editor/revision-model.ts`; delete `network-editor/workspace.tsx`, its CSS and tests.
- [ ] Delete the `/gis/editor` route, `pages/gis/editor/index.tsx`, its page test and the
      `newEditor` flag (configs, app-shell link).
- [ ] Tests: live-mode shell opens the editor route on Biên tập; no reference to the removed modules.

### EDT-2 Branches from the server
- [ ] Live mode builds the gate from `GET /api/gis/editor/revisions` + bootstrap: one locked
      "Mạng lưới chính thức" branch (published version, pipe km, asset count) and one branch per
      revision (Draft/Validated → Nháp, Submitted → Chờ duyệt, Rejected → Nháp with the reason;
      Approved/Published shown as history, read-only).
- [ ] Clone official = new revision on first save (current behaviour); a blank branch likewise.
- [ ] Branch names/notes come from the revision name; thumbnails are rendered, not stored.
- [ ] Nothing in live mode reads or writes `gis.branches.v1` (demo mode keeps it).
- [ ] Tests: gate from a mocked revision list; opening a revision restores its drafts; MSW mock
      serves the same list so demo and offline behave alike.

### EDT-3 Editing the real network
- [ ] Base assets of every component in the network are selectable, movable and deletable
      (nodes by component code: Tee/ReducingTee/Cross/Bend/Reducer/Junction; GateValve on pipes).
- [ ] Moving a node drags its pipe ends; moving/deleting a pipe with valves keeps or removes the
      valves as the server rules require (no orphan devices).
- [ ] Property panel shows and edits catalog properties (dn, dn2, material, angle, state) with
      catalog validation; component picker uses the catalog.
- [ ] Tests: revision-ops round trip for each case against the catalog; server validation
      issues land on the right feature.

### EDT-4 Import and EAM in live mode
- [ ] "Nhập từ tệp" opens the CAD import (Import screen); when the import is submitted to
      design-be, its revision opens in the editor as a branch (`#editor:<revisionId>`).
- [ ] The EAM picker is hidden in live mode until an asset/EAM source exists.
- [ ] Tests: import hand-off; demo mode unchanged.

### EDT-5 Verification
- [ ] Live test (`WN_LIVE_BFF`): clone → edit → save → submit → approve → publish on the Đợt 3
      network; topology isolation sees the new valve.
- [ ] Screenshots of gate, workspace and publish result; project doc and integration plan updated.

## Out of scope
Server-side branch metadata beyond the revision (lanes, cards on the scenario board), DMA
editing (no zone-be yet), multi-user locking of the same revision.
