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
| `2. MB Ong Dich vu- Vinh Thinh 123.dwg` (layers `50`, `63`; blocks `Daudai`, `bit`, `con`, `pt`) | Service pipes D50/D63 (45.5 km), processed like the distribution drawing and connected to it through the 180 tapping saddles kt1… (see *Service network* below) |
| `!!! Xuât ho so…/00. Dinh vi nha may/1. QH Tổng Mặt bằng Dinh vi Nha May.dwg` | Plant site plan: boundary, every structure outline + legend name, flocculation/lamella/filter cells, pond, roads, trees, gate. Geo-referenced exactly through its Xref `Xr.Binh do` (VN-2000), cross-checked against its coordinate table |
| `Ban vẽ Công nghe…/1. CTT+ TB1/MBTT/Xref Nen toa do.dwg` (block `CTT`, layer `duongmepnuoc`) | Position of the river intake + raw-water pump station TB1 and the water edge |
| `2. DCCN.dwg`, `00- Tram bom 1`, `03- Tram bom chuyen tiep`, `04- Cụm bể trộn…`, `05- Cum be loc`, `07- Tram Bom 2 moi`, `08-09- Nha CLO + Hoa chat` | Process train and equipment duties: TB1 Q=1450 m³/h H=45 m · transfer Q=750 m³/h H=20 m · clean water Q=850 m³/h H=50 m · backwash Q=1050 m³/h H=15 m · blower 75 m³/ph · 3-stage flocculators 1 kW (14/12/8 v/ph) · lamella tubes 2" · chlorine drums 900 kg · PAC 17 % · D1000 steel outlet |

The drawings put the plant ~2 km north of the network. Its D1000 main enters at the network's northern DN315 open
end. The demo does **not** show the following, because no drawing has them. They are drawn and labelled *giả định*
(assumed): the D1000 and D600 raw-water main routes, building heights, where each piece of equipment sits inside
its building, and the instrument tags.

CRS: VN-2000, central meridian 105°00′ (Vĩnh Phúc), k = 0.9999, 7-parameter shift to WGS84.

## Service network

`service_network.py` processes the service drawing the way the CAD import processed the distribution drawing.
The processed distribution pipes (`vinh-thinh-dot3.drafts.json`) are the reference. The service drawing's own copy
of them (layers `90` … `315`) is not used.

- **Sizes.** Layers `50` and `63` are HDPE by outside diameter, like the distribution layers `90` … `315`. The
  drawing's labels ("D50, L=61m") agree. The app writes HDPE sizes as "D110 (DN100)". Catalog parts are built at the
  nominal DN.
- **Nodes and fittings.**
  - Pipe ends within 0.5 m are one node. An end on another pipe's run splits that pipe (a tee).
  - The fitting at each node comes from the pipes that meet there: Tee or ReducingTee, Reducer, Bend (≥ 10°), Cross.
  - A dead end carrying the drawing's `bit` block is a Cap.
  - The result matches the drawing's labels: 395 caps (397 "B" labels), 128 bends (125 "C"), 24 reducers (20 "C…/…"),
    218 tees (189 "T").
- **Saddles.**
  - Each `Daudai` block ("kt1" …) is moved onto the nearest point of the processed distribution pipe: by 0 m in most
    cases, at most 7.9 m.
  - The service pipe that starts there begins at the saddle.
  - kt37 and kt38 land on one spot and share one saddle.
- **Links the drawing does not show** (marked `assumed`).
  - A few service trees end on a distribution pipe without a saddle block, or are not connected at all.
  - Each is joined by its shortest link: 7 saddles, 7 tees, 35 m of pipe.
  - After this, every one of the 824 service pipes reaches a saddle.

To regenerate only the service network (the plant and intake sections of the current JSON are kept):

```
python scripts/twin/extract_cad_twin.py --service "<dxf>/2. MB Ong Dich vu- Vinh Thinh 123.dxf"
```

On the map, every pipe is thickened by the same factor (×5 close up, ×10 at mid distance), so sizes stay in
proportion. The parts on a pipe are scaled by the same factor, so tees, saddles and valves fit the pipes they join.

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

| Object | Levels (map zoom) |
|---|---|
| Pipe network, 300 m chunks; long pipes split into ≤120 m pieces | **L2** from 17.5: smooth tubes, fittings, valves with handwheels, tapping saddles · **L1** from 15.5: 6-sided tubes, flat catalog symbols · **L0**: screen-space lines in four width classes, with the overlay below |
| Far overlay (`map/far-overlay.ts`), below 15.5 | Catalog symbols of the inlet station, sensors, valves, air valves, washouts and acoustic loggers, coloured by live state and making room for each other by priority · the supply zone's outline · the zone's inlet reading · size and live flow on the mains and on the longest pipe of each size (up to 17.5) |
| Plant | **L3** from 17.2: cells, lamella plates, troughs, process pipe racks, windows · **L2** from 15.9: basins with water, roofs, roads, fence, trees · **L1** from 14: one merged massing mesh · below: map label only |
| TB1 intake | L3 from 19 · L2 from 17.1 · L1 from 14.8 |
| Factory view labels | Equipment tags within 75 m of the camera, unit names from further away |

