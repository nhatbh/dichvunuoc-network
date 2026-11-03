# VN-2000 source presets

Status: accepted. Story: SHW-VN2000-20260915.

## Decision

Provide an explicit source-CRS workflow beside CAD/GIS point matching. Use the
63 historical cadastral localities in TT26/2024 Annex 01, with catalog version
`tt26-2024-annex01-v1` and locality IDs `tt26-2024-{slug}`. The user chooses TM-3,
UTM48N or UTM49N separately. Preserve the chosen EPSG/PROJ string as `sourceCrs`
and selection provenance as `sourceCrsPresetId`; the preset never substitutes
for the actual CRS. Current merged names are not implemented as aliases.

Direct-source interpretation adds `sourceAxisOrder=xy|yx` and
`sourceUnits=m|mm`, defaulting to `xy`/`m`. The worker normalizes copied
coordinates before PROJ conversion with `always_xy=True` and
`allow_ballpark=False`. Millimetres require a projected CRS with two metre axes.
Point matching retains original CAD coordinates and rejects non-default direct
axis/unit settings. Switching modes explicitly clears conflicting draft
configuration and evidence, with discard available before save.

Allow geographic preview without evidence, but create zero asset drafts until
`crsEvidence` is present. The client requires a current geographic preview and
explicit confirmation to save source evidence; source changes invalidate it.
Review quality and approval gates remain. A 409 recovery publishes job revision
and config together so the editor cannot resend stale source settings.

## Sources and limits

- [TT26/2024, Article 3 and Annex 01](https://congbao.chinhphu.vn/van-ban/thong-tu-so-26-2024-tt-btnmt-43701.htm): historical cadastral table, TM-3 with `k0=0.9999`.
- [Official PROJ/EPSG CRS identities](https://github.com/OSGeo/PROJ/blob/master/data/sql/projected_crs.sql) and [projection parameters](https://github.com/OSGeo/PROJ/blob/master/data/sql/conversion.sql): VN-2000 UTM48N is EPSG:3405, central meridian 105°; UTM49N is EPSG:3406, 111°; both use `k0=0.9996`.
- [TT24/2025](https://congbao.chinhphu.vn/van-ban/thong-tu-so-24-2025-tt-bnnmt-45474/57513.htm) has a new administrative-map table, which does not identify the CRS of historical CAD. [Đồng Tháp's post-merger regulation](https://vbpl.vn/TW/Pages/vbpq-print.aspx?ItemID=185636) retains distinct meridians for old Đồng Tháp and Tiền Giang localities.
- [PROJ/EPSG datum transformations](https://github.com/OSGeo/PROJ/blob/master/data/sql/helmert_transformation.sql): national onshore operation 6960 has published 1 m accuracy; operation 5194 has a limited Mekong area. A converted overlay is not centimetre survey certification. [Helmert rotation conventions](https://proj.org/en/stable/operations/transformations/helmert.html) must not be interchanged by copying parameter signs.

These sources were checked on 2026-09-15. The catalog does not identify either
supplied SHW drawing's CRS automatically.
