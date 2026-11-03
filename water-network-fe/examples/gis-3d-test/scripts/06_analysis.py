"""Bước 7–9: phân tích điểm có vấn đề, kịch bản vận hành, chỉ số hiệu quả, đề xuất cải tạo.

Phương pháp (tóm tắt — chi tiết trong báo cáo):
- Áp lực / vận tốc: so ngưỡng trên toàn bộ 24 h mô phỏng EPS.
- Tổn thất cột áp bất thường: độ dốc thủy lực (m/km) giờ cao điểm vượt ngưỡng theo nhóm ống.
- Một tuyến cấp / ống cụt: cạnh "cầu" (bridge) của đồ thị → số hộ mất nước khi ống đó hỏng.
- Van cô lập [GĐ]: không có trên bản vẽ → giả định van ở đầu mỗi nhánh dịch vụ và trên mọi nhánh của tê ống chính.
  Đoạn cô lập (segment) = thành phần liên thông khi "cắt" tại các van.
- Rò rỉ: phát hiện bằng lưu lượng đêm nhỏ nhất (MNF) tại đồng hồ tổng + đồng hồ DMA; định vị trong DMA bằng
  so khớp chênh áp tại logger áp lực với ma trận độ nhạy (bình phương tối thiểu). Dữ liệu "đo" là TỔNG HỢP
  (mô hình + nhiễu nhu cầu ±15% + nhiễu cảm biến), vì chưa có số liệu đo thực tế.
"""
import json, copy, pickle, random, math
import numpy as np
import pandas as pd
import networkx as nx
import wntr
import config as C
import model as M

OUT = C.OUT / "analysis"; OUT.mkdir(parents=True, exist_ok=True)
RUN = C.ROOT / "data/model/_run"
PUMPS = [f"BOM{i+1}" for i in range(C.N_PUMPS)]
PEAK_H, LOW_H = 19, 2
rng = np.random.default_rng(2026)

base_pk = pickle.load(open(RUN / "base.pkl", "rb"))
K_LEAK = base_pk["k"]
nodes_geo, pipes_geo = M.load_geo()
PIPE = {f["properties"]["id"]: f["properties"] for f in pipes_geo}
NODE = {f["properties"]["id"]: f["properties"] for f in nodes_geo}
NODE_LL = {f["properties"]["id"]: f["geometry"]["coordinates"] for f in nodes_geo}
PIPE_LL = {f["properties"]["id"]: f["geometry"]["coordinates"] for f in pipes_geo}
wn0, META = M.build_wn(K_LEAK)
HH = META["hh_by_node"]
J = M.junction_ids(wn0)
J_DEM = [j for j in J if HH.get(j, 0) > 0]
HH_TOT = sum(HH.values())
MAIN = [p for p, pr in PIPE.items() if pr["cls"] == "chinh"]
G = nx.Graph()
for p, pr in PIPE.items(): G.add_edge(pr["n0"], pr["n1"], id=p, L=pr["length_m"])


def last24(df, dur_h):
    return df.iloc[(dur_h - 24):(dur_h + 1)] if dur_h > 24 else df


SPECIAL = ("chua_chay", "ro_ri", "ro_ri_an")


def demand_parts(wn):
    """(nhu cầu khách hàng yêu cầu, lưu lượng đặc biệt chữa cháy/rò rỉ thử) theo giờ, m3/s, DataFrame 25×J.
    Nút đã bị xoá (mất nước) lấy nhu cầu khách hàng từ mô hình gốc."""
    hours = list(range(24)) + [0]
    cust = np.zeros((25, len(J))); spec = np.zeros((25, len(J)))
    for k, j in enumerate(J):
        src = wn if j in wn.node_name_list else wn0
        for d in src.get_node(j).demand_timeseries_list:
            pat = d.pattern.multipliers if d.pattern is not None else [1.0] * 24
            v = np.array([d.base_value * pat[h % len(pat)] for h in hours])
            if d.category in SPECIAL: spec[:, k] += v
            else: cust[:, k] += v
    return pd.DataFrame(cust, columns=J), pd.DataFrame(spec, columns=J)


def kpis(wn, res, dur_h, extra_loss=None, isolated=()):
    P = last24(res.node["pressure"], dur_h).reindex(columns=J).fillna(0.0)   # nút bị xoá (mất nước) → áp 0
    D = last24(res.node["demand"], dur_h).reindex(columns=J).fillna(0.0)
    Q = last24(res.link["flowrate"], dur_h)
    V = last24(res.link["velocity"], dur_h)
    K = np.array([(wn.get_node(j).emitter_coefficient or 0.0) if j in wn.node_name_list else 0.0 for j in J])
    leak = (P.clip(lower=0) ** C.LEAK_EMITTER_EXP * K).sum(axis=1)
    supply = Q[PUMPS].sum(axis=1)
    req, spec = demand_parts(wn)
    req.index = D.index; spec.index = D.index
    for j in isolated:
        if j in spec.columns: spec[j] = 0.0
    cons_node = D.values - (P.clip(lower=0).values ** C.LEAK_EMITTER_EXP) * K - spec.values
    consumed = pd.Series(cons_node.sum(axis=1), index=D.index)
    ratio = cons_node / np.where(req.values > 0, req.values, np.nan)
    ratio = pd.DataFrame(ratio, index=D.index, columns=J)
    minP = P.min()
    bad = set(j for j in J_DEM if minP[j] < C.P_LOW) | set(isolated)
    short = set(j for j in J_DEM if np.nanmin(ratio[j].values) < 0.9) | set(isolated)
    affected = bad | short
    # năng lượng bơm
    head = last24(res.node["head"], dur_h)
    E = 0.0
    for pu in PUMPS:
        dh = (head["SRC"] - head["HUT_BOM"]).clip(lower=0)
        E += float((1000 * 9.81 * Q[pu].clip(lower=0) * dh / C.PUMP_EFF).iloc[:-1].sum() * 3600 / 3.6e6)
    vol = float(supply.iloc[:-1].sum() * 3600)
    loss = float(leak.iloc[:-1].sum() * 3600) + (float(extra_loss.iloc[:-1].sum() * 3600) if extra_loss is not None else 0)
    out = dict(
        pct_nodes_pressure_ok=round(100 * sum(minP[j] >= C.P_LOW for j in J_DEM if j not in isolated) / len(J_DEM), 1),
        pct_demand_served=round(100 * float(consumed.iloc[:-1].sum() / req.iloc[:-1].values.sum()), 1),
        hh_affected=int(round(sum(HH[j] for j in affected))),
        p_min=round(float(P.drop(columns=list(isolated), errors="ignore").min().min()), 2),
        n_nodes_isolated=len(isolated),
        p_max=round(float(P.max().max()), 2),
        v_max=round(float(V[wn.pipe_name_list].abs().max().max()), 2),
        supply_m3_day=round(vol, 1),
        energy_kwh_day=round(E, 1),
        kwh_per_m3=round(E / vol, 3) if vol > 0 else None,
        nrw_pct=round(100 * loss / vol, 1) if vol > 0 else None,
    )
    if "quality" in res.node and dur_h >= 48:
        live = [j for j in J_DEM if j not in isolated]
        A = res.node["quality"].iloc[-1].reindex(live).fillna(0.0) / 3600
        w = np.array([HH[j] for j in live])
        out["water_age_mean_h"] = round(float(np.average(A.values, weights=w)), 1)
        out["water_age_p95_h"] = round(float(np.percentile(A.values, 95)), 1)
    return out, sorted(affected)


