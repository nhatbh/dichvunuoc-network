"""Bước 5: dựng mô hình, hiệu chỉnh rò rỉ nền đạt NRW giả định, xuất .inp, chạy 24 h và kiểm tra:
hội tụ, cân bằng khối, khoảng áp lực."""
import json, shutil
import numpy as np
import wntr
import config as C
import model as M

OUT = C.OUT / "step5"; OUT.mkdir(parents=True, exist_ok=True)
M.INP.parent.mkdir(parents=True, exist_ok=True)


def calibrate_leak():
    """Tìm hệ số emitter/m sao cho rò rỉ ≈ LEAK_TARGET_NRW × lượng cấp (lặp điểm bất động)."""
    k = 1e-8
    for it in range(8):
        wn, meta = M.build_wn(k)
        res = M.run(wn, "calib")
        supply = res.link["flowrate"][[f"BOM{i+1}" for i in range(C.N_PUMPS)]].sum(axis=1).mean()
        leak = M.leak_flow(wn, res).mean()
        r = leak / supply
        k_new = k * (C.LEAK_TARGET_NRW / (1 - C.LEAK_TARGET_NRW)) / (leak / (supply - leak))
        print(f"  lặp {it}: K={k:.3e} m3/s/m/m → rò rỉ {leak*1000:.2f} L/s / cấp {supply*1000:.2f} L/s = {r:.3f}")
        if abs(r - C.LEAK_TARGET_NRW) < 0.002: break
        k = k_new
    return k


def main():
    k = calibrate_leak()
    wn, meta = M.build_wn(k)
    wntr.network.write_inpfile(wn, str(M.INP), units="LPS", version=2.2)
    # Mô phỏng 72 h để tuổi nước ổn định; thủy lực dùng 24 h đầu (chu kỳ lặp lại)
    res = M.run(wn, "base", quality=True, duration_h=72)
    P = res.node["pressure"]; Q = res.link["flowrate"]; V = res.link["velocity"]; A = res.node["quality"]
    J = M.junction_ids(wn)
    pumps = [f"BOM{i+1}" for i in range(C.N_PUMPS)]
    last = P.index[-25:]   # 48h..72h
    supply = Q[pumps].sum(axis=1)
    dem = res.node["demand"][J].sum(axis=1)   # gồm cả emitter
    leak = M.leak_flow(wn, res)
    # cân bằng khối: cấp vào = tiêu thụ + rò rỉ (EPANET demand đã gồm emitter)
    bal = float(np.max(np.abs(supply - res.node["demand"]["BE_CHUA"].abs())))
    bal2 = float(np.max(np.abs(supply - dem)))
    Pl = P.loc[last, J]
    rpt = (C.ROOT / "data/model/_run/base.rpt").read_text(errors="ignore")
    res_sum = dict(
        leak_coef_per_m=k, households=round(meta["households"]), persons=round(meta["persons"]),
        q_avg_consumption_lps=round(meta["q_avg_lps"], 2), q_design_per_pump_lps=round(meta["q_design_per_pump_lps"], 2),
        supply_avg_lps=round(float(supply.loc[last].mean()) * 1000, 2), supply_peak_lps=round(float(supply.loc[last].max()) * 1000, 2),
        leak_avg_lps=round(leak.loc[last].mean() * 1000, 2),
        nrw_model=round(float(leak.loc[last].mean() / supply.loc[last].mean()), 3),
        mass_balance_max_err_lps=round(max(bal, bal2) * 1000, 5),
        converged=not any(w in rpt.lower() for w in ("unbalanced", "system disconnected")),
        epanet_warnings=sorted({l.strip()[:120] for l in rpt.splitlines() if "WARNING" in l.upper()})[:10],
        pressure_min=round(float(Pl.min().min()), 2), pressure_max=round(float(Pl.max().max()), 2),
        pressure_p5_peak=round(float(np.percentile(Pl.loc[Pl.index[19]], 5)), 2),
        pressure_min_node_peak=str(Pl.loc[Pl.index[19]].idxmin()),
        velocity_max=round(float(V.loc[last].abs().max().max()), 2),
        age_mean_h=round(float(A.loc[last[-1], J].mean() / 3600), 1),
        age_max_h=round(float(A.loc[last[-1], J].max() / 3600), 1),
        pump_head_range=[round(float(res.node["head"].loc[last, "SRC"].sub(res.node["head"].loc[last, "HUT_BOM"]).min()), 1),
                         round(float(res.node["head"].loc[last, "SRC"].sub(res.node["head"].loc[last, "HUT_BOM"]).max()), 1)],
        n_junctions=len(J), n_pipes=len(wn.pipe_name_list), n_pumps=len(pumps),
    )
    (OUT / "kiem_tra_mo_hinh.json").write_text(json.dumps(res_sum, ensure_ascii=False, indent=1, default=float))
    print(json.dumps(res_sum, ensure_ascii=False, indent=1, default=float))
    # hình kiểm tra
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    h = np.arange(25)
    fig, axs = plt.subplots(1, 3, figsize=(18, 5), dpi=100)
    axs[0].step(range(24), M.PATTERN, where="post"); axs[0].set_title("Đồ thị dùng nước 24 h (hệ số giờ) [GĐ]"); axs[0].set_xlabel("Giờ")
    axs[1].plot(h, supply.loc[last].values * 1000, label="Bơm cấp vào")
    axs[1].plot(h, (dem.loc[last] - leak.loc[last]).values * 1000, label="Tiêu thụ")
    axs[1].plot(h, leak.loc[last].values * 1000, label="Rò rỉ (phụ thuộc áp)")
    axs[1].set_title("Cân bằng nước (L/s)"); axs[1].legend(); axs[1].set_xlabel("Giờ")
    q = np.percentile(Pl.values, [5, 50, 95], axis=1)
    axs[2].fill_between(h, q[0], q[2], alpha=.3, label="P5–P95 nút"); axs[2].plot(h, q[1], label="Trung vị"); axs[2].plot(h, Pl.min(axis=1).values, "r--", label="Thấp nhất")
    axs[2].axhline(C.P_LOW, color="r", lw=.8); axs[2].set_title("Áp lực nút (m)"); axs[2].legend(); axs[2].set_xlabel("Giờ")
    plt.tight_layout(); plt.savefig(OUT / "kiem_tra_mo_hinh.png")
    import pickle; pickle.dump(dict(res=res, k=k), open(C.ROOT / "data/model/_run/base.pkl", "wb"))


if __name__ == "__main__":
    main()
