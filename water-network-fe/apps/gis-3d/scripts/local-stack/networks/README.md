# Local stack networks

`seed.mjs` registers one of these in gis-be when the local stack starts with an empty database.

## vinh-thinh-dot3 (default)

The network of the drawing `1.MB-PP-Vinh Thinh - Dot 3.dwg`, exactly as the CAD import service
reads it with the reviewed mapping `vinh-thinh-dot3.review.json`:

- CRS VN-2000, central meridian 105°00′ (Vĩnh Phúc).
- Pipe layers `90` `110` `160` `225` `315` = HDPE of that outside diameter.
- Blocks `Vanmoinoi` = GateValve, `cut1` = Bend, `con` = Reducer; labels, stakes and the base-map
  Xref are reference only.

What the importer fills in from the drawing itself (decision 0030): the fitting at every node the
drawing leaves unnamed (Tee, ReducingTee, Cross, Reducer, Bend from the pipes meeting there),
dn/dn2/material/angle from those pipes, and each valve's pipe (the one drawn under its symbol).
Dead ends stay junctions; nothing the drawing does not show is added.

Result: 43 pipes (14.8 km), 44 nodes (13 ReducingTee, 1 Tee, 1 Cross, 6 Bend, 4 Reducer,
19 Junction), 27 GateValves.

Regenerate (from `water-network-import`, with a DWG converter on `DWG_CONVERTER`):

```
python -m wn_import.cli "<path>/1.MB-PP-Vinh Thinh - Dot 3.dwg" \
  --config ../water-network-fe/apps/gis-3d/scripts/local-stack/networks/vinh-thinh-dot3.review.json \
  --output out
cp out/draft-assets.json ../water-network-fe/apps/gis-3d/scripts/local-stack/networks/vinh-thinh-dot3.drafts.json
```

The review's `fileId`s are the drawing's SHA-256 prefix, so the mapping applies to this exact file.
