"""Bước 3: VN-2000 (TM-3, KTT 105°00') → WGS84 bằng pyproj (towgs84 7 tham số).

Kiểm tra:
 1) Khứ hồi WGS84 → VN-2000 (sai số số học).
 2) So với bản đồ nền OSM (OpenFreeMap vector tiles, z14): khoảng cách từ đỉnh ống chính đến tim đường OSM
    gần nhất. Ống cấp nước chạy dọc đường nên phân bố độ lệch phản ánh sai lệch hệ tọa độ (+ độ lệch ống–tim đường).
 3) Ảnh chồng lớp lên tile OSM raster để kiểm tra bằng mắt.
"""
import json, math, io, sys, urllib.request
import numpy as np
from pyproj import Transformer, CRS
import config as C

SRC = CRS.from_proj4(C.VN2000_PROJ)
fwd = Transformer.from_crs(SRC, "EPSG:4326", always_xy=True)
inv = Transformer.from_crs("EPSG:4326", SRC, always_xy=True)
NETDIR = C.ROOT / "data/network"; NETDIR.mkdir(parents=True, exist_ok=True)
OUT = C.OUT / "step3"; OUT.mkdir(parents=True, exist_ok=True)


def tr(coords):
    a = np.asarray(coords, dtype=float)
    lon, lat = fwd.transform(a[..., 0], a[..., 1])
    return np.round(np.stack([lon, lat], -1), 7).tolist()


def convert():
    stats = {}
    for name in ("nodes", "pipes", "errors"):
        fc = json.load(open(C.INTERIM / f"{name}_vn2000.geojson"))
        for f in fc["features"]:
            g = f["geometry"]
            if g["type"] == "Point":  # giữ toạ độ gốc để tra cứu ngược trên bản vẽ
                f["properties"]["x_vn2000"], f["properties"]["y_vn2000"] = g["coordinates"]
            g["coordinates"] = tr(g["coordinates"])
        fc.pop("crs", None)  # RFC 7946: WGS84 mặc định
        (NETDIR / f"{name}.geojson").write_text(json.dumps(fc, ensure_ascii=False))
        stats[name] = len(fc["features"])
    return stats


def roundtrip():
    fc = json.load(open(C.INTERIM / "nodes_vn2000.geojson"))
    xy = np.array([f["geometry"]["coordinates"] for f in fc["features"]])
    lon, lat = fwd.transform(xy[:, 0], xy[:, 1])
    x2, y2 = inv.transform(lon, lat)
    return float(np.max(np.hypot(x2 - xy[:, 0], y2 - xy[:, 1])))


# ---------- So sánh với OSM vector tiles ----------
def lonlat2tile(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "wsn-vinhthinh/1.0 (research)"})
    return urllib.request.urlopen(req, timeout=60).read()


def osm_roads(bbox, z=14):
    import mapbox_vector_tile
    tj = json.loads(fetch("https://tiles.openfreemap.org/planet"))
    url = tj["tiles"][0]
    x0, y1 = lonlat2tile(bbox[0], bbox[1], z); x1, y0 = lonlat2tile(bbox[2], bbox[3], z)
    lines = []
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            raw = fetch(url.format(z=z, x=tx, y=ty))
            try:
                import gzip; raw = gzip.decompress(raw)
            except OSError:
                pass
            t = mapbox_vector_tile.decode(raw)
            if "transportation" not in t: continue
            ext = t["transportation"]["extent"]
            for feat in t["transportation"]["features"]:
                cls = feat["properties"].get("class", "")
                if cls in ("path", "track", "rail", "ferry", "aerialway", "transit"): continue
                g = feat["geometry"]
                parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]] if g["type"] == "LineString" else []
                for part in parts:
                    ll = []
                    for px, py in part:   # toạ độ tile (gốc dưới-trái theo mapbox_vector_tile)
                        n = 2 ** z
                        lon = (tx + px / ext) / n * 360 - 180
                        yy = ty + 1 - py / ext
                        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))
                        ll.append((lon, lat))
                    lines.append(dict(cls=cls, name=feat["properties"].get("name", ""), ll=ll))
    return lines