def series(res, dur_h):
    """Kết quả theo giờ (25 bước) cho web."""
    P = last24(res.node["pressure"], dur_h).reindex(columns=J).fillna(0.0)
    Q = last24(res.link["flowrate"], dur_h).reindex(columns=list(PIPE)).fillna(0.0)
    V = last24(res.link["velocity"], dur_h).reindex(columns=list(PIPE)).fillna(0.0)
    s = dict(pressure={j: np.round(P[j].values, 1).tolist() for j in J},
             flow={p: np.round(Q[p].values * 1000, 2).tolist() for p in wn0.pipe_name_list if p in PIPE},
             velocity={p: np.round(V[p].values, 3).tolist() for p in wn0.pipe_name_list if p in PIPE})
    if "quality" in res.node and dur_h >= 48:
        A = last24(res.node["quality"], dur_h).reindex(columns=J).fillna(0.0)
        s["age"] = {j: np.round(A[j].values / 3600, 1).tolist() for j in J}
    return s


SCEN = {}


def run_scenario(key, title, desc, modify=None, pdd=True, dur_h=72, extra_loss_fn=None, isolated=(), meta=None):
    wn = copy.deepcopy(wn0)
    if modify: modify(wn)
    res = M.run(wn, key, pdd=pdd, quality=True, duration_h=dur_h)
    xl = extra_loss_fn(res, dur_h) if extra_loss_fn else None
    k, aff = kpis(wn, res, dur_h, xl, isolated)
    SCEN[key] = dict(key=key, title=title, desc=desc, kpi=k, affected_nodes=aff, meta=meta or {}, series=series(res, dur_h))
    print(f"  [{key}] {title}: {k}")
    return wn, res


# =========================== 7. HIỆN TRẠNG + ĐIỂM CÓ VẤN ĐỀ ===========================
print("== Hiện trạng")
wnb, resb = run_scenario("base", "Hiện trạng (giả định)", "Nhu cầu trung bình ngày, 2 bơm chạy, rò rỉ nền ~18%.", pdd=False)
Pb = last24(resb.node["pressure"], 72)[J]
Vb = last24(resb.link["velocity"], 72)
Qb = last24(resb.link["flowrate"], 72)
Hb = last24(resb.node["head"], 72)
Ab = resb.node["quality"].iloc[-1][J] / 3600

issues = []
def issue(kind, sev, obj, ll, title, detail, **kw):
    issues.append(dict(id=f"I{len(issues)+1:03d}", kind=kind, severity=sev, obj=obj, lonlat=ll, title=title, detail=detail, **kw))

