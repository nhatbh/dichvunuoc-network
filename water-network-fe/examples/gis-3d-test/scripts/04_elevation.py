"""Bước 4: cao độ nút từ DEM Copernicus GLO-30 (bản vẽ không có Z).

Copernicus GLO-30 là DSM (bề mặt, gồm nhà và cây; độ cao EGM2008). Khu dân cư nông thôn ĐBSH có nhà và cây
cao 5–10 m, nên lấy cao độ "mặt đất ước tính" bằng phân vị 10% của các pixel trong bán kính 45 m quanh nút
[GĐ], bỏ pixel mặt nước sông. Chênh lệch EGM2008 so với hệ độ cao Hòn Dấu khoảng ±1 m; không ảnh hưởng áp lực tương đối giữa các nút.
"""
import json
import numpy as np
import rasterio
from pyproj import Transformer
import config as C

DEM = C.ROOT / "data/dem/cop30_N21_E105.tif"
RADIUS_M = 45.0
PCT = 10
WATER_BELOW = 11.0   # [GĐ] pixel < 11 m là mặt nước sông Hồng (DSM sông 6–9 m, ruộng ≥ 12 m) — loại khỏi phân vị


def main():
    nodes = json.load(open(C.ROOT / "data/network/nodes.geojson"))
    with rasterio.open(DEM) as ds:
        lon = np.array([f["geometry"]["coordinates"][0] for f in nodes["features"]])
        lat = np.array([f["geometry"]["coordinates"][1] for f in nodes["features"]])
        pad = 0.002
        win = rasterio.windows.from_bounds(lon.min() - pad, lat.min() - pad, lon.max() + pad, lat.max() + pad, ds.transform)
        win = win.round_offsets().round_lengths()
        arr = ds.read(1, window=win).astype(float)
        T = ds.window_transform(win)
    rows, cols = np.indices(arr.shape)
    plon, plat = T * (cols + 0.5, rows + 0.5)
    to_m = Transformer.from_crs("EPSG:4326", C.VN2000_PROJ, always_xy=True)
    px, py = to_m.transform(plon.ravel(), plat.ravel())
    nx_, ny_ = to_m.transform(lon, lat)
    from scipy.spatial import cKDTree
    from scipy.interpolate import RegularGridInterpolator
    tree = cKDTree(np.c_[px, py])
    vals = arr.ravel()
    raw_interp = RegularGridInterpolator((np.arange(arr.shape[0]), np.arange(arr.shape[1])), arr)
    inv = ~T
    out_raw, out_ground = [], []
    for f, x, y, lo, la in zip(nodes["features"], nx_, ny_, lon, lat):
        c, r = inv * (lo, la)
        raw = float(raw_interp((min(max(r - .5, 0), arr.shape[0] - 1), min(max(c - .5, 0), arr.shape[1] - 1))))
        idx = tree.query_ball_point((x, y), RADIUS_M)
        v = vals[idx]; v = v[v >= WATER_BELOW]
        g = float(np.percentile(v, PCT)) if len(v) else raw
        f["properties"]["elev_dsm"] = round(raw, 2)
        f["properties"]["elev"] = round(g, 2)
        out_raw.append(raw); out_ground.append(g)
    nodes_path = C.ROOT / "data/network/nodes.geojson"
    nodes_path.write_text(json.dumps(nodes, ensure_ascii=False))
    e = np.array(out_ground); r = np.array(out_raw)
    res = dict(n=len(e), elev_ground_min=round(e.min(), 2), elev_ground_max=round(e.max(), 2), elev_ground_mean=round(e.mean(), 2),
               elev_ground_p5_p95=[round(np.percentile(e, 5), 2), round(np.percentile(e, 95), 2)],
               dsm_minus_ground_median=round(float(np.median(r - e)), 2),
               src_elev=[f["properties"]["elev"] for f in nodes["features"] if f["properties"]["id"] == "SRC"][0])
    out = C.OUT / "step4"; out.mkdir(parents=True, exist_ok=True)
    (out / "cao_do.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))

    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    pipes = json.load(open(C.ROOT / "data/network/pipes.geojson"))["features"]
    fig, axs = plt.subplots(1, 2, figsize=(16, 9), dpi=100, gridspec_kw=dict(width_ratios=[1.4, 1]))
    ax = axs[0]
    ext = (T.c, T.c + T.a * arr.shape[1], T.f + T.e * arr.shape[0], T.f)
    im = ax.imshow(arr, extent=ext, cmap="terrain", vmin=np.percentile(arr, 2), vmax=np.percentile(arr, 98))
    for p in pipes:
        xs, ys = zip(*p["geometry"]["coordinates"]); ax.plot(xs, ys, "k-", lw=.4)
    sc = ax.scatter(lon, lat, c=e, s=6, cmap="viridis", zorder=5)
    plt.colorbar(im, ax=ax, label="DSM Copernicus (m)", shrink=.6); plt.colorbar(sc, ax=ax, label="Cao độ mặt đất ước tính tại nút (m)", shrink=.6)
    ax.set_title("DEM Copernicus GLO-30 + cao độ nút (P10 bán kính 45 m)"); ax.set_aspect(1 / np.cos(np.radians(lat.mean())))
    axs[1].hist(e, bins=30, alpha=.7, label="mặt đất ước tính (dùng cho mô hình)"); axs[1].hist(r, bins=30, alpha=.5, label="DSM nội suy song tuyến")
    axs[1].set_xlabel("Cao độ (m, EGM2008)"); axs[1].set_ylabel("Số nút"); axs[1].legend(); axs[1].set_title("Phân bố cao độ nút")
    plt.tight_layout(); plt.savefig(out / "cao_do.png")


if __name__ == "__main__":
    main()