def compare_osm():
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree
    pipes = json.load(open(NETDIR / "pipes.geojson"))["features"]
    allc = np.array([c for f in pipes for c in f["geometry"]["coordinates"]])
    bbox = (allc[:, 0].min() - .003, allc[:, 1].min() - .003, allc[:, 0].max() + .003, allc[:, 1].max() + .003)
    roads = osm_roads(bbox)
    # đưa đường OSM về VN-2000 (mét) để đo khoảng cách
    rg = []
    for r in roads:
        a = np.array(r["ll"]); x, y = inv.transform(a[:, 0], a[:, 1])
        if len(a) >= 2: rg.append(LineString(np.c_[x, y]))
    tree = STRtree(rg)
    pv = json.load(open(C.INTERIM / "pipes_vn2000.geojson"))["features"]
    d_main, d_all = [], []
    for f in pv:
        g = LineString(f["geometry"]["coordinates"])
        for s in np.arange(0, g.length, 20.0):   # lấy mẫu mỗi 20 m dọc ống
            p = g.interpolate(s)
            d = rg[tree.nearest(p)].distance(p)
            (d_main if f["properties"]["cls"] == "chinh" else d_all).append(d)
    # dịch chuyển hệ thống: tìm (dx,dy) cực tiểu trung vị khoảng cách ống chính
    pts = []
    for f in pv:
        if f["properties"]["cls"] != "chinh": continue
        g = LineString(f["geometry"]["coordinates"])
        pts += [g.interpolate(s) for s in np.arange(0, g.length, 20.0)]
    best = (np.median(d_main), 0, 0)
    for dx in range(-30, 31, 3):
        for dy in range(-30, 31, 3):
            from shapely.affinity import translate
            ds = [rg[tree.nearest(translate(p, dx, dy))].distance(translate(p, dx, dy)) for p in pts[::3]]
            m = float(np.median(ds))
            if m < best[0]: best = (m, dx, dy)
    q = lambda a: {k: round(float(np.percentile(a, v)), 1) for k, v in (("p25", 25), ("trung_vi", 50), ("p75", 75), ("p90", 90))}
    res = dict(n_osm_roads=len(rg), main_pipe_to_road_m=q(d_main), service_pipe_to_road_m=q(d_all),
               share_main_within_10m=round(float(np.mean(np.array(d_main) < 10)), 3),
               best_shift_dx_dy_m=[best[1], best[2]], median_after_shift=round(best[0], 1))
    json.dump([dict(cls=r["cls"], name=r["name"], ll=r["ll"]) for r in roads], open(OUT / "osm_roads.json", "w"), ensure_ascii=False)
    return res


def overlay_png():
    """Chồng ống lên tile OSM raster (z17) tại 3 khu vực để kiểm tra bằng mắt."""
    from PIL import Image
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    pipes = json.load(open(NETDIR / "pipes.geojson"))["features"]
    nodes = {f["properties"]["id"]: f for f in json.load(open(NETDIR / "nodes.geojson"))["features"]}
    picks = [("SRC", "Đầu D315 phía Bắc (nguồn giả định)"), (None, "Khu Nam: D225 dọc tuyến chính"), (None, "Khu Đông")]
    allc = np.array([c for f in pipes for c in f["geometry"]["coordinates"]])
    centers = [nodes["SRC"]["geometry"]["coordinates"],
               fwd.transform(550700, 2341480), fwd.transform(551700, 2343400)]
    z = 17; n = 2 ** z
    fig, axs = plt.subplots(1, 3, figsize=(21, 7.5), dpi=100)
    for ax, (lon0, lat0), (_, title) in zip(axs, centers, picks):
        cx, cy = lonlat2tile(lon0, lat0, z)
        img = Image.new("RGB", (256 * 3, 256 * 3))
        for i in range(3):
            for j in range(3):
                t = Image.open(io.BytesIO(fetch(f"https://tile.openstreetmap.org/{z}/{cx-1+i}/{cy-1+j}.png"))).convert("RGB")
                img.paste(t, (256 * i, 256 * j))
        def pix(lon, lat):
            x = (lon + 180) / 360 * n
            y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
            return (x - (cx - 1)) * 256, (y - (cy - 1)) * 256
        ax.imshow(img)
        for f in pipes:
            od = f["properties"]["od_mm"]
            xs, ys = zip(*[pix(*c) for c in f["geometry"]["coordinates"]])
            ax.plot(xs, ys, color="#e31a1c" if od > 63 else "#0050ff", lw=2.5 if od > 63 else 1.2, alpha=.85)
        ax.set_xlim(0, 768); ax.set_ylim(768, 0); ax.set_title(title + "\nđỏ = ống chính, xanh = ống dịch vụ; nền © OpenStreetMap", fontsize=10)
        ax.axis("off")
    plt.tight_layout(); plt.savefig(OUT / "overlay_osm.png")


if __name__ == "__main__":
    s = convert()
    rt = roundtrip()
    pts = {"SRC (đầu D315 Bắc)": (551034.36, 2344742.32), "Đầu D225 Tây": (549942.84, 2343871.49), "Đầu D225 Đông": (552486.26, 2341022.45)}
    sample = {k: [round(v, 6) for v in fwd.transform(*xy)] for k, xy in pts.items()}
    res = dict(features=s, roundtrip_max_m=rt, sample_points_lonlat=sample)
    try:
        res["osm_check"] = compare_osm()
    except Exception as ex:
        res["osm_check_error"] = repr(ex)
    try:
        overlay_png()
    except Exception as ex:
        res["overlay_error"] = repr(ex)
    (OUT / "kiem_tra_toa_do.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))
