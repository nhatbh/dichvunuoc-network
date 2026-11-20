# Bản đồ số 3D (`/twin`): CAD sources and regeneration

The integrated 3D map at **`/twin`** (also reachable from the GIS top bar: *Bản đồ số 3D*) is a frontend-only demo.
It shows the Vĩnh Thịnh network, its service pipes and the Sông Hồng clean-water plant on a MapLibre map, with
distance-based LoD. Clicking the plant flies into its own 3D view, where every component can be inspected and
operated. Both views share one in-browser mock simulation (`src/pages/twin/sim/plant-sim.ts`). What the operator
does in the plant (stops pumps, closes MV-701, backwashes a filter) shows up as pressures and flows on the map.

## What comes from which drawing

All 41 DWG files in the project folders were converted and inspected. These are the ones used:

| Drawing | Used for |
|---|---|
| `1.MB-PP-Vinh Thinh - Dot 3.dwg` (via the CAD import, `scripts/local-stack/networks/vinh-thinh-dot3.drafts.json`) | 43 distribution pipes DN90–315 HDPE, 27 gate valves, 44 fittings |
| `2. MB Ong Dich vu- Vinh Thinh 123.dwg` (layers `50`, `63`, `ten dai khoi thuy`) | 746 service lines D50/D63 and 180 meter clusters (finest LoD) |
| `!!! Xuât ho so…/00. Dinh vi nha may/1. QH Tổng Mặt bằng Dinh vi Nha May.dwg` | Plant site plan: boundary, every structure outline + legend name, flocculation/lamella/filter cells, pond, roads, trees, gate. Geo-referenced exactly through its Xref `Xr.Binh do` (VN-2000), cross-checked against its coordinate table |
| `Ban vẽ Công nghe…/1. CTT+ TB1/MBTT/Xref Nen toa do.dwg` (block `CTT`, layer `duongmepnuoc`) | Position of the river intake + raw-water pump station TB1 and the water edge |
| `2. DCCN.dwg`, `00- Tram bom 1`, `03- Tram bom chuyen tiep`, `04- Cụm bể trộn…`, `05- Cum be loc`, `07- Tram Bom 2 moi`, `08-09- Nha CLO + Hoa chat` | Process train and equipment duties: TB1 Q=1450 m³/h H=45 m · transfer Q=750 m³/h H=20 m · clean water Q=850 m³/h H=50 m · backwash Q=1050 m³/h H=15 m · blower 75 m³/ph · 3-stage flocculators 1 kW (14/12/8 v/ph) · lamella tubes 2" · chlorine drums 900 kg · PAC 17 % · D1000 steel outlet |

The drawings put the plant ~2 km north of the network. Its D1000 main enters at the network's northern DN315 open
end. The demo does **not** show the following, because no drawing has them. They are drawn and labelled *giả định*
(assumed): the D1000 and D600 raw-water main routes, building heights, where each piece of equipment sits inside
its building, and the instrument tags.

CRS: VN-2000, central meridian 105°00′ (Vĩnh Phúc), k = 0.9999, 7-parameter shift to WGS84.

## Regenerate `src/pages/twin/data/cad-twin.json`

1. Convert the DWGs with LibreDWG `dwg2dxf`
   ([releases](https://github.com/LibreDWG/libredwg/releases), win64 zip). Copy files with Vietnamese characters
   in their path to an ASCII path first, because `dwg2dxf` on Windows cannot open them.
2. `python -m pip install ezdxf pyproj`
3. Run:

```
python scripts/twin/extract_cad_twin.py \
  --site   "<dxf>/1. QH Tong Mat bang Dinh vi Nha May.dxf" \
  --intake "<dxf>/Xref Nen toa do.dxf" \
  --service "<dxf>/2. MB Ong Dich vu- Vinh Thinh 123.dxf"
```

Site-plan texts use the legacy TCVN3 font encoding. To read them, decode with `tcvn3.decode()` in this folder.

## Level of detail

| Object | Levels (camera distance) |
|---|---|
| Pipe network, 300 m chunks; long pipes split into ≤120 m pieces | **L2** < 240 m: smooth tubes, joints, valves with handwheels, fittings, service tubes, meter boxes · **L1** < 1.2 km: 6-sided tubes, valve markers, service lines as thin lines · **L0**: fat screen-space lines, no service lines |
| Plant | **L3** < 520 m: cells, lamella plates, troughs, process pipe racks, windows · **L2** < 1.6 km: basins with water, roofs, roads, fence, trees · **L1** < 6 km: one merged massing mesh · beyond: map label only |
| TB1 intake | L3 < 180 m · L2 < 700 m · L1 < 3.5 km |
| Factory view labels | Equipment tags within 75 m of the camera, unit names from further away |

Each chunk picks its level every frame from its own distance, with 15 % hysteresis, so a tilted view mixes
levels in one frame. Levels are built lazily and cached, and static parts are merged into vertex-coloured meshes.
The left panel of `/twin` shows FPS, draw calls, triangles and chunks per level. *Tô màu theo LoD* colours the
chunks by level and draws their boxes.
