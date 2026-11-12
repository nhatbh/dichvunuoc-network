# IMP — Guided CAD import with automatic coordinates

Status: Done (approved 2026-11-12). Date: 2026-11-12.

## Problem

The CAD import screen (`apps/gis-3d/src/pages/gis/screens/import.tsx` + `import-workspace/review.tsx`,
~1,450 lines) shows every tool at once: file manager, layer table, tolerances, issue list, source
CRS panel, control-point alignment, submission. A first-time user does not know what to do next,
and must pick the drawing's coordinate system by hand (locality + projection), although the
drawing usually says where it is.

Example, `1.MB-PP-Vinh Thinh - Dot 3`: geometry at E 552 486 / N 2 344 742 (VN-2000 projected, metres);
title-block text "…KHU VỰC PHÍA NAM TỈNH VĨNH PHÚC", "huyện Vĩnh Tường", "xã Vĩnh Thịnh" (part of it in the
legacy TCVN3 font encoding). Vĩnh Phúc → TM-3, central meridian 105°00' (TT 26/2024 Annex 01) →
EPSG:5897. The importer can propose this without the user doing anything.

## Goals

1. **Coordinates filled in automatically, editable.** The importer proposes the source CRS from the
   drawing itself, shows it on the map, and the user confirms or changes it.
2. **A guided flow** for the common case: upload → check location → check network → submit. One
   decision per step, a clear "next" action, plain-language status.
3. **The current workspace stays** as "Chế độ chuyên sâu" (advanced), reachable from every step and
   for every job, with nothing removed.

Non-goals: new network-cleaning rules; changing the review/approval contract with design-be.

## A. Automatic coordinate detection (import service, decision 0030 extended)

Same rule as decision 0030: only what the drawing determines. The tenant or file name alone never
selects a CRS; they are not used.

`cad.py` adds `file.crsSuggestion` to each file's inventory:

| Evidence (strongest first) | Source in the file | Result |
|---|---|---|
| Embedded geolocation | `GEODATA` coordinate system definition | that CRS |
| Declared system | text such as "VN-2000", "kinh tuyến trục 105°30'", "múi chiếu 3°", "UTM 48" | projection + meridian |
| Locality | province / district names in text (Unicode and TCVN3 decoded; VNI not yet) matched to the TT 26/2024 catalogue | the province's TM-3 meridian |
| Coordinate range | geometry extents | projected VN-2000 metres vs. millimetres vs. local/unknown; axis order (E/N swapped) |

Output: `{ status: "detected" | "ambiguous" | "unknown", crs, presetId, units, axisOrder, confidence,
evidence: [{kind, text, entityId}], candidates: [...], checks: [...] }`.

Checks that must pass for "detected": the transformed extents fall inside Vietnam; the extents fall
inside the matched province's approximate extent (bounding box table added beside the catalogue);
declared and locality evidence agree. A disagreement → "ambiguous" with the candidates listed.

No new endpoint: the suggestion travels in `job.inventory.files[]`, which the frontend already reads.

## B. Guided flow (frontend, `import-workspace/guided/`)

The import page opens in the guided flow; a toggle "Chế độ chuyên sâu" switches to today's workspace
for the same job (state is the same `ReviewConfig`, so switching is lossless both ways).

1. **Tải bản vẽ** — drop DWG/DXF files, name prefilled from the file name. Upload starts analysis.
   Progress shown in plain words.
2. **Vị trí** — the drawing drawn over the basemap at the detected position, with a card:
   "Phát hiện: VN-2000, Vĩnh Phúc (KTT 105°00'), mét — từ chữ 'TỈNH VĨNH PHÚC' trong khung tên".
   Buttons: *Đúng vị trí* (confirm) / *Chọn lại* (locality + projection dropdowns, prefilled, live
   preview) / *Căn bằng điểm* (opens the existing control-point alignment). Unknown → the dropdowns
   open directly with the best candidates first.
3. **Kiểm tra mạng** — counts (pipes, length, nodes, devices) and only the blocking problems first,
   each with a "Sửa" button that opens it in the advanced workspace's object panel. Layer mapping is
   automatic; a short "Lớp chưa nhận diện" list lets the user assign or skip.
4. **Gửi duyệt** — summary + submit. Then the status (waiting approval / published) on the same page.

A step bar shows done / current / blocked. Every step has "Chế độ chuyên sâu" in its header.

## C. Tasks

- [x] A1 Text extraction for evidence (TEXT, MTEXT, ATTRIB in model space, layouts and blocks), TCVN3 decoder (VNI deferred), unit tests with the Vĩnh Thịnh strings.
- [x] A2 Declared-CRS parser (VN-2000, KTT dd°mm', múi 3°/6°, UTM zone), tests.
- [x] A3 Locality matcher against the catalogue + province capital table (sources cited), tests.
- [x] A4 Range/units/axis classifier and the agreement checks; `crsSuggestion` in the inventory; Vĩnh Thịnh fixture → EPSG:5897, "detected".
- [x] A5 When the job's config has no source CRS yet, the frontend proposes (never auto-saves) the suggestion; saving it records `sourceCrsPresetId` and `crsEvidence` from the evidence list.
- [x] B1 Guided shell: step bar, mode toggle (remembered per user), routing for an existing job.
- [x] B2 Step 1 upload (reuses workspace upload).
- [x] B3 Step 2 location: overlay preview, suggestion card, edit dropdowns, link to control-point alignment.
- [x] B4 Step 3 network check: summary, blocking issues with "Sửa" deep links, unassigned layers.
- [x] B5 Step 4 submit + status.
- [x] B6 Tests: component tests per step; an end-to-end run on the cloud stack with the Vĩnh Thịnh DWG (upload → detected → confirm → submit) with screenshots.
- [x] Decision record 0032 (auto CRS evidence order; guided flow as default, advanced kept).

## Risks

- Province extents are approximate; they are only a sanity check, never the selector.
- Drawings with no locality text and no declaration stay "unknown": the user picks, as today, but
  with the projected-vs-local classification and the drawing on the map to judge.

## Outcome

- Import service: `crs_detect.py` + tests (`tests/test_crs_detect.py`, 141 passing). The real
  "1.MB-PP-Vinh Thinh - Dot 3.dwg" → detected, EPSG:5897, `tt26-2024-vinh-phuc:TM3`, centre
  105.494, 21.178 (Vĩnh Thịnh).
- Frontend: `guided-import.tsx`, `location-map.tsx`, `crs-suggestion.ts`, `upload.ts`; the
  advanced screen opens at a given panel. 10 guided tests; the whole app suite passes.
- Cloud stack run with the Vĩnh Thịnh drawing: upload → detected and drawn on the map → confirm
  → layers classified, DN from layer names + HDPE → blocking errors 798 → 23 (block symbols and
  geometry, handed to the advanced workspace).
