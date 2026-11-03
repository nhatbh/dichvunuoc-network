# Design

The existing alignment workbench contains two explicit modes: declared source
CRS and CAD/GIS point pairs. Source mode chooses a historical locality, then
TM-3 or VN-2000 UTM48N/49N. The panel shows EPSG, central meridian, scale factor
and CRS units. It separately asks how coordinate values are stored in CAD:
east/north or north/east, metres or millimetres. Custom EPSG/PROJ input remains.

`vn2000Localities` contains all 63 TT26/2024 Annex 01 rows, with IDs
`tt26-2024-{slug}` and version `tt26-2024-annex01-v1`. Labels and province names
refer to the source table's historical localities. Current merged province
names are not search aids or aliases in this implementation. Selecting a
locality alone leaves the projection and CRS unselected.

`sourceCrsPresetId` stores `{localityId}:{TM3|UTM48N|UTM49N}` as provenance;
`sourceCrs`, `sourceAxisOrder` and `sourceUnits` determine conversion. The worker
swaps/scales copied coordinates only for direct-source conversion and preserves
raw CAD. Point matching does not inherit these adjustments. Conflicting point
pairs/per-file CRS require a visible, explicit reset; switching tabs alone does
not erase them. Before saving, discard restores committed settings.

Preview first saves source interpretation with empty evidence. The worker may
return WGS84 geometry but produces zero asset drafts without evidence. The UI
displays the geographic result beside raw CAD, hides stale results on edits or
version mismatch, and only offers evidence confirmation for the current result.
Saving evidence reruns review; existing material, topology, host, lifecycle and
approval gates still apply. Reopening a saved source configuration loads its
preview without another review write. Job/config updates are batched on conflict
recovery so the next preview cannot overwrite server settings with an old draft.

The catalog is sourced from [TT26/2024](https://congbao.chinhphu.vn/van-ban/thong-tu-so-26-2024-tt-btnmt-43701.htm)
and the [official PROJ/EPSG database](https://github.com/OSGeo/PROJ/blob/master/data/sql/projected_crs.sql).
Projection and post-merger scope details are recorded in
[decision 0013](../../decisions/0013-vn2000-source-presets.md).
