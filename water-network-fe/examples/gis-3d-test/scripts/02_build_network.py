"""Bước 2: DXF → topology mạng lưới (nút + ống) trong hệ VN-2000.

- Polyline → ống; tách tại đầu mút / điểm nối chữ T / đỉnh trùng nhau.
- Gộp điểm cách nhau < SNAP_TOL thành một nút.
- Gán OD từ layer, đối chiếu nhãn "D.., L=..m" gần nhất.
- Phát hiện lỗi số hóa: đầu hở, nút treo (khe hở nhỏ), ống trùng, giao cắt không nút, mạng con cô lập.
Đầu ra: data/interim/{nodes,pipes,errors}.geojson (tọa độ VN-2000), output/step2/*.
"""
import json, math, re, collections
import numpy as np
import ezdxf
from ezdxf import path as ezpath
import networkx as nx
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, mapping
from shapely.ops import substring
from shapely.strtree import STRtree
import config as C


class UF:
    def __init__(s, n): s.p = list(range(n))
    def f(s, a):
        while s.p[a] != a:
            s.p[a] = s.p[s.p[a]]; a = s.p[a]
        return a
    def u(s, a, b): s.p[s.f(a)] = s.f(b)


def dedup(coords):
    out = [coords[0]]
    for c in coords[1:]:
        if math.dist(c, out[-1]) > 1e-3: out.append(c)
    return out


def read_dxf():
    doc = ezdxf.readfile(C.RAW_DXF); msp = doc.modelspace()
    lines = []
    for e in msp.query("LWPOLYLINE POLYLINE LINE"):
        if e.dxf.layer not in C.PIPE_LAYERS or e.dxf.linetype in C.EXCLUDE_LINETYPES:
            continue
        pts = [(v.x, v.y) for v in ezpath.make_path(e).flattening(0.05)]  # cung tròn → đoạn thẳng
        pts = dedup(pts)
        if len(pts) < 2: continue
        lines.append(dict(handle=e.dxf.handle, layer=e.dxf.layer, od=C.PIPE_LAYERS[e.dxf.layer],
                          color=e.dxf.color, geom=LineString(pts)))
    txt = lambda e: e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text
    labels = []
    for e in msp.query("TEXT MTEXT"):
        m = re.search(r"D\s*(\d+)\s*,\s*L\s*=\s*([\d.,]+)", txt(e))
        if m:
            labels.append(dict(od=int(m.group(1)), L=float(m.group(2).replace(",", ".")),
                               text=txt(e).strip(), pt=Point(e.dxf.insert.x, e.dxf.insert.y)))
    leaders = [LineString([(v.x, v.y) for v in ezpath.make_path(e).flattening(0.1)])
               for e in msp.query('LWPOLYLINE POLYLINE[layer=="Text D-L"]')]
    blocks = collections.defaultdict(list)
    for e in msp.query("INSERT"):
        blocks[e.dxf.name].append(Point(e.dxf.insert.x, e.dxf.insert.y))
    kt = [(txt(e).strip().upper(), Point(e.dxf.insert.x, e.dxf.insert.y))
          for e in msp.query('TEXT MTEXT[layer=="ten dai khoi thuy"]')]
    return lines, labels, leaders, blocks, kt