The whole view uses one level, chosen from the map's zoom with a 0.15 zoom hysteresis band. A level chosen by camera
distance per chunk would draw the near and far parts of a tilted view differently. Chunks build a level lazily, only
when they are in view, at most 8 per frame; static parts are merged into vertex-coloured meshes.

Pipe widths are drawn for reading the map, like roads, not to scale (`pipeWidth` in `map/network-lod.ts`):
- **Size:** a pipe's width grows with the square root of its outside diameter. D50 : D110 : D315 : D1000 ≈ 1 : 1.5 :
  2.5 : 4.5, so service pipes stay visible and the mains still lead.
- **Far and mid zoom (L0, L1):** widths are in screen pixels and grow with zoom. A D50 is 1.5 px at zoom 13, 2.5 px at
  15, 3 px at 16 and 3.6 px at 17.5. They are updated every frame: L0 lines through their line width, L1 tubes through
  a shader scale about their axis.
- **Up close (L2):** widths are fixed in metres (a D50 is 1.4 m), and match L1 at the switch. The fittings on a pipe are
  built at its nominal DN and scaled to the pipe's drawn width.

Pipes are continuous tubes: mitred at bends, closed at their ends. Each fitting is turned to the pipes it joins: a
tee's branch lies along its branch pipe, and a bend takes the real angle.

The left panel of `/twin` shows FPS, draw calls, triangles and chunks per level. *Tô màu theo LoD* colours the
chunks by level and draws their boxes.

## Component catalog, HMI and SCADA

Every component in the twin is typed by its code in the component catalog (`@wn/component-models`). The catalog
supplies its 3D model, flat symbol, functions and properties.

- **New catalog codes** for what a clean-water plant monitors and controls (`packages/component-models/src/plant.ts`):
  TurbidityMeter, ChlorineAnalyser, PHAnalyser, DPTransmitter, GasDetector, CCTVCamera, MotorisedValve,
  VerticalTurbinePump, SubmersiblePump, Blower, Mixer, Flocculator, LamellaSettler, RapidSandFilter, DosingPump,
  ChemicalTank, Chlorinator, ChlorineContainer, Scrubber, VFDPanel, MCC, PLCPanel, HMIPanel, SCADAWorkstation,
  Transformer. There are two new functions (`treats`, `automates`) and two new categories (Treatment, Electrical &
  automation). The code list is regenerated into contracts, the CAD importer and the backend with `npm run codes`.
- **Network** (`src/pages/twin/data/network-devices.ts`, ~1,150 items): the CAD gate valves and fittings, the service
  network's tapping saddles and fittings (tees, bends, reducers, caps), plus assumed devices: the zone inlet station (MotorisedValve,
  BulkMeter, ChlorineAnalyser, PressureSensor, RTU), critical-point loggers, hydrants, air valves, washouts, acoustic
  loggers and sampling points. At L1 they are drawn as flat catalog symbols; at L2 as instanced 3D catalog models
  whose status parts take the live state.
- **Plant**: every equipment item has a `code` and is drawn as its catalog model. Status LEDs follow the
  simulation, and rotors (impellers, paddles, fans) spin. New automation items include VFDs per pump, MCCs, PLC and
  HMI panels per area, filter DP transmitters, pH analysers and CCTV.
- **HMI / SCADA** (`src/pages/twin/ui/hmi/`): there is a SCADA button on the map and in the plant view. It opens the
  central SCADA, with these screens: overview P&ID, TB1, clarification, filters, clean-water pumps, chemicals &
  chlorine, power, network telemetry, alarms and trends. An HMI or PLC panel's faceplate opens the same screens as
  a local operator panel. Clicking a symbol opens its faceplate, and commands go to the shared simulation.

### Professional HMI library: Siemens iX + ECharts

The SCADA / HMI screens use **Siemens Industrial Experience (iX)**: `@siemens/ix` 5.3, `@siemens/ix-icons` 3.7,
both MIT. These are the web components behind Siemens' industrial HMI style. Charts use **Apache ECharts** 6.1
with the iX theme (`@siemens/ix-echarts`).
- iX components used: tabs, KPIs, communication chips, pills, key/value lists, AUTO/MAN toggle, command buttons
  with a confirmation step, setpoint slider, event list for alarms and the operator log. ECharts provides the
  gauges (outlet pressure, reservoir, turbidity, pump frequency) and the 24 h trends.
- The P&ID mimics stay SVG, coloured with iX theme tokens.
- Only iX's design tokens are loaded, scoped to the SCADA container `.hx` (`data-ix-theme="classic"
  data-ix-color-schema="dark"`). iX's global element styles are not loaded, so the rest of the app is unchanged.
  The tokens file `src/pages/twin/ui/hmi/ix-scoped.css` is generated from the installed package:
  `node scripts/twin/build-ix-scoped-css.mjs`. Rerun it after upgrading `@siemens/ix`.