def mid(p):
    cs = PIPE_LL[p]; return cs[len(cs) // 2]

for j in J:
    if Pb[j].min() < C.P_LOW and HH.get(j, 0) > 0:
        issue("ap_thap", "do", j, NODE_LL[j], f"Áp lực thấp {Pb[j].min():.1f} m", f"Nút {j}: áp lực thấp nhất {Pb[j].min():.1f} m lúc {int(Pb[j].values.argmin())} h < {C.P_LOW} m")
    if Pb[j].max() > C.P_HIGH:
        issue("ap_cao", "vang", j, NODE_LL[j], f"Áp lực cao {Pb[j].max():.1f} m", f"Nút {j}: áp lực cao nhất {Pb[j].max():.1f} m > {C.P_HIGH} m")
vmax = Vb[list(PIPE)].abs().max()
hl = {}
for p, pr in PIPE.items():
    dh = (Hb[pr["n0"]] - Hb[pr["n1"]]).abs().iloc[PEAK_H]
    hl[p] = 1000 * dh / max(pr["length_m"], 1)
    if vmax[p] > C.V_HIGH:
        issue("van_toc_cao", "do", p, mid(p), f"Vận tốc cao {vmax[p]:.2f} m/s", f"Ống {p} D{pr['od_mm']}: vận tốc lớn nhất {vmax[p]:.2f} m/s > {C.V_HIGH} m/s")
# nước tù: ống chính vận tốc max < 0.1 m/s và nhánh cuối tuổi nước > 24h
stag_main = [p for p in MAIN if vmax[p] < C.V_LOW]
stag_len = {"chinh": sum(PIPE[p]["length_m"] for p in stag_main),
            "dich_vu": sum(pr["length_m"] for p, pr in PIPE.items() if pr["cls"] == "dich_vu" and vmax[p] < C.V_LOW)}
# gom ống chính nước tù thành tuyến liên tục để ghim 1 cảnh báo / tuyến
Hs = nx.Graph()
for p in stag_main: Hs.add_edge(PIPE[p]["n0"], PIPE[p]["n1"], id=p)
for comp in nx.connected_components(Hs):
    ps = [d["id"] for a, b, d in Hs.subgraph(comp).edges(data=True)]
    L = sum(PIPE[p]["length_m"] for p in ps)
    if L < 50: continue
    pm = max(ps, key=lambda p: PIPE[p]["length_m"])
    ods = sorted({PIPE[p]["od_mm"] for p in ps})
    issue("nuoc_tu", "vang", pm, mid(pm), f"Nước tù: {L:.0f} m ống chính v<{C.V_LOW} m/s",
          f"Tuyến D{'/'.join(map(str, ods))} dài {L:.0f} m có vận tốc lớn nhất < {C.V_LOW} m/s cả ngày → nguy cơ lắng cặn, suy giảm clo dư", pipes=ps)
old = [j for j in J if Ab[j] > 24 and (G.degree(j) == 1)]
for j in old:
    issue("tuoi_nuoc", "vang", j, NODE_LL[j], f"Tuổi nước {Ab[j]:.0f} h", f"Nút cuối {j}: tuổi nước {Ab[j]:.0f} h > 24 h — cần xả cặn định kỳ")
HL_TH = {"chinh": 5.0, "dich_vu": 15.0}  # m/km [GĐ]
for p, pr in PIPE.items():
    if hl[p] > HL_TH[pr["cls"]]:
        issue("ton_that_cao", "vang", p, mid(p), f"Tổn thất {hl[p]:.1f} m/km", f"Ống {p} D{pr['od_mm']}: độ dốc thủy lực giờ cao điểm {hl[p]:.1f} m/km > {HL_TH[pr['cls']]} m/km")

# --- một tuyến cấp / ống cụt -----------------------------------------------
Gs = nx.Graph(G)
bridges = set(map(frozenset, nx.bridges(Gs)))
n_loops = Gs.number_of_edges() - Gs.number_of_nodes() + 1
def downstream_hh(p):
    a, b = PIPE[p]["n0"], PIPE[p]["n1"]
    H = Gs.copy(); H.remove_edge(a, b)
    cc = nx.node_connected_component(H, "SRC")
    return sum(HH[n] for n in Gs.nodes if n not in cc), [n for n in Gs.nodes if n not in cc]
crit = {}
for p in MAIN:
    if frozenset((PIPE[p]["n0"], PIPE[p]["n1"])) in bridges:
        crit[p] = downstream_hh(p)[0]
    else:
        crit[p] = 0.0
main_dead = [n for n in Gs.nodes if Gs.degree(n) == 1 and NODE[n]["od_max"] not in C.SERVICE_OD and n != "SRC"]
for n in main_dead:
    issue("ong_cut", "vang", n, NODE_LL[n], f"Ống chính cụt D{NODE[n]['od_max']}", f"Nút {n}: đầu ống chính cụt — điểm nước tù, cần van xả/trụ xả cặn")
# Ghim cảnh báo một tuyến: các ống chính cầu có > 300 hộ phía sau, lấy ống đầu tiên của mỗi tuyến
top_crit = sorted(crit.items(), key=lambda t: -t[1])
T0 = nx.bfs_tree(Gs, "SRC")
def parent_of(p):
    a, b = PIPE[p]["n0"], PIPE[p]["n1"]
    return a if T0.has_edge(a, b) else b
def is_branch_head(p):
    u = parent_of(p)
    if u == "SRC": return True
    main_children = [c for c in T0.successors(u) if PIPE[Gs[u][c]["id"]]["cls"] == "chinh"]
    return len(main_children) >= 2
for p, h in top_crit:
    if h < 300: break
    if not is_branch_head(p): continue
    issue("mot_tuyen", "do" if h > 0.3 * HH_TOT else "vang", p, mid(p), f"Một tuyến cấp: {h:.0f} hộ",
          f"Ống {p} D{PIPE[p]['od_mm']} là tuyến duy nhất cấp cho {h:.0f} hộ ({100*h/HH_TOT:.0f}%) — hỏng ống là mất nước toàn bộ phía sau")

# =========================== VAN & ĐOẠN CÔ LẬP [GĐ] ===========================
def is_main_node(n): return any(PIPE[G[n][m]["id"]]["cls"] == "chinh" for m in G[n])
VALVES = set()
for p, pr in PIPE.items():
    if pr["cls"] == "dich_vu":
        for n in (pr["n0"], pr["n1"]):
            if is_main_node(n): VALVES.add((p, n))
for n in G.nodes:
    mains = [G[n][m]["id"] for m in G[n] if PIPE[G[n][m]["id"]]["cls"] == "chinh"]
    if len(mains) >= 3:
        for p in mains: VALVES.add((p, n))
first = [G["SRC"][m]["id"] for m in G["SRC"]][0]
VALVES.add((first, "SRC"))


def segments(valves):
    S = nx.Graph()
    for p, pr in PIPE.items():
        a = (pr["n0"], p) if (p, pr["n0"]) in valves else pr["n0"]
        b = (pr["n1"], p) if (p, pr["n1"]) in valves else pr["n1"]
        S.add_edge(a, b, id=p)
    segs = []
    for comp in nx.connected_components(S):
        sub = S.subgraph(comp)
        ps = sorted({d["id"] for _, _, d in sub.edges(data=True)})
        ns = sorted(n for n in comp if isinstance(n, str))
        segs.append(dict(pipes=ps, nodes=ns))
    return segs


def isolate(p, valves, segs=None):
    segs = segs or segments(valves)
    seg = next(s for s in segs if p in s["pipes"])
    H = Gs.copy()
    for q in seg["pipes"]: H.remove_edge(PIPE[q]["n0"], PIPE[q]["n1"])
    cc = nx.node_connected_component(H, "SRC") if "SRC" in H else set()
    lost = sorted(set(n for n in Gs.nodes if n not in cc) | set(seg["nodes"]))
    vclose = sorted({(q, n) for (q, n) in valves if q in seg["pipes"] or n in seg["nodes"]}
                    - {(q, n) for (q, n) in valves if q in seg["pipes"] and n in seg["nodes"]})
    return dict(segment=seg, lost_nodes=lost, hh_lost=sum(HH[n] for n in lost), valves=vclose)

SEGS = segments(VALVES)
seg_hh = sorted(((sum(HH[n] for n in s["nodes"]), i) for i, s in enumerate(SEGS)), reverse=True)
burst_all = {p: isolate(p, VALVES, SEGS)["hh_lost"] for p in MAIN}
print(f"  Van giả định: {len(VALVES)}; đoạn cô lập: {len(SEGS)}; lớn nhất {seg_hh[0][0]:.0f} hộ")

# =========================== DMA (đề xuất) ===========================
# Cây BFS từ nguồn theo hướng dòng chảy hiện trạng; đặt đồng hồ trên ống chính khi số hộ phía sau
# (chưa gán DMA) ≥ TARGET → DMA dạng bậc thang (cascade).
TARGET = 450
T = nx.bfs_tree(Gs, "SRC")
post = list(nx.dfs_postorder_nodes(T, "SRC"))
acc = {}; meters = []
for n in post:
    acc[n] = HH[n] + sum(acc[c] for c in T.successors(n))
    if n == "SRC": continue
    par = next(T.predecessors(n))
    p = Gs[par][n]["id"]
    if PIPE[p]["cls"] == "chinh" and acc[n] >= TARGET and par != "SRC":  # ống ra khỏi trạm = đồng hồ tổng
        meters.append((p, par, n)); acc[n] = 0
dma_of = {}
def assign(n, d):
    dma_of[n] = d
    for c in T.successors(n):
        p = Gs[n][c]["id"]
        assign(c, next((f"DMA{k+2}" for k, (mp, _, _) in enumerate(meters) if mp == p), d))
import sys; sys.setrecursionlimit(10000)
assign("SRC", "DMA1")
DMA = {}
for n, d in dma_of.items():
    DMA.setdefault(d, dict(nodes=[], hh=0.0)); DMA[d]["nodes"].append(n); DMA[d]["hh"] += HH[n]
for k, (p, a, b) in enumerate(meters):
    DMA[f"DMA{k+2}"]["meter_pipe"] = p
    DMA[f"DMA{k+2}"]["meter_up"] = a
DMA["DMA1"]["meter_pipe"] = "BOM (đồng hồ tổng trạm bơm)"
DMA["DMA1"]["note"] = "Phần còn lại quanh trục D315/D225 — lưu lượng = đồng hồ tổng − Σ đồng hồ DMA phía sau"
print("  DMA:", {d: round(v["hh"]) for d, v in DMA.items()})

# =========================== 8. KỊCH BẢN ===========================
print("== Kịch bản")
# 8.1 cao điểm / thấp điểm: lấy từ hiện trạng
def hour_kpi(h):
    P = Pb.iloc[h][J_DEM]
    return dict(hour=h, factor=M.PATTERN[h], supply_lps=round(float(Qb[PUMPS].sum(axis=1).iloc[h] * 1000), 2),
                p_min=round(float(P.min()), 2), p_median=round(float(P.median()), 2), p_max=round(float(Pb.iloc[h].max()), 2),
                pct_nodes_pressure_ok=round(100 * float((P >= C.P_LOW).mean()), 1),
                v_max=round(float(Vb.iloc[h][list(PIPE)].abs().max()), 2),
                leak_lps=round(float((Pb.iloc[h].clip(lower=0) * np.array([wn0.get_node(j).emitter_coefficient for j in J])).sum() * 1000), 2))
SCEN["base"]["meta"]["peak"] = hour_kpi(PEAK_H)
SCEN["base"]["meta"]["low"] = hour_kpi(LOW_H)

# 8.2 vỡ ống: (a) ống chính trọng yếu nhất có thể cô lập (b) ống điển hình trên nhánh D160
def burst(key, p, label):
    iso = isolate(p, VALVES, SEGS)
    lost = set(iso["lost_nodes"])
    def mod(wn):
        # đóng van = tách đoạn cô lập; nút mất nước bị xoá khỏi mô hình để phần còn lại giải được
        for q in iso["segment"]["pipes"]:
            if q in wn.link_name_list: wn.remove_link(q)
        for n in lost:
            for l in list(wn.get_links_for_node(n)):
                if l in wn.link_name_list: wn.remove_link(l)
            wn.remove_node(n)
    meta = dict(pipe=p, od=PIPE[p]["od_mm"], valves_to_close=[dict(pipe=q, node=n, lonlat=NODE_LL[n]) for q, n in iso["valves"]],
                segment_pipes=iso["segment"]["pipes"], lost_nodes=sorted(lost), hh_lost=round(iso["hh_lost"]),
                segment_length_m=round(sum(PIPE[q]["length_m"] for q in iso["segment"]["pipes"])))
    run_scenario(key, label, f"Vỡ ống {p} (D{PIPE[p]['od_mm']}). Đóng {len(iso['valves'])} van để cô lập đoạn dài {meta['segment_length_m']} m; "
                 f"{meta['hh_lost']} hộ mất nước.", modify=mod, isolated=tuple(lost), meta=meta)
cands = sorted(((h, p) for p, h in burst_all.items() if h < HH_TOT * 0.95), reverse=True)
p_crit = cands[0][1]
mid_cands = [p for p in MAIN if PIPE[p]["od_mm"] == 160 and 50 < burst_all[p] < 400]
p_typ = max(mid_cands, key=lambda p: burst_all[p]) if mid_cands else cands[len(cands) // 2][1]
burst("vo_ong_1", p_crit, f"Vỡ ống trục {p_crit} (D{PIPE[p_crit]['od_mm']})")
burst("vo_ong_2", p_typ, f"Vỡ ống nhánh {p_typ} (D{PIPE[p_typ]['od_mm']})")

# 8.3 trạm bơm
def stop_one(wn): wn.get_link("BOM2").initial_status = "CLOSED"
run_scenario("bom_dung", "Dừng 1 bơm (BOM2)", "Một trong hai bơm dừng cả ngày, bơm còn lại chạy theo đường đặc tính.", modify=stop_one)
def degrade(wn):
    for pu in PUMPS: wn.get_link(pu).base_speed = 0.85
run_scenario("bom_suy_giam", "Bơm suy giảm 15% tốc độ", "Cả hai bơm mòn/giảm tốc còn 85% (cột áp ≈ 72%).", modify=degrade)

# 8.4 chữa cháy: nút ống chính có áp lực giờ cao điểm thấp nhất
main_nodes = [n for n in J if is_main_node(n)]
fire_node = min(main_nodes, key=lambda n: Pb.iloc[PEAK_H][n])
def fire(wn):
    pat = [0.0] * 24; pat[17] = pat[18] = 1.0
    wn.add_pattern("CHAY", pat)
    wn.get_node(fire_node).add_demand(C.FIRE_FLOW_LPS / 1000, "CHAY", "chua_chay")
def fire_loss(res, dur_h):
    idx = last24(res.node["demand"], dur_h).index
    return pd.Series([C.FIRE_FLOW_LPS / 1000 if int(t / 3600) % 24 in (17, 18) else 0.0 for t in idx], index=idx) * 0  # nước chữa cháy không tính thất thoát
wnf, resf = run_scenario("chua_chay", f"Chữa cháy {C.FIRE_FLOW_LPS:.0f} L/s tại {fire_node}",
                         f"Lấy {C.FIRE_FLOW_LPS:.0f} L/s tại nút {fire_node} (trụ giả định trên ống D{NODE[fire_node]['od_max']}) từ 17 h–19 h, trùng giờ cao điểm.",
                         modify=fire, meta=dict(node=fire_node, lonlat=NODE_LL[fire_node]))
Pf = last24(resf.node["pressure"], 72)
SCEN["chua_chay"]["meta"]["p_fire_node_min"] = round(float(Pf[fire_node].iloc[17:19].min()), 2)

# 8.5 tăng nhu cầu 25%
def growth(wn):
    for j in J:
        for d in wn.get_node(j).demand_timeseries_list: d.base_value *= C.GROWTH
run_scenario("tang_nhu_cau", f"Tăng nhu cầu {int((C.GROWTH-1)*100)}%", "Phát triển đô thị: nhu cầu tăng 25% đều trên toàn mạng, giữ nguyên bơm.", modify=growth)

# 8.6 quản lý áp lực ban đêm (biến tần) — dùng cho đề xuất
def vfd(wn):
    pat = [0.80 if (h >= 23 or h < 5) else 1.0 for h in range(24)]
    wn.add_pattern("BIEN_TAN", pat)
    for pu in PUMPS: wn.get_link(pu).speed_pattern_name = "BIEN_TAN"
run_scenario("bien_tan_dem", "Giảm áp ban đêm (biến tần 80%, 23–5 h)", "Đề xuất: bơm chạy 80% tốc độ từ 23 h đến 5 h để giảm rò rỉ & điện năng.", modify=vfd)

# 8.7 RÒ RỈ ẨN: phát hiện + định vị ---------------------------------------
print("== Rò rỉ ẩn")
DIST = dict(nx.all_pairs_dijkstra_path_length(nx.Graph((PIPE[p]["n0"], PIPE[p]["n1"], {"w": PIPE[p]["length_m"]}) for p in PIPE), weight="w"))
MNF_H = 3


def steady(wn, leak_node=None, q=0.0, demand_noise=None):
    w = copy.deepcopy(wn)
    w.options.time.duration = 0
    w.options.time.pattern_start = MNF_H * 3600
    if demand_noise is not None:
        for j, f in zip(J, demand_noise):
            w.get_node(j).demand_timeseries_list[0].base_value *= f
    if leak_node:
        w.get_node(leak_node).add_demand(q, None, "ro_ri")
    r = M.run(w, "ss", pdd=False)
    return r.node["pressure"].iloc[0], r.link["flowrate"].iloc[0]

P0, F0 = steady(wn0)
LOGGERS_N = 10
# Ma trận độ nhạy: chênh áp tại mọi nút khi rò rỉ ở từng nút ứng viên (nút có hộ dùng nước + nút ống chính)
cand = sorted(set(J_DEM) | set(main_nodes))
Q_SIG = C.LEAK_TEST_LPS / 1000
sig_cache = RUN / "sig.pkl"   # ma trận độ nhạy tốn ~3 phút → lưu tạm
sig = pickle.load(open(sig_cache, "rb")) if sig_cache.exists() else {}
if sorted(sig) != cand or abs(K_LEAK - sig.get("_k", 0)) > 1e-15:
    sig = {}
    for i, n in enumerate(cand):
        Pn, _ = steady(wn0, n, Q_SIG)
        sig[n] = (P0[J] - Pn[J]).values
    pickle.dump(sig | {"_k": K_LEAK}, open(sig_cache, "wb"))
sig.pop("_k", None)
SIG = np.array([sig[n] for n in cand])  # |cand| × |J|
Jidx = {j: k for k, j in enumerate(J)}
# DMA chứa nút
dma_nodes = {d: set(v["nodes"]) for d, v in DMA.items()}
node_dma = {n: d for d, ns in dma_nodes.items() for n in ns}

# Chọn logger tham lam: giảm sai số định vị trung bình (trong DMA) trên tập ứng viên
def localize(resid, sensors, dma):
    cidx = [k for k, n in enumerate(cand) if node_dma.get(n) == dma]
    S = SIG[np.ix_(cidx, [Jidx[s] for s in sensors])]
    err = ((S - resid[None, :]) ** 2).sum(axis=1)
    k = int(np.argmin(err))
    return cand[cidx[k]]

SIGMA_P = 0.05   # m — nhiễu logger [GĐ]
sensor_pool = [n for n in J if G.degree(n) == 1 or n in main_nodes]
sensors = []
train = rng.choice(len(cand), size=min(150, len(cand)), replace=False)
for it in range(LOGGERS_N):
    best = None
    for s in sensor_pool[::2]:
        if s in sensors: continue
        ss = sensors + [s]
        e = 0
        for k in train:
            n = cand[k]
            r = SIG[k, [Jidx[x] for x in ss]] + rng.normal(0, SIGMA_P, len(ss))
            e += DIST[n][localize(r, ss, node_dma[n])]
        e /= len(train)
        if best is None or e < best[0]: best = (e, s)
    sensors.append(best[1])
    print(f"  logger {it+1}: {best[1]} → sai số TB tập huấn luyện {best[0]:.0f} m")

def leak_trial(n, seed):
    r_ = np.random.default_rng(seed)
    # nhu cầu thực tế lệch so với mô hình: hệ số chung ±5% (thời tiết, ngày trong tuần) × riêng từng nút ±15%
    noise = (r_.normal(1.0, 0.05) * r_.normal(1.0, 0.15, len(J))).clip(0.4, 1.6)
    Pm, Fm = steady(wn0, n, Q_SIG, demand_noise=noise)
    # 1) Phát hiện: MNF tổng tăng so với mô hình
    mnf_excess = float((Fm[PUMPS].sum() - F0[PUMPS].sum()) * 1000)
    # 2) DMA: so lưu lượng qua đồng hồ DMA (đã trừ DMA phía sau) với mô hình
    def dma_flow(F):
        out = {}
        for d, v in DMA.items():
            fin = F[PUMPS].sum() if d == "DMA1" else abs(F[v["meter_pipe"]])
            fout = sum(abs(F[DMA[e]["meter_pipe"]]) for e in DMA if e != "DMA1" and DMA[e]["meter_up"] in dma_nodes[d])
            out[d] = (fin - fout) * 1000
        return out
    dm, d0 = dma_flow(Fm), dma_flow(F0)
    excess = {d: dm[d] - d0[d] for d in DMA}
    dma_est = max(excess, key=excess.get)
    resid = (P0[sensors] - Pm[sensors]).values + r_.normal(0, SIGMA_P, len(sensors))
    est = localize(resid, sensors, dma_est)
    return dict(true=n, est=est, err_m=round(DIST[n][est]), dma_true=node_dma[n], dma_est=dma_est,
                mnf_excess_lps=round(mnf_excess, 2), dma_excess_lps={k: round(v, 2) for k, v in excess.items()})

trials = [leak_trial(n, 100 + i) for i, n in enumerate(rng.choice(J_DEM, size=40, replace=False))]
errs = np.array([t["err_m"] for t in trials])
mnf_noise = []
for i in range(40):  # nhiễu MNF khi KHÔNG rò rỉ (để đặt ngưỡng phát hiện)
    r9 = np.random.default_rng(900 + i)
    noise = (r9.normal(1.0, 0.05) * r9.normal(1.0, 0.15, len(J))).clip(0.4, 1.6)
    _, Fm = steady(wn0, None, 0, demand_noise=noise)
    mnf_noise.append(float((Fm[PUMPS].sum() - F0[PUMPS].sum()) * 1000))
mnf_thr = 3 * float(np.std(mnf_noise))
leak_eval = dict(n_trials=len(trials), leak_lps=C.LEAK_TEST_LPS, loggers=sensors, sigma_logger_m=SIGMA_P,
                 demand_noise="chung ±5% × từng nút ±15%", mnf_threshold_lps=round(mnf_thr, 2),
                 detect_rate=round(float(np.mean([t["mnf_excess_lps"] > mnf_thr for t in trials])), 2),
                 dma_hit_rate=round(float(np.mean([t["dma_true"] == t["dma_est"] for t in trials])), 2),
                 err_median_m=int(np.median(errs)), err_p75_m=int(np.percentile(errs, 75)),
                 within_100m=round(float(np.mean(errs <= 100)), 2), within_250m=round(float(np.mean(errs <= 250)), 2),
                 trials=trials)
print("  Đánh giá định vị:", {k: v for k, v in leak_eval.items() if k != "trials"})
# kịch bản hiển thị: 1 rò rỉ ẩn ngẫu nhiên (EPS 72 h)
leak_node = str(rng.choice(J_DEM))
tr = leak_trial(leak_node, 7)
def add_leak(wn): wn.get_node(leak_node).add_demand(Q_SIG, None, "ro_ri_an")
run_scenario("ro_ri_an", f"Rò rỉ ẩn {C.LEAK_TEST_LPS:.0f} L/s (vị trí ngẫu nhiên)",
             f"Rò rỉ {C.LEAK_TEST_LPS:.0f} L/s tại vị trí ẩn. Bộ phân tích: MNF tăng {tr['mnf_excess_lps']} L/s "
             f"(ngưỡng {mnf_thr:.2f}) → khoanh vùng {tr['dma_est']} → định vị {tr['est']}, sai số {tr['err_m']} m.",
             modify=add_leak, pdd=False,
             extra_loss_fn=lambda res, d: pd.Series(Q_SIG, index=last24(res.node["demand"], d).index),
             meta=dict(true_node=leak_node, true_lonlat=NODE_LL[leak_node], est_node=tr["est"], est_lonlat=NODE_LL[tr["est"]],
                       err_m=tr["err_m"], dma_true=tr["dma_true"], dma_est=tr["dma_est"], mnf_excess_lps=tr["mnf_excess_lps"],
                       detected=tr["mnf_excess_lps"] > mnf_thr))

# =========================== 9. ĐỀ XUẤT CẢI TẠO ===========================
print("== Đề xuất")
recs = []
def rec(prio, kind, title, detail, why, items=None):
    recs.append(dict(priority=prio, kind=kind, title=title, detail=detail, why=why, items=items or []))

# (a) mạch vòng / tuyến cấp thứ hai: cặp nút ống chính gần nhau theo đường chim bay nhưng xa theo mạng
mn = [n for n in main_nodes]
xy = {n: (NODE[n]["x_vn2000"], NODE[n]["y_vn2000"]) for n in mn}
def exp_loss(extra_edges=()):
    H = Gs.copy(); H.add_edges_from(extra_edges)
    br = set(map(frozenset, nx.bridges(H)))
    tot = 0.0
    for p in MAIN:
        a, b = PIPE[p]["n0"], PIPE[p]["n1"]
        if frozenset((a, b)) not in br: continue
        H2 = H.copy(); H2.remove_edge(a, b)
        cc = nx.node_connected_component(H2, "SRC")
        tot += PIPE[p]["length_m"] * sum(HH[n] for n in H.nodes if n not in cc)
    return tot / sum(PIPE[p]["length_m"] for p in MAIN)
base_loss = exp_loss()
pairs = []
for i, a in enumerate(mn):
    for b in mn[i + 1:]:
        d = math.dist(xy[a], xy[b])
        if 30 < d < 700 and DIST[a][b] > max(3 * d, 600):
            pairs.append((d, a, b))
pairs.sort()
chosen = []
# lọc thô: mỗi cặp vùng chỉ giữ cặp ngắn nhất
pre = []
for d, a, b in pairs:
    if any((math.dist(xy[a], xy[c]) < 250 and math.dist(xy[b], xy[e]) < 250) or
           (math.dist(xy[a], xy[e]) < 250 and math.dist(xy[b], xy[c]) < 250) for _, c, e in pre): continue
    pre.append((d, a, b))
chosen = []
for d, a, b in pre[:40]:
    gain = base_loss - exp_loss([(a, b)])
    chosen.append((d, a, b, gain))
chosen.sort(key=lambda t: -t[3] / t[0])   # lợi ích trên mỗi mét ống
picked = []
for t in chosen:
    if t[3] < 5: continue
    if any(min(math.dist(xy[t[1]], xy[u[1]]), math.dist(xy[t[2]], xy[u[2]])) < 300 for u in picked): continue
    picked.append(t)
    if len(picked) == 3: break
chosen = picked
loops = []
for d, a, b, gain in chosen[:3]:
    od = max(110, min(NODE[a]["od_max"], NODE[b]["od_max"]))
    loops.append(dict(from_node=a, to_node=b, length_m=round(d * 1.15), od_mm=od, line=[NODE_LL[a], NODE_LL[b]],
                      exp_hh_loss_reduction=round(gain, 1)))
if loops:
    rec(1, "mach_vong", f"Khép {len(loops)} mạch vòng ống chính",
        "; ".join(f"nối {l['from_node']}–{l['to_node']} D{l['od_mm']} ~{l['length_m']} m" for l in loops),
        f"Mạng hiện chỉ có {n_loops} vòng, gần như dạng cây; một tuyến cấp cho tới {top_crit[0][1]:.0f} hộ. "
        f"Kỳ vọng số hộ mất nước khi hỏng ngẫu nhiên 1 ống chính (trọng số theo chiều dài) giảm từ {base_loss:.0f} xuống {exp_loss([(l['from_node'], l['to_node']) for l in loops]):.0f} hộ "
        f"(chiều dài nối = 1,15 × khoảng cách thẳng [GĐ]).", items=loops)
# (b) nguồn thứ hai: 2 đầu D225 ra ngoài bản vẽ
d225_ends = [n for n in main_dead if NODE[n]["od_max"] == 225]
rec(1, "nguon_2", "Đấu nối liên vùng tại 2 đầu D225 (nguồn cấp thứ hai)",
    f"Kiểm tra hiện trạng các đầu D225 {', '.join(d225_ends)} (ra ngoài phạm vi bản vẽ); nếu nối được mạng xã lân cận hoặc nhà máy thứ hai thì lắp van + đồng hồ liên vùng.",
    f"Toàn bộ {HH_TOT:.0f} hộ phụ thuộc một trạm bơm và tuyến D315 duy nhất (vỡ ống D315 = mất nước 100%).",
    items=[dict(node=n, lonlat=NODE_LL[n]) for n in d225_ends])
# (c) thêm van phân đoạn: chia đoạn cô lập lớn (greedy)
def add_valves_greedy(valves, max_add=12, target=150):
    v = set(valves); added = []
    for _ in range(max_add):
        segs = segments(v)
        big = max(segs, key=lambda s: sum(HH[n] for n in s["nodes"]))
        hb = sum(HH[n] for n in big["nodes"])
        if hb <= target: break
        best = None
        for p in big["pipes"]:
            if PIPE[p]["cls"] != "chinh": continue
            for n in (PIPE[p]["n0"], PIPE[p]["n1"]):
                if (p, n) in v: continue
                s2 = segments(v | {(p, n)})
                m = max(sum(HH[x] for x in s["nodes"]) for s in s2)
                if best is None or m < best[0]: best = (m, p, n)
        if best is None or best[0] >= hb: break
        v.add((best[1], best[2])); added.append(dict(pipe=best[1], node=best[2], lonlat=NODE_LL[best[2]], od=PIPE[best[1]]["od_mm"], max_seg_hh_after=round(best[0])))
    return v, added
v2, added = add_valves_greedy(VALVES)
segs2 = segments(v2)
max_before = seg_hh[0][0]; max_after = max(sum(HH[n] for n in s["nodes"]) for s in segs2)
mean_burst_before = np.mean([burst_all[p] for p in MAIN])
mean_burst_after = np.mean([isolate(p, v2, segs2)["hh_lost"] for p in MAIN])
if not added:
    rec(2, "them_van", f"Khảo sát & hoàn thiện {len(VALVES)} van cô lập (vị trí giả định)",
        f"Bản vẽ không có van. Mô hình giả định van ở đầu {sum(1 for v in VALVES if PIPE[v[0]]['cls']=='dich_vu')} nhánh dịch vụ, "
        f"trên mọi nhánh của tê ống chính và sau trạm bơm ({len(VALVES)} van, {len(SEGS)} đoạn cô lập, lớn nhất {max_before:.0f} hộ).",
        f"Với bố trí này thêm van không giảm thêm số hộ mất nước: khi vỡ 1 ống chính trung bình {mean_burst_before:.0f} hộ mất nước, "
        f"phần lớn là hộ phía sau trên mạng dạng cây — chỉ mạch vòng/nguồn thứ hai giải quyết được. Cần kiểm kê van thực tế để cập nhật.",
        items=[dict(pipe=p, node=n, lonlat=NODE_LL[n]) for p, n in sorted(VALVES)])
else:
    rec(2, "them_van", f"Lắp thêm {len(added)} van phân đoạn trên ống chính",
    "; ".join(f"van trên {a['pipe']} (D{a['od']}) tại {a['node']}" for a in added),
    f"Đoạn cô lập lớn nhất giảm từ {max_before:.0f} xuống {max_after:.0f} hộ; số hộ mất nước trung bình khi vỡ 1 ống chính "
    f"giảm {mean_burst_before:.0f} → {mean_burst_after:.0f} hộ (trên cơ sở van giả định hiện có).", items=added)
# (d) quản lý áp lực / biến tần thay PRV
b, v_ = SCEN["base"]["kpi"], SCEN["bien_tan_dem"]["kpi"]
rec(2, "quan_ly_ap", "Lắp biến tần bơm, giảm áp ban đêm (không cần PRV)",
    f"Áp lực lớn nhất {b['p_max']} m < {C.P_HIGH} m nên chưa cần van giảm áp (PRV). Chạy bơm 80% tốc độ 23 h–5 h.",
    f"Mô phỏng: thất thoát {b['nrw_pct']}% → {v_['nrw_pct']}%, điện năng {b['energy_kwh_day']} → {v_['energy_kwh_day']} kWh/ngày; "
    f"% nút đạt áp lực {v_['pct_nodes_pressure_ok']}%.")
# (e) DMA
rec(2, "dma", f"Chia {sum(1 for v in DMA.values() if v['hh'] > 0)} khu đo đếm DMA (bậc thang)",
    "; ".join(f"{d}: {v['hh']:.0f} hộ, đồng hồ trên {v['meter_pipe']}" for d, v in DMA.items()),
    f"Thử nghiệm rò rỉ ẩn {C.LEAK_TEST_LPS:.0f} L/s (40 lần): phát hiện {leak_eval['detect_rate']*100:.0f}%, khoanh đúng DMA {leak_eval['dma_hit_rate']*100:.0f}%, "
    f"sai số vị trí trung vị {leak_eval['err_median_m']} m với {LOGGERS_N} logger áp lực.",
    items=[dict(dma=d, hh=round(v["hh"]), meter_pipe=v["meter_pipe"], lonlat=(mid(v["meter_pipe"]) if v["meter_pipe"] in PIPE else NODE_LL["SRC"])) for d, v in DMA.items()])
# (f) xả cặn / nước tù
dead_old = sorted(old, key=lambda j: -Ab[j])
rec(3, "xa_can", f"Lắp van xả cặn tại {len(main_dead)} đầu ống chính cụt + xả định kỳ {len(dead_old)} đầu nhánh tuổi nước > 24 h",
    f"Ống chính cụt: {', '.join(main_dead)}. Tổng {stag_len['chinh']:.0f} m ống chính có v < {C.V_LOW} m/s cả ngày.",
    f"Ống chính được thiết kế dư so với nhu cầu giả định (v lớn nhất {SCEN['base']['kpi']['v_max']} m/s), nước lưu lâu → suy giảm clo dư.",
    items=[dict(node=n, lonlat=NODE_LL[n]) for n in main_dead])
# (g) thay ống
hv = [i for i in issues if i["kind"] in ("van_toc_cao", "ton_that_cao")]
gr = SCEN["tang_nhu_cau"]["kpi"]
rec(3 if not hv else 1, "thay_ong", "Thay ống / tăng cỡ ống" if hv else "Chưa cần thay ống theo thủy lực",
    (f"{len(hv)} ống có vận tốc/tổn thất vượt ngưỡng." if hv else
     f"Không ống nào vượt {C.V_HIGH} m/s hay ngưỡng tổn thất, kể cả khi nhu cầu +25% (áp lực thấp nhất {gr['p_min']} m)."),
    f"Năm lắp đặt ống chính là giả định ({C.YEAR_MAIN}); cần hồ sơ thực tế + lịch sử sự cố để xếp hạng thay ống theo tuổi/vật liệu.",
    items=[dict(pipe=i["obj"], lonlat=i["lonlat"]) for i in hv])
# (h) sửa lỗi số hóa
recs.sort(key=lambda r: r["priority"])

# =========================== LƯU ===========================
summary = dict(
    network=dict(n_nodes=len(J), n_pipes=len(PIPE), length_km=round(sum(p["length_m"] for p in PIPE.values()) / 1000, 2),
                 households=round(HH_TOT), persons=round(HH_TOT * C.PERSONS_PER_HH), n_loops=n_loops,
                 n_valves_assumed=len(VALVES), n_segments=len(SEGS), max_segment_hh=round(seg_hh[0][0]),
                 stagnant_length_m={k: round(v) for k, v in stag_len.items()}),
    scenarios={k: dict(title=v["title"], desc=v["desc"], kpi=v["kpi"], meta={mk: mv for mk, mv in v["meta"].items() if mk not in ("lost_nodes", "segment_pipes")}) for k, v in SCEN.items()},
    issues_count={k: sum(1 for i in issues if i["kind"] == k) for k in sorted({i["kind"] for i in issues})},
    leak_eval={k: v for k, v in leak_eval.items() if k != "trials"},
    dma={d: dict(hh=round(v["hh"]), meter_pipe=v["meter_pipe"], n_nodes=len(v["nodes"])) for d, v in DMA.items()},
    top_critical_mains=[dict(pipe=p, od=PIPE[p]["od_mm"], hh_single_feed=round(h), hh_burst_isolated=round(burst_all[p])) for p, h in top_crit[:10]],
    recommendations=recs,
)
(OUT / "ket_qua_phan_tich.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1, default=float))
(OUT / "danh_sach_van_de.json").write_text(json.dumps(issues, ensure_ascii=False, indent=1, default=float))
(OUT / "danh_gia_ro_ri.json").write_text(json.dumps(leak_eval, ensure_ascii=False, indent=1, default=float))
pickle.dump(dict(SCEN=SCEN, issues=issues, recs=recs, DMA=DMA, VALVES=sorted(VALVES), added_valves=added, loops=loops,
                 crit=crit, burst_all=burst_all, sensors=sensors, leak_eval=leak_eval, HH=HH, hl=hl, summary=summary),
            open(RUN / "analysis.pkl", "wb"))
print(json.dumps({k: v["kpi"] for k, v in SCEN.items()}, ensure_ascii=False, indent=1, default=float))
