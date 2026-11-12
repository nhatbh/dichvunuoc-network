# 0032 — The CAD import proposes the drawing's coordinates and guides the user step by step

Date: 2026-11-12. Status: Accepted (user, 2026-11-12, "Approve, implement all").

## Context

The import screen showed every tool at once, and the reviewer had to pick the drawing's source
CRS by hand (locality + projection), although the drawing usually says where it is: the
Vĩnh Thịnh drawing's geometry is VN-2000 projected metres and its title block names "TỈNH VĨNH
PHÚC" (TM-3, KTT 105°00', EPSG:5897). The user asked for a friendlier, faster flow that fills the
coordinates in automatically and editably, keeping the current workspace available.

## Decision

1. **The import service proposes the source CRS from the drawing itself** (`crs_detect.py`,
   `inventory.files[].crsSuggestion`), in this order: an embedded GEODATA definition; a system
   declared in the text (EPSG code, "VN-2000", "kinh tuyến trục dd°mm'", "múi chiếu 3°/6°", "UTM
   48/49"); a province named in the text (TT 26/2024 Annex 01 meridian), checked against the
   province capital (≤ 150 km, nearer than 60 km preferred - so a consultant's address elsewhere
   does not win); the extents' magnitude for metres/millimetres and swapped axes. Text in model
   space, layouts and block definitions is read, including TCVN3 legacy-font text. The tenant and
   the file name are never used (as in decision 0030). Disagreements give `ambiguous`; local
   coordinates give `unknown`. The proposal carries the evidence quotes and the drawing's extent
   in lon/lat for the map.
2. **The proposal is never saved by itself.** The reviewer confirms it on the map; the recorded
   `crsEvidence` lists the importer's evidence and the reviewer's name and date. A changed choice
   is previewed (saved without evidence) before it can be confirmed.
3. **Guided flow by default** (frontend `guided-import.tsx`): Tải bản vẽ → Vị trí → Kiểm tra mạng
   → Gửi duyệt, derived from the saved job. The network step classifies pending layers, fills the
   DN from size-named layers ("110") and a material for pipe layers, lists blocking errors and
   warnings, and links to the advanced tool for the rest (blocks, geometry fixes, control
   points, approval).
4. **The advanced workspace is unchanged** and one click away ("Chế độ chuyên sâu"), on the same
   job and `ReviewConfig`; the choice is remembered per browser.

## Consequences

- VNI-encoded text is not decoded yet; such drawings fall back to the declared system or extents.
- A drawing made after the 2025 province mergers may name the new province; the capital check
  and the reviewer's map confirmation catch a wrong meridian, the importer cannot.
- Province capitals are approximate and only a sanity check.
