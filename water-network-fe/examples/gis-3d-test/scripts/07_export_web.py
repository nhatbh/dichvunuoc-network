"""Xuất dữ liệu cho ứng dụng web (web/public/data) + GeoJSON bàn giao (output/geojson)."""
import json, pickle, shutil
import numpy as np
import config as C
import model as M

RUN = C.ROOT / "data/model/_run"
A = pickle.load(open(RUN / "analysis.pkl", "rb"))
WEB = C.WEB_DATA; WEB.mkdir(parents=True, exist_ok=True); (WEB / "scenarios").mkdir(exist_ok=True)
nodes, pipes = M.load_geo()
errs = json.load(open(C.ROOT / "data/network/errors.geojson"))["features"]
HH = A["HH"]
DMA = A["DMA"]
node_dma = {n: d for d, v in DMA.items() for n in v["nodes"]}
node_ids = [f["properties"]["id"] for f in nodes]
pipe_ids = [f["properties"]["id"] for f in pipes]
crit, burst_all, hl = A["crit"], A["burst_all"], A["hl"]
base = A["SCEN"]["base"]["series"]
vmax = {p: max(abs(v) for v in base["velocity"][p]) for p in pipe_ids}


def r(x, n=6): return [round(v, n) for v in x]


net = dict(
    nodes=[dict(id=f["properties"]["id"], ll=r(f["geometry"]["coordinates"]), elev=f["properties"]["elev"],
                hh=round(HH.get(f["properties"]["id"], 0), 1), tags=f["properties"]["tags"], kt=f["properties"]["kt"],
                dma=node_dma.get(f["properties"]["id"], ""), x=f["properties"]["x_vn2000"], y=f["properties"]["y_vn2000"])
           for f in nodes],
    pipes=[dict(id=f["properties"]["id"], n0=f["properties"]["n0"], n1=f["properties"]["n1"], od=f["properties"]["od_mm"],
                idmm=f["properties"]["id_mm"], mat=f["properties"]["material"], c=f["properties"]["hw_c"],
                year=f["properties"]["year"], cls=f["properties"]["cls"], len=f["properties"]["length_m"],
                label=f["properties"]["label"], handle=f["properties"]["dxf_handle"],
                path=[r(c) for c in f["geometry"]["coordinates"]],
                crit=round(crit.get(f["properties"]["id"], 0)), burst=round(burst_all.get(f["properties"]["id"], 0)),
                hl=round(float(hl[f["properties"]["id"]]), 2), dma=node_dma.get(f["properties"]["n1"], ""))
           for f in pipes],
)
(WEB / "network.json").write_text(json.dumps(net, ensure_ascii=False, separators=(",", ":"), default=float))

index = []
for k, s in A["SCEN"].items():
    se = s["series"]
    out = dict(key=k, title=s["title"], desc=s["desc"], kpi=s["kpi"],
               meta={mk: mv for mk, mv in s["meta"].items()}, affected=s["affected_nodes"],
               pressure=[se["pressure"][n] for n in node_ids],
               age=[se["age"][n] for n in node_ids] if "age" in se else None,
               flow=[se["flow"][p] for p in pipe_ids], velocity=[se["velocity"][p] for p in pipe_ids])
    (WEB / "scenarios" / f"{k}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=float))
    index.append(dict(key=k, title=s["title"], desc=s["desc"], kpi=s["kpi"]))

ana = dict(
    scenarios=index,
    issues=A["issues"],
    errors=[dict(id=e["properties"]["id"], kind=e["properties"]["kind"], severity=e["properties"]["severity"],
                 msg=e["properties"]["msg"], ll=e["geometry"]["coordinates"]) for e in errs],
    recs=A["recs"],
    dma=[dict(id=d, hh=round(v["hh"]), meter_pipe=v.get("meter_pipe"), note=v.get("note", "")) for d, v in DMA.items()],
    valves=[dict(pipe=p, node=n) for p, n in A["VALVES"]],
    loops=A["loops"], sensors=A["sensors"], leak_eval={k: v for k, v in A["leak_eval"].items() if k != "trials"},
    summary=A["summary"]["network"],
    assumptions_url="BAO_CAO.md#gia-dinh",
    thresholds=dict(p_low=C.P_LOW, p_high=C.P_HIGH, v_high=C.V_HIGH, v_low=C.V_LOW),
    ref_year=C.REF_YEAR,
)
(WEB / "analysis.json").write_text(json.dumps(ana, ensure_ascii=False, separators=(",", ":"), default=float))

# GeoJSON bàn giao (WGS84) kèm kết quả hiện trạng
G = C.OUT / "geojson"; G.mkdir(parents=True, exist_ok=True)
pk = 19
nf = []
for i, f in enumerate(nodes):
    pr = dict(f["properties"]); n = pr["id"]
    pr.update(hh=round(HH.get(n, 0), 1), dma=node_dma.get(n, ""), p_min=min(base["pressure"][n]), p_max=max(base["pressure"][n]),
              p_peak=base["pressure"][n][pk], age_h=base["age"][n][-1])
    nf.append(dict(type="Feature", geometry=f["geometry"], properties=pr))
pf = []
for f in pipes:
    pr = dict(f["properties"]); p = pr["id"]
    pr.update(q_peak_lps=base["flow"][p][pk], v_max=round(vmax[p], 3), headloss_m_km_peak=round(hl[p], 2),
              hh_single_feed=round(crit.get(p, 0)), hh_lost_if_burst=round(burst_all.get(p, 0)))
    pf.append(dict(type="Feature", geometry=f["geometry"], properties=pr))
for name, feats in (("nut", nf), ("ong", pf)):
    (G / f"{name}.geojson").write_text(json.dumps(dict(type="FeatureCollection", name=name, features=feats), ensure_ascii=False, default=float))
shutil.copy(C.ROOT / "data/network/errors.geojson", G / "loi_so_hoa.geojson")
iss = [dict(type="Feature", geometry=dict(type="Point", coordinates=i["lonlat"]),
            properties={k: v for k, v in i.items() if k not in ("lonlat", "pipes")}) for i in A["issues"]]
(G / "diem_van_de.geojson").write_text(json.dumps(dict(type="FeatureCollection", features=iss), ensure_ascii=False, default=float))
shutil.copy(M.INP, C.OUT / "vinh_thinh.inp")
sizes = {p.name: round(p.stat().st_size / 1024) for p in sorted(WEB.rglob("*.json"))}
print("web data KB:", sizes)
