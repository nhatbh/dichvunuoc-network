"""Dựng mô hình WNTR/EPANET từ GeoJSON mạng lưới + các hàm chạy mô phỏng dùng chung cho các bước 5–9."""
import json, copy
import numpy as np
import networkx as nx
import wntr
from pyproj import Transformer
import config as C

NET = C.ROOT / "data/network"
INP = C.ROOT / "data/model/vinh_thinh.inp"
to_m = Transformer.from_crs("EPSG:4326", C.VN2000_PROJ, always_xy=True)

# [GĐ] Đồ thị dùng nước 24 h điển hình khu dân cư nông thôn VN: cao điểm sáng 6–8 h và tối 17–20 h.
PATTERN_RAW = [0.45, 0.40, 0.38, 0.40, 0.55, 0.95, 1.45, 1.55, 1.30, 1.10, 1.05, 1.15,
               1.25, 1.05, 0.90, 0.85, 0.95, 1.30, 1.65, 1.75, 1.45, 1.10, 0.80, 0.55]
PATTERN = (np.array(PATTERN_RAW) / np.mean(PATTERN_RAW)).round(3).tolist()


def load_geo():
    nodes = json.load(open(NET / "nodes.geojson"))["features"]
    pipes = json.load(open(NET / "pipes.geojson"))["features"]
    return nodes, pipes


def allocate_households(nodes, pipes):
    """[GĐ] Số hộ = chiều dài ống dịch vụ × HH_PER_M_SERVICE, chia đều về 2 nút đầu ống."""
    hh = {f["properties"]["id"]: 0.0 for f in nodes}
    for p in pipes:
        pr = p["properties"]
        if pr["cls"] != "dich_vu": continue
        h = pr["length_m"] * C.HH_PER_M_SERVICE / 2
        hh[pr["n0"]] += h; hh[pr["n1"]] += h
    return hh


def build_wn(leak_coef_per_m=0.0):
    nodes, pipes = load_geo()
    hh = allocate_households(nodes, pipes)
    wn = wntr.network.WaterNetworkModel()
    wn.options.time.duration = 24 * 3600
    wn.options.time.hydraulic_timestep = 3600
    wn.options.time.pattern_timestep = 3600
    wn.options.time.report_timestep = 3600
    wn.options.time.quality_timestep = 300
    wn.options.hydraulic.headloss = "H-W"
    wn.options.hydraulic.inpfile_units = "LPS"
    wn.options.hydraulic.accuracy = 0.001
    wn.options.hydraulic.trials = 200
    wn.options.hydraulic.required_pressure = C.P_LOW
    wn.options.hydraulic.minimum_pressure = 0.0
    wn.options.energy.global_efficiency = C.PUMP_EFF * 100
    wn.options.hydraulic.emitter_exponent = C.LEAK_EMITTER_EXP
    wn.add_pattern("DAN_CU", PATTERN)
    lpd_per_hh = C.PERSONS_PER_HH * C.LPCD * C.OTHER_DEMAND_FACTOR  # L/hộ/ngày
    # chiều dài ống gắn với mỗi nút (để phân bổ rò rỉ nền)
    lnode = {f["properties"]["id"]: 0.0 for f in nodes}
    for p in pipes:
        pr = p["properties"]; lnode[pr["n0"]] += pr["length_m"] / 2; lnode[pr["n1"]] += pr["length_m"] / 2
    for f in nodes:
        pr = f["properties"]; x, y = to_m.transform(*f["geometry"]["coordinates"])
        base = hh[pr["id"]] * lpd_per_hh / 86400 / 1000  # m3/s
        wn.add_junction(pr["id"], base_demand=base, demand_pattern="DAN_CU", elevation=pr["elev"], coordinates=(x, y))
        if leak_coef_per_m > 0:
            # emitter: q = K·p^N (m3/s, m) ; K tỉ lệ chiều dài ống gắn với nút
            wn.get_node(pr["id"]).emitter_coefficient = leak_coef_per_m * lnode[pr["id"]]
    for p in pipes:
        pr = p["properties"]
        cs = [to_m.transform(*c) for c in p["geometry"]["coordinates"]]
        wn.add_pipe(pr["id"], pr["n0"], pr["n1"], length=max(pr["length_m"], 0.1), diameter=pr["id_mm"] / 1000,
                    roughness=pr["hw_c"], minor_loss=0.0, initial_status="OPEN")
        wn.get_link(pr["id"]).vertices = cs[1:-1]
    # Nguồn [GĐ]: bể chứa trạm bơm cạnh đầu D315 phía Bắc + 2 bơm song song
    src = wn.get_node("SRC")
    sx, sy = src.coordinates
    wn.add_reservoir("BE_CHUA", base_head=src.elevation + C.SOURCE_HEAD_ABOVE_GROUND, coordinates=(sx, sy + 40))
    wn.add_junction("HUT_BOM", base_demand=0, elevation=src.elevation, coordinates=(sx, sy + 20))
    wn.add_pipe("ONG_HUT", "BE_CHUA", "HUT_BOM", length=5, diameter=0.3, roughness=130)
    hh_tot = sum(hh.values())
    q_avg = hh_tot * lpd_per_hh / 86400 / 1000
    q_design = q_avg * max(PATTERN) * (1 + C.LEAK_TARGET_NRW) / C.N_PUMPS  # m3/s mỗi bơm ở giờ cao điểm
    wn.add_curve("BOM_QH", "HEAD", [(q_design, C.PUMP_DESIGN_HEAD)])  # 1 điểm: H = 1.33H0 − k·Q²
    for i in range(C.N_PUMPS):
        wn.add_pump(f"BOM{i+1}", "HUT_BOM", "SRC", pump_type="HEAD", pump_parameter="BOM_QH", speed=1.0)
    wn.options.quality.parameter = "AGE"
    meta = dict(households=hh_tot, persons=hh_tot * C.PERSONS_PER_HH, q_avg_lps=q_avg * 1000,
                q_design_per_pump_lps=q_design * 1000, hh_by_node=hh, lnode=lnode)
    return wn, meta


def run(wn, prefix="tmp", pdd=False, quality=False, duration_h=24):
    wn = copy.deepcopy(wn) if False else wn
    wn.options.hydraulic.demand_model = "PDD" if pdd else "DDA"
    wn.options.quality.parameter = "AGE" if quality else "NONE"
    wn.options.time.duration = duration_h * 3600
    sim = wntr.sim.EpanetSimulator(wn)
    d = C.ROOT / "data/model/_run"; d.mkdir(parents=True, exist_ok=True)
    return sim.run_sim(file_prefix=str(d / prefix), version=2.2)


def junction_ids(wn):
    return [j for j in wn.junction_name_list if j not in ("HUT_BOM",)]


def leak_flow(wn, res):
    """Lưu lượng rò rỉ (emitter) theo thời gian, m3/s, tổng mạng."""
    p = res.node["pressure"][junction_ids(wn)].clip(lower=0)
    K = np.array([wn.get_node(j).emitter_coefficient or 0.0 for j in junction_ids(wn)])
    return (p ** C.LEAK_EMITTER_EXP * K).sum(axis=1)


def graph(wn):
    G = nx.Graph()
    for name, l in wn.links():
        G.add_edge(l.start_node_name, l.end_node_name, name=name)
    return G