def build():
    lines, labels, leaders, blocks, kt = read_dxf()
    tol = C.SNAP_TOL
    errors = []
    def err(kind, sev, geom, msg, **kw):
        errors.append(dict(kind=kind, severity=sev, geom=geom, msg=msg, **kw))

    # Ưu tiên ống lớn khi chiếu nút lên ống đi xuyên qua
    lines.sort(key=lambda l: -l["od"])
    geoms = [l["geom"] for l in lines]
    tree = STRtree(geoms)

    # ---- 1. Cụm đầu mút -------------------------------------------------------
    ends = []  # (line_idx, which(0/1), xy)
    for i, g in enumerate(geoms):
        ends.append((i, 0, g.coords[0])); ends.append((i, 1, g.coords[-1]))
    exy = np.array([e[2] for e in ends])
    uf = UF(len(ends))
    for a, b in cKDTree(exy).query_pairs(tol): uf.u(a, b)
    # ---- 2. Đỉnh trung gian trùng nhau giữa các polyline khác nhau -------------
    inner = [(i, k, c) for i, g in enumerate(geoms) for k, c in enumerate(g.coords) if 0 < k < len(g.coords) - 1]
    ixy = np.array([c for _, _, c in inner]) if inner else np.zeros((0, 2))
    allxy = np.vstack([exy, ixy])
    uf2 = UF(len(allxy))
    for a, b in cKDTree(allxy).query_pairs(tol):
        ia = ends[a][0] if a < len(ends) else inner[a - len(ends)][0]
        ib = ends[b][0] if b < len(ends) else inner[b - len(ends)][0]
        if a >= len(ends) and b >= len(ends) and ia == ib: continue  # cùng 1 polyline tự chạm: bỏ qua
        if a < len(ends) and b < len(ends) or ia != ib:
            uf2.u(a, b)
    clusters = collections.defaultdict(list)
    for k in range(len(allxy)): clusters[uf2.f(k)].append(k)

    nodes = []   # dict(xy, members)
    split = collections.defaultdict(list)  # line_idx -> [(dist, node_id)]
    end_node = {}
    for cl in clusters.values():
        has_end = any(k < len(ends) for k in cl)
        lines_in = {(ends[k][0] if k < len(ends) else inner[k - len(ends)][0]) for k in cl}
        if not has_end and len(lines_in) < 2: continue
        xy = allxy[cl].mean(axis=0)
        nid = len(nodes)
        nodes.append(dict(xy=tuple(xy), via_inner=not has_end or any(k >= len(ends) for k in cl)))
        for k in cl:
            if k < len(ends): end_node[(ends[k][0], ends[k][1])] = nid
            else:
                li = inner[k - len(ends)][0]
                split[li].append((geoms[li].project(Point(allxy[k])), nid))
    # ---- 3. Nối chữ T: đầu mút nằm trên thân ống khác ---------------------------
    for nid, n in enumerate(nodes):
        p = Point(n["xy"]); moved = False
        for li in tree.query(p.buffer(tol)):
            g = geoms[li]
            if g.distance(p) >= tol: continue
            if (li, 0) in end_node and end_node[(li, 0)] == nid: continue
            if (li, 1) in end_node and end_node[(li, 1)] == nid: continue
            d = g.project(p)
            if d < tol or d > g.length - tol: continue
            if any(abs(d - dd) < tol for dd, _ in split[li]): continue
            split[li].append((d, nid))
            if not moved:  # đặt nút đúng lên ống đi xuyên (ống lớn nhất)
                q = g.interpolate(d); n["xy"] = (q.x, q.y); moved = True

    # ---- 4. Cắt polyline thành ống -------------------------------------------
    pipes = []
    for li, l in enumerate(lines):
        g = l["geom"]
        cuts = sorted(split[li])
        stops = [(0.0, end_node[(li, 0)])] + cuts + [(g.length, end_node[(li, 1)])]
        for (d0, n0), (d1, n1) in zip(stops[:-1], stops[1:]):
            if d1 - d0 < 1e-6 and n0 == n1: continue
            seg = substring(g, d0, d1)
            cs = list(seg.coords) if seg.geom_type == "LineString" else [seg.coords[0]] * 2
            cs[0] = nodes[n0]["xy"]; cs[-1] = nodes[n1]["xy"]
            if n0 == n1:
                if seg.length < tol: continue
                # vòng kín cùng nút: chèn nút giữa
                mid = seg.interpolate(0.5, normalized=True)
                nm = len(nodes); nodes.append(dict(xy=(mid.x, mid.y), via_inner=False))
                d_m = seg.project(mid)
                for a, b, s in ((n0, nm, substring(seg, 0, d_m)), (nm, n1, substring(seg, d_m, seg.length))):
                    cc = list(s.coords); cc[0] = nodes[a]["xy"]; cc[-1] = nodes[b]["xy"]
                    pipes.append(dict(n0=a, n1=b, geom=LineString(cc), src=l))
                continue
            pipes.append(dict(n0=n0, n1=n1, geom=LineString(cs), src=l))

    # ---- 5. Ống trùng ----------------------------------------------------------
    seen = {}
    keep = []
    for p in pipes:
        key = tuple(sorted((p["n0"], p["n1"])))
        if key in seen and seen[key]["geom"].hausdorff_distance(p["geom"]) < 1.0:
            q = seen[key]
            err("ong_trung", "vang", p["geom"].interpolate(0.5, normalized=True),
                f"Ống trùng: D{p['src']['od']} handle {p['src']['handle']} trùng D{q['src']['od']} handle {q['src']['handle']} (dài {p['geom'].length:.1f} m) — giữ ống lớn hơn",
                handles=[p["src"]["handle"], q["src"]["handle"]])
            continue
        seen[key] = p; keep.append(p)
    pipes = keep
    # chồng lấn một phần (đoạn song song chồng lên nhau > 2 m)
    pg = [p["geom"] for p in pipes]; pt = STRtree(pg)
    for i, g in enumerate(pg):
        for j in pt.query(g.buffer(0.2)):
            if j <= i: continue
            ov = g.intersection(pg[j].buffer(0.2))
            if ov.length > 2.0 and ov.length > 0.5 * min(g.length, pg[j].length):
                err("ong_chong_lan", "vang", ov.interpolate(0.5, normalized=True),
                    f"Ống chồng lấn {ov.length:.1f} m: D{pipes[i]['src']['od']} ({pipes[i]['src']['handle']}) và D{pipes[j]['src']['od']} ({pipes[j]['src']['handle']})")

    # ---- 6. Đồ thị, đầu hở, nút treo -----------------------------------------
    G = nx.MultiGraph()
    for nid, n in enumerate(nodes): G.add_node(nid)
    for k, p in enumerate(pipes): G.add_edge(p["n0"], p["n1"], key=k)
    used = {n for n in G.nodes if G.degree(n) > 0}
    bit_tree = cKDTree(np.array([(b.x, b.y) for b in blocks["bit"]]))
    dd_pts = blocks["Daudai"]
    kt_tree = cKDTree(np.array([(p.x, p.y) for _, p in kt]))
    node_xy = np.array([nodes[n]["xy"] for n in range(len(nodes))])
    ntree = cKDTree(node_xy)
    node_tag = collections.defaultdict(set)
    for n in used:
        if G.degree(n) == 1:
            d, _ = bit_tree.query(node_xy[n])
            if d < 1.0: node_tag[n].add("bit")
    # nhãn đai khởi thủy
    node_name = {}
    for b in dd_pts:
        d, n = ntree.query((b.x, b.y))
        if d < 1.0:
            node_tag[n].add("daudai")
            dk, k = kt_tree.query((b.x, b.y))
            if dk < 25: node_name[n] = kt[k][0]
        else:
            err("daudai_khong_tren_nut", "vang", b, f"Đai khởi thủy không trùng nút nối nào (cách {d:.2f} m)")

    # Nguồn: đầu ống D315 phía Bắc (giả định đã xác nhận "cứ giả định")
    od_at = collections.defaultdict(int)
    for p in pipes:
        for n in (p["n0"], p["n1"]): od_at[n] = max(od_at[n], p["src"]["od"])
    deg1 = [n for n in used if G.degree(n) == 1]
    src = max((n for n in deg1 if od_at[n] == 315), key=lambda n: node_xy[n][1])
    node_tag[src].add("nguon")

    gaps_fixed = []
    pipe_geoms = [p["geom"] for p in pipes]; ptree = STRtree(pipe_geoms)
    GL = nx.Graph()
    for k, p in enumerate(pipes): GL.add_edge(p["n0"], p["n1"], w=p["geom"].length, k=k)
    for n in deg1:
        if "bit" in node_tag[n] or n == src: continue
        P0 = Point(node_xy[n])
        # bỏ qua ống lân cận theo mạng (≤ 50 m): nối vào chỉ tạo vòng cục bộ — đó là đoạn vẽ thừa qua điểm nối cuối, không phải khe hở
        reach = nx.single_source_dijkstra_path_length(GL, n, cutoff=50.0, weight="w")
        inc = {k for _, _, k in G.edges(n, keys=True)}
        own = {GL[a][b]["k"] for a in reach for b in GL[a]} | inc
        near_all = [(pipe_geoms[k].distance(P0), k) for k in ptree.query(P0.buffer(C.NEAR_MISS_TOL))]
        near = [x for x in near_all if x[1] not in own and x[0] < C.NEAR_MISS_TOL]
        od = od_at[n]
        overshoot = [x for x in near_all if x[1] in own and x[0] < C.NEAR_MISS_TOL and x[1] not in inc]
        if not near and overshoot and od not in C.SERVICE_OD:
            stub = min(reach[m] for m in reach if m != n and GL.degree(m) >= 3) if any(GL.degree(m) >= 3 for m in reach if m != n) else 0
            err("doan_thua", "info", P0, f"Ống chính D{od} kết thúc sát ống đã nối cùng cụm (khe {min(x[0] for x in overshoot):.2f} m, cách theo mạng ≤ 50 m) — đoạn thừa/cụt ngắn, không ảnh hưởng thủy lực", node=int(n))
            continue
        if near:
            d, k = min(near)
            err("nut_treo", "do" if od not in C.SERVICE_OD else "vang", P0,
                f"Nút treo: đầu ống D{od} cách ống D{pipes[k]['src']['od']} {d:.2f} m nhưng không nối (khe hở {C.SNAP_TOL}–{C.NEAR_MISS_TOL} m)",
                node=int(n), gap=round(d, 2), target_pipe=k)
            gaps_fixed.append((n, k, d))
        else:
            if od in C.SERVICE_OD:
                err("dau_ho", "vang", P0, f"Đầu ống dịch vụ D{od} hở nhưng không có block bịt (bit)", node=int(n))
            else:
                err("dau_ho", "do", P0, f"Đầu ống chính D{od} hở — ống cụt hoặc tuyến nối sang khu vực khác ngoài bản vẽ", node=int(n))

    # ---- 7. Giao cắt không có nút --------------------------------------------
    for i, g in enumerate(pipe_geoms):
        for j in ptree.query(g):
            if j <= i: continue
            x = g.intersection(pipe_geoms[j])
            if x.is_empty or x.geom_type not in ("Point", "MultiPoint"): continue
            for q in getattr(x, "geoms", [x]):
                ends_ = [node_xy[pipes[i]["n0"]], node_xy[pipes[i]["n1"]], node_xy[pipes[j]["n0"]], node_xy[pipes[j]["n1"]]]
                if min(math.dist((q.x, q.y), e) for e in ends_) < C.SNAP_TOL: continue
                a, b = pipes[i]["src"]["od"], pipes[j]["src"]["od"]
                err("giao_cat_khong_nut", "vang" if (a in C.SERVICE_OD) != (b in C.SERVICE_OD) else "do", q,
                    f"Ống D{a} cắt ống D{b} nhưng không có nút nối — kiểm tra: đi chéo hay phải nối?")

    # ---- 8. Mạng con cô lập ----------------------------------------------------
    def components():
        H = nx.Graph(); H.add_nodes_from(used)
        H.add_edges_from((p["n0"], p["n1"]) for p in pipes)
        return list(nx.connected_components(H))
    comps = components()
    # Tự nối khe hở ≤ AUTOFIX_GAP nếu nút treo thuộc mạng con không có nguồn [GĐ]
    for n, k, d in sorted(gaps_fixed, key=lambda t: t[2]):
        comp_of = {m: ci for ci, c in enumerate(comps) for m in c}
        if src in comps[comp_of[n]] or d > C.AUTOFIX_GAP: continue
        g = pipes[k]["geom"]; dpos = g.project(Point(node_xy[n]))
        q = g.interpolate(dpos)
        if dpos < C.SNAP_TOL:
            m = pipes[k]["n0"]
        elif dpos > g.length - C.SNAP_TOL:
            m = pipes[k]["n1"]
        else:  # tách ống k tại điểm chiếu
            m = len(nodes); nodes.append(dict(xy=(q.x, q.y), via_inner=False))
            node_xy = np.vstack([node_xy, [q.x, q.y]]); used.add(m)
            a, b = substring(g, 0, dpos), substring(g, dpos, g.length)
            old = pipes[k]
            pipes[k] = dict(n0=old["n0"], n1=m, geom=a, src=old["src"])
            pipes.append(dict(n0=m, n1=old["n1"], geom=b, src=old["src"]))
        pipes.append(dict(n0=n, n1=m, geom=LineString([node_xy[n], node_xy[m]]), src=pipes[k]["src"] | {"handle": "AUTOFIX"}, autofix=True))
        for e in errors:
            if e.get("node") == int(n) and e["kind"] == "nut_treo": e["msg"] += " → ĐÃ TỰ NỐI (giả định)"; e["fixed"] = True
        comps = components()
    src_comp = next(c for c in comps if src in c)
    for c in comps:
        if src in c: continue
        L = sum(p["geom"].length for p in pipes if p["n0"] in c)
        xy = node_xy[list(c)].mean(axis=0)
        err("mang_con_co_lap", "do", Point(xy), f"Mạng con cô lập: {len(c)} nút, {L:.0f} m ống, không nối về nguồn", n_nodes=len(c), length=round(L, 1))

    # ---- 9. Đối chiếu nhãn D/L -------------------------------------------------
    ltree = STRtree([l["geom"] for l in lines])
    lead_ends = [(Point(ld.coords[0]), Point(ld.coords[-1])) for ld in leaders if len(ld.coords) >= 2]
    lab_by_line = collections.defaultdict(list)
    for lb in labels:
        target = lb["pt"]
        best = None
        for a, b in lead_ends:   # đường dẫn chú thích: đầu gần chữ → đầu kia chỉ vào ống
            for p0, p1 in ((a, b), (b, a)):
                d = p0.distance(lb["pt"])
                if d < 3 and (best is None or d < best[0]): best = (d, p1)
        if best: target = best[1]
        li = ltree.nearest(target)
        if lines[li]["geom"].distance(target) < 15: lab_by_line[li].append(lb)
    n_lab_mis_d = n_lab_mis_l = 0
    for li, lbs in lab_by_line.items():
        l = lines[li]
        for lb in lbs:
            if lb["od"] != l["od"]:
                n_lab_mis_d += 1
                err("nhan_khac_layer", "vang", l["geom"].interpolate(0.5, normalized=True),
                    f"Nhãn '{lb['text']}' ghi D{lb['od']} nhưng ống nằm trên layer {l['layer']} — dùng D theo layer", handle=l["handle"])
        Ls = sum(lb["L"] for lb in lbs if lb["od"] == l["od"])
        if Ls and abs(Ls - l["geom"].length) > max(5, 0.15 * Ls):
            n_lab_mis_l += 1
            err("nhan_chieu_dai", "info", l["geom"].interpolate(0.5, normalized=True),
                f"Tổng nhãn L={Ls:.0f} m khác chiều dài vẽ {l['geom'].length:.0f} m (handle {l['handle']})", handle=l["handle"])
    # Nhãn gán cho từng polyline (để hiển thị)
    line_label = {l["handle"]: "; ".join(lb["text"] for lb in lab_by_line.get(i, [])) for i, l in enumerate(lines)}

    # ---- 10. Đặt mã & xuất -------------------------------------------------
    final_nodes = sorted(used | {p["n0"] for p in pipes} | {p["n1"] for p in pipes})
    # sắp xếp theo vị trí (Bắc→Nam, Tây→Đông) để mã dễ đọc
    final_nodes.sort(key=lambda n: (-round(node_xy[n][1], -1), node_xy[n][0]))
    nid_map = {n: f"J{i+1:04d}" for i, n in enumerate(final_nodes)}
    nid_map[src] = "SRC"
    node_feats = []
    for n in final_nodes:
        tags = sorted(node_tag[n])
        node_feats.append(dict(type="Feature", geometry=dict(type="Point", coordinates=[round(v, 3) for v in node_xy[n]]),
                               properties=dict(id=nid_map[n], tags=tags, kt=node_name.get(n, ""), od_max=od_at[n])))
    pipe_feats = []
    pipes.sort(key=lambda p: (-p["src"]["od"], nid_map[p["n0"]]))
    for i, p in enumerate(pipes):
        od = p["src"]["od"]; svc = od in C.SERVICE_OD
        pipe_feats.append(dict(type="Feature", geometry=mapping(p["geom"]) | dict(coordinates=[[round(a, 3), round(b, 3)] for a, b in p["geom"].coords]),
                               properties=dict(id=f"P{i+1:04d}", n0=nid_map[p["n0"]], n1=nid_map[p["n1"]], od_mm=od,
                                               id_mm=round(od - 2 * C.WALL_SDR17_MM[od], 1), material=C.MATERIAL,
                                               hw_c=C.HW_C_SERVICE if svc else C.HW_C_MAIN,
                                               year=C.YEAR_SERVICE if svc else C.YEAR_MAIN,
                                               cls="dich_vu" if svc else "chinh",
                                               length_m=round(p["geom"].length, 2), dxf_handle=p["src"]["handle"],
                                               label=line_label.get(p["src"]["handle"], ""),
                                               autofix=bool(p.get("autofix")))))
    err_feats = []
    for k, e in enumerate(errors):
        g = e.pop("geom")
        e = {kk: (int(v) if isinstance(v, (np.integer,)) else v) for kk, v in e.items()}
        if "node" in e: e["node"] = nid_map.get(e["node"], e["node"])
        e.pop("target_pipe", None)
        err_feats.append(dict(type="Feature", geometry=dict(type="Point", coordinates=[round(g.x, 3), round(g.y, 3)]),
                              properties=dict(id=f"E{k+1:03d}") | e))
    crs = {"type": "name", "properties": {"name": "VN-2000 / TM-3 105°00' (Vĩnh Phúc)"}}
    C.INTERIM.mkdir(parents=True, exist_ok=True)
    for name, feats in (("nodes", node_feats), ("pipes", pipe_feats), ("errors", err_feats)):
        (C.INTERIM / f"{name}_vn2000.geojson").write_text(json.dumps(dict(type="FeatureCollection", crs=crs, features=feats), ensure_ascii=False))

    kinds = collections.Counter((f["properties"]["kind"], f["properties"]["severity"]) for f in err_feats)
    lens = collections.Counter()
    for f in pipe_feats: lens[f["properties"]["od_mm"]] += f["properties"]["length_m"]
    summary = dict(n_polylines=len(lines), n_nodes=len(node_feats), n_pipes=len(pipe_feats),
                   length_by_od={k: round(v) for k, v in sorted(lens.items())},
                   total_length=round(sum(lens.values())),
                   n_components=len(comps), source=nid_map[src],
                   n_bit_ends=sum("bit" in f["properties"]["tags"] for f in node_feats),
                   n_daudai_nodes=sum("daudai" in f["properties"]["tags"] for f in node_feats),
                   n_junction_via_inner_vertex=sum(1 for n in final_nodes if nodes[n].get("via_inner")),
                   errors={f"{k}|{s}": v for (k, s), v in sorted(kinds.items())},
                   labels_total=len(labels), labels_matched=sum(len(v) for v in lab_by_line.values()))
    out = C.OUT / "step2"; out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    with open(out / "loi_so_hoa.csv", "w", encoding="utf-8-sig") as fh:
        fh.write("id,loai,muc_do,x,y,mo_ta\n")
        for f in err_feats:
            p = f["properties"]; x, y = f["geometry"]["coordinates"]
            fh.write(f'{p["id"]},{p["kind"]},{p["severity"]},{x},{y},"{p["msg"]}"\n')
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    build()
