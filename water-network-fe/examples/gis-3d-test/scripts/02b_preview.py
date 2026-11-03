"""Bước 2b: bản đồ xem trước topology + lỗi số hóa."""
import json, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
import config as C
P = json.load(open(C.INTERIM / "pipes_vn2000.geojson"))["features"]
N = json.load(open(C.INTERIM / "nodes_vn2000.geojson"))["features"]
E = json.load(open(C.INTERIM / "errors_vn2000.geojson"))["features"]
col = {315: "#08306b", 225: "#2171b5", 160: "#6a51a3", 110: "#238b45", 90: "#d94801", 63: "#e7298a", 50: "#969696"}
fig, ax = plt.subplots(figsize=(14, 16), dpi=110)
for od in sorted(col):
    first = True
    for f in P:
        if f["properties"]["od_mm"] != od: continue
        xs, ys = zip(*f["geometry"]["coordinates"])
        ax.plot(xs, ys, color=col[od], lw={315: 3.2, 225: 2.6, 160: 2.2, 110: 1.9, 90: 1.6, 63: .9, 50: .6}[od], label=f"D{od}" if first else None, zorder=od / 100)
        first = False
for f in N:
    t = f["properties"]["tags"]; x, y = f["geometry"]["coordinates"]
    if "nguon" in t: ax.scatter(x, y, s=260, marker="*", c="#00b0f0", edgecolor="k", zorder=30, label="Nguồn (giả định)")
sev = {"do": ("#e31a1c", "Lỗi đỏ"), "vang": ("#ffb000", "Lỗi vàng"), "info": ("#1f78b4", "Thông tin")}
done = set()
for f in E:
    p = f["properties"]
    if p["kind"] in ("nhan_chieu_dai",): continue
    x, y = f["geometry"]["coordinates"]; c, lab = sev[p["severity"]]
    ax.scatter(x, y, s=90, facecolor="none", edgecolor=c, lw=2, zorder=25, label=None if lab in done else lab); done.add(lab)
    if p["severity"] != "info" and p["kind"] != "nhan_khac_layer": ax.annotate(p["id"], (x, y), xytext=(4, 4), textcoords="offset points", fontsize=7, color=c, zorder=26)
ax.set_aspect("equal"); ax.legend(loc="lower left", fontsize=9); ax.grid(alpha=.2); ax.ticklabel_format(useOffset=False, style="plain")
ax.set_title(f"Bước 2 — Topology: {len(N)} nút, {len(P)} ống; vòng tròn = vị trí lỗi số hóa (xem loi_so_hoa.csv)")
plt.tight_layout(); out = C.OUT / "step2/topology_loi.png"; plt.savefig(out); print(out)
