import { useMemo, useState } from "react";
import { METRICS, colorFor, cssColor } from "./colors.js";

const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: 0 }));

// ---------------------------------------------------------------- tìm kiếm
export function SearchBox({ net, ana, onPick }) {
  const [q, setQ] = useState("");
  const [geo, setGeo] = useState([]);
  const [busy, setBusy] = useState(false);
  const local = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (s.length < 2) return [];
    const out = [];
    for (const n of net.nodes) {
      if (n.id.includes(s) || (n.kt && n.kt.includes(s))) out.push({ type: "node", id: n.id, label: `Nút ${n.id}${n.kt ? " · đai " + n.kt : ""}`, ll: n.ll });
      if (out.length > 8) break;
    }
    for (const p of net.pipes) {
      if (p.id.includes(s) || (p.handle || "").toUpperCase() === s) out.push({ type: "pipe", id: p.id, label: `Ống ${p.id} · D${p.od} · ${p.len.toFixed(0)} m`, ll: p.path[0] });
      if (out.length > 14) break;
    }
    for (const i of ana.issues) if (i.id.includes(s)) out.push({ type: "issue", id: i.id, label: `${i.id} · ${i.title}`, ll: i.lonlat });
    for (const e of ana.errors) if (e.id.includes(s)) out.push({ type: "error", id: e.id, label: `${e.id} · lỗi số hóa`, ll: e.ll });
    for (const d of ana.dma) if (d.id.includes(s)) out.push({ type: "dma", id: d.id, label: `${d.id} · ${d.hh} hộ` });
    return out.slice(0, 18);
  }, [q, net, ana]);

  async function searchStreet(e) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    const xs = net.nodes.map((n) => n.ll[0]), ys = net.nodes.map((n) => n.ll[1]);
    const vb = [Math.min(...xs) - 0.02, Math.max(...ys) + 0.02, Math.max(...xs) + 0.02, Math.min(...ys) - 0.02].join(",");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=vn&viewbox=${vb}&bounded=1&q=${encodeURIComponent(q)}`);
      const js = await r.json();
      setGeo(js.map((g) => ({ type: "place", id: g.place_id, label: g.display_name.split(",").slice(0, 3).join(","), ll: [+g.lon, +g.lat] })));
    } catch { setGeo([]); }
    setBusy(false);
  }
  const items = [...local, ...geo];
  return (
    <form className="search" onSubmit={searchStreet}>
      <input value={q} onChange={(e) => { setQ(e.target.value); setGeo([]); }} placeholder="Tìm mã nút / ống / đai (KT12) / tên đường…" />
      <button type="submit" title="Tìm tên đường (OpenStreetMap)">{busy ? "…" : "🔍"}</button>
      {items.length > 0 && (
        <ul className="search-results">
          {items.map((it) => (
            <li key={it.type + it.id} onClick={() => { onPick(it); setQ(""); setGeo([]); }}>
              <span className={"tag tag-" + it.type}>{{ node: "Nút", pipe: "Ống", issue: "Cảnh báo", error: "Lỗi", dma: "DMA", place: "Địa danh" }[it.type]}</span>
              {it.label}
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 3 && local.length === 0 && geo.length === 0 && !busy && <div className="search-hint">Nhấn Enter để tìm tên đường/địa danh</div>}
    </form>
  );
}

// ---------------------------------------------------------------- chú giải
export function Legend({ metric }) {
  const m = METRICS[metric];
  if (m.categorical) {
    return (
      <div className="legend">
        <div className="legend-title">{m.label}</div>
        {Object.entries(m.cats).map(([k, c]) => (
          <div key={k} className="legend-row"><span className="sw" style={{ background: c }} />{metric === "diameter" ? "D" + k : k}</div>
        ))}
      </div>
    );
  }
  const lo = m.stops[0][0], hi = m.stops[m.stops.length - 1][0];
  const grad = Array.from({ length: 12 }, (_, k) => cssColor(colorFor(metric, lo + ((hi - lo) * k) / 11))).join(",");
  return (
    <div className="legend">
      <div className="legend-title">{m.label}</div>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${grad})` }} />
      <div className="legend-ticks">{m.stops.map(([v]) => <span key={v}>{v}</span>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- biểu đồ 24h
export function Sparkline({ series, hour, threshold, unit, height = 90 }) {
  const W = 300, H = height, pad = 22;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  let lo = Math.min(...all, threshold ?? Infinity), hi = Math.max(...all, threshold ?? -Infinity);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const X = (i) => pad + (i * (W - pad - 6)) / 24, Y = (v) => H - 14 - ((v - lo) * (H - 22)) / (hi - lo);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark">
      {threshold != null && <line x1={pad} x2={W - 6} y1={Y(threshold)} y2={Y(threshold)} className="thr" />}
      <line x1={X(hour)} x2={X(hour)} y1={4} y2={H - 14} className="now" />
      {series.map((s) => (
        <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={s.width || 2} strokeDasharray={s.dash}
          points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} />
      ))}
      <text x={2} y={12} className="ax">{fmt(hi, 1)}</text>
      <text x={2} y={H - 14} className="ax">{fmt(lo, 1)}</text>
      {[0, 6, 12, 18, 24].map((h) => <text key={h} x={X(h)} y={H - 2} className="ax" textAnchor="middle">{h}h</text>)}
      <text x={W - 6} y={12} className="ax" textAnchor="end">{unit}</text>
    </svg>
  );
}

// ---------------------------------------------------------------- bảng chi tiết
export function Detail({ sel, net, ana, scen, base, hour, onFly, onClose }) {
  if (!sel) return null;
  const th = ana.thresholds;
  let body = null, title = "";
  if (sel.type === "node") {
    const i = net.nodeIndex[sel.id], n = net.nodes[i];
    if (!n) return null;
    title = `Nút ${n.id}`;
    const lost = (scen.meta.lost_nodes || []).includes(n.id);
    body = (
      <>
        <table className="kv"><tbody>
          {n.kt && <tr><td>Đai khởi thủy</td><td>{n.kt}</td></tr>}
          <tr><td>Áp lực lúc {hour}h</td><td><b>{lost ? "mất nước" : fmt(scen.pressure[i][hour]) + " m"}</b></td></tr>
          <tr><td>Áp lực min / max (24h)</td><td>{fmt(Math.min(...scen.pressure[i]))} / {fmt(Math.max(...scen.pressure[i]))} m</td></tr>
          {scen.age && <tr><td>Tuổi nước</td><td>{fmt(scen.age[i][hour])} h</td></tr>}
          <tr><td>Cao độ mặt đất</td><td>{fmt(n.elev, 2)} m (DEM, giả định)</td></tr>
          <tr><td>Số hộ gán</td><td>{fmt(n.hh, 1)} (giả định)</td></tr>
          <tr><td>DMA đề xuất</td><td>{n.dma || "—"}</td></tr>
          <tr><td>Thẻ</td><td>{n.tags.join(", ") || "nút nối"}</td></tr>
          <tr><td>Tọa độ VN-2000</td><td>{fmt(n.x, 2)}; {fmt(n.y, 2)}</td></tr>
          <tr><td>WGS84</td><td>{n.ll[1].toFixed(6)}, {n.ll[0].toFixed(6)}</td></tr>
        </tbody></table>
        <div className="chart-title">Áp lực 24h (m)</div>
        <Sparkline hour={hour} threshold={th.p_low} unit="m"
          series={[{ name: "base", values: base.pressure[i], color: "#999", dash: "4 3" }, { name: "scen", values: scen.pressure[i], color: "#2171b5" }]} />
        <div className="note">Nét đứt xám = hiện trạng; xanh = kịch bản đang xem; đỏ = ngưỡng {th.p_low} m.</div>
      </>
    );
  } else if (sel.type === "pipe") {
    const i = net.pipeIndex[sel.id], p = net.pipes[i];
    if (!p) return null;
    title = `Ống ${p.id}`;
    const valves = ana.valves.filter((v) => v.pipe === p.id);
    body = (
      <>
        <table className="kv"><tbody>
          <tr><td>Đường kính</td><td>D{p.od} (trong {p.idmm} mm)</td></tr>
          <tr><td>Vật liệu / C</td><td>{p.mat} / {p.c} (giả định)</td></tr>
          <tr><td>Năm lắp / tuổi</td><td>{p.year} / {ana.ref_year - p.year} năm (giả định)</td></tr>
          <tr><td>Chiều dài</td><td>{fmt(p.len, 1)} m</td></tr>
          <tr><td>Từ → đến</td><td><a onClick={() => onFly({ type: "node", id: p.n0 })}>{p.n0}</a> → <a onClick={() => onFly({ type: "node", id: p.n1 })}>{p.n1}</a></td></tr>
          <tr><td>Lưu lượng lúc {hour}h</td><td><b>{fmt(scen.flow[i][hour], 2)} L/s</b></td></tr>
          <tr><td>Vận tốc lúc {hour}h</td><td><b>{fmt(Math.abs(scen.velocity[i][hour]), 2)} m/s</b></td></tr>
          <tr><td>Tổn thất giờ cao điểm</td><td>{fmt(p.hl, 2)} m/km</td></tr>
          <tr><td>Số hộ phụ thuộc (1 tuyến)</td><td>{p.cls === "chinh" ? fmt(p.crit, 0) : "—"}</td></tr>
          <tr><td>Hộ mất nước nếu vỡ</td><td>{p.cls === "chinh" ? fmt(p.burst, 0) : "—"}</td></tr>
          <tr><td>Van giả định</td><td>{valves.length ? valves.map((v) => "tại " + v.node).join(", ") : "không"}</td></tr>
          <tr><td>Nhãn bản vẽ</td><td>{p.label || "—"}</td></tr>
          <tr><td>Handle DXF</td><td>{p.handle}</td></tr>
        </tbody></table>
        <div className="chart-title">Lưu lượng 24h (L/s, dấu − = ngược chiều vẽ)</div>
        <Sparkline hour={hour} unit="L/s"
          series={[{ name: "base", values: base.flow[i], color: "#999", dash: "4 3" }, { name: "scen", values: scen.flow[i], color: "#08519c" }]} />
        <div className="chart-title">Vận tốc 24h (m/s)</div>
        <Sparkline hour={hour} threshold={th.v_high} unit="m/s" height={70}
          series={[{ name: "scen", values: scen.velocity[i].map(Math.abs), color: "#31a354" }]} />
      </>
    );
  } else if (sel.type === "issue") {
    const it = ana.issues.find((x) => x.id === sel.id);
    if (!it) return null;
    title = `${it.id} · ${it.title}`;
    body = (
      <>
        <p className={"sev sev-" + it.severity}>{it.severity === "do" ? "Mức đỏ" : "Mức vàng"} · {KIND[it.kind] || it.kind}</p>
        <p>{it.detail}</p>
        <p className="note">{METHOD[it.kind]}</p>
        <button onClick={() => onFly({ type: it.obj.startsWith("P") ? "pipe" : "node", id: it.obj })}>Xem {it.obj}</button>
      </>
    );
  } else if (sel.type === "error") {
    const e = ana.errors.find((x) => x.id === sel.id);
    if (!e) return null;
    title = `Lỗi số hóa ${e.id}`;
    body = <><p className={"sev sev-" + e.severity}>{e.kind}</p><p>{e.msg}</p></>;
  } else if (sel.type === "loop") {
    const l = sel.obj; title = "Đề xuất mạch vòng";
    body = <p>Nối {l.from_node} – {l.to_node}, D{l.od_mm}, dài khoảng {l.length_m} m. Giảm kỳ vọng hộ mất nước khi hỏng 1 ống chính ≈ {l.exp_hh_loss_reduction} hộ.</p>;
  }
  return (
    <div className="panel detail">
      <div className="panel-head"><b>{title}</b><button className="x" onClick={onClose}>×</button></div>
      {body}
    </div>
  );
}

export const KIND = {
  ap_thap: "Áp lực thấp", ap_cao: "Áp lực cao", van_toc_cao: "Vận tốc cao", nuoc_tu: "Nước tù (vận tốc thấp)",
  tuoi_nuoc: "Tuổi nước cao", ton_that_cao: "Tổn thất cột áp bất thường", ong_cut: "Ống cụt", mot_tuyen: "Chỉ một tuyến cấp",
};
const METHOD = {
  ap_thap: "Phương pháp: áp lực nút thấp nhất trong 24 h mô phỏng so với ngưỡng phục vụ.",
  ap_cao: "Phương pháp: áp lực nút cao nhất trong 24 h so với ngưỡng 60 m.",
  van_toc_cao: "Phương pháp: vận tốc lớn nhất trong 24 h so với ngưỡng 1,5 m/s.",
  nuoc_tu: "Phương pháp: các ống chính liên tục có vận tốc lớn nhất < 0,1 m/s cả ngày được gộp thành tuyến.",
  tuoi_nuoc: "Phương pháp: mô phỏng chất lượng EPANET (AGE) 72 h, lấy tuổi nước cuối kỳ tại các nút cuối nhánh.",
  ton_that_cao: "Phương pháp: độ dốc thủy lực giờ cao điểm (m/km) vượt ngưỡng theo nhóm ống; ngoài thực địa, so với áp lực đo để nghi tắc/van đóng.",
  ong_cut: "Phương pháp: nút bậc 1 trên ống chính (không phải nguồn).",
  mot_tuyen: "Phương pháp: cạnh cầu (bridge) của đồ thị mạng — bỏ ống này thì phần phía sau mất kết nối với nguồn.",
};

// ---------------------------------------------------------------- dashboard
const KPI_DEF = [
  ["pct_nodes_pressure_ok", "% nút đạt áp lực ≥ 10 m", "%", 1, true],
  ["pct_demand_served", "% nhu cầu được cấp", "%", 1, true],
  ["hh_affected", "Hộ bị ảnh hưởng", "hộ", 0, false],
  ["kwh_per_m3", "Năng lượng bơm", "kWh/m³", 3, false],
  ["nrw_pct", "Thất thoát ước tính (NRW)", "%", 1, false],
  ["water_age_mean_h", "Tuổi nước TB", "h", 1, false],
  ["p_min", "Áp lực thấp nhất", "m", 1, true],
  ["v_max", "Vận tốc lớn nhất", "m/s", 2, null],
];
export function Dashboard({ ana, scen, baseKpi, onPickScenario, scenKey }) {
  const k = scen.kpi;
  return (
    <div>
      <div className="scen-desc"><b>{scen.title}</b><br />{scen.desc}</div>
      <div className="kpis">
        {KPI_DEF.map(([key, label, unit, d, higherBetter]) => {
          const v = k[key], b = baseKpi[key];
          const diff = v != null && b != null && scenKey !== "base" ? v - b : null;
          const good = diff == null || Math.abs(diff) < 1e-9 ? "" : (higherBetter == null ? "" : (diff > 0) === higherBetter ? "up-good" : "up-bad");
          return (
            <div key={key} className="kpi">
              <div className="kpi-v">{fmt(v, d)}<small> {unit}</small></div>
              <div className="kpi-l">{label}</div>
              {diff != null && Math.abs(diff) > 1e-9 && <div className={"kpi-d " + good}>{diff > 0 ? "▲" : "▼"} {fmt(Math.abs(diff), d)} so với hiện trạng</div>}
            </div>
          );
        })}
      </div>
      {scen.key === "base" && scen.meta.peak && (
        <table className="tbl"><thead><tr><th></th><th>Cao điểm {scen.meta.peak.hour}h</th><th>Thấp điểm {scen.meta.low.hour}h</th></tr></thead>
          <tbody>
            <tr><td>Hệ số giờ</td><td>{scen.meta.peak.factor}</td><td>{scen.meta.low.factor}</td></tr>
            <tr><td>Lưu lượng bơm</td><td>{scen.meta.peak.supply_lps} L/s</td><td>{scen.meta.low.supply_lps} L/s</td></tr>
            <tr><td>Áp lực min / TV / max</td><td>{scen.meta.peak.p_min} / {scen.meta.peak.p_median} / {scen.meta.peak.p_max}</td><td>{scen.meta.low.p_min} / {scen.meta.low.p_median} / {scen.meta.low.p_max}</td></tr>
            <tr><td>Rò rỉ</td><td>{scen.meta.peak.leak_lps} L/s</td><td>{scen.meta.low.leak_lps} L/s</td></tr>
            <tr><td>Vận tốc max</td><td>{scen.meta.peak.v_max} m/s</td><td>{scen.meta.low.v_max} m/s</td></tr>
          </tbody></table>
      )}
      {scen.key === "ro_ri_an" && (
        <div className="note box">
          Rò rỉ thật tại <b>{scen.meta.true_node}</b> (ghim R), bộ phân tích ước tính <b>{scen.meta.est_node}</b> (vòng xanh), sai số <b>{scen.meta.err_m} m</b>.
          MNF tăng {scen.meta.mnf_excess_lps} L/s → {scen.meta.detected ? "PHÁT HIỆN" : "không phát hiện"}; khoanh vùng {scen.meta.dma_est} (thật: {scen.meta.dma_true}).<br />
          Đánh giá 40 lần ngẫu nhiên: phát hiện {Math.round(ana.leak_eval.detect_rate * 100)}%, đúng DMA {Math.round(ana.leak_eval.dma_hit_rate * 100)}%,
          sai số trung vị {ana.leak_eval.err_median_m} m (P75 {ana.leak_eval.err_p75_m} m), trong 250 m: {Math.round(ana.leak_eval.within_250m * 100)}%.
          <br /><i>Dữ liệu "đo" là tổng hợp từ mô hình + nhiễu, chưa phải số liệu hiện trường.</i>
        </div>
      )}
      {scen.meta.valves_to_close && (
        <div className="note box">Đóng <b>{scen.meta.valves_to_close.length} van</b> (biểu tượng ⊠ vàng) để cô lập đoạn {scen.meta.segment_length_m} m; <b>{scen.meta.hh_lost} hộ</b> mất nước (ống xám).</div>
      )}
      {scen.key === "chua_chay" && <div className="note box">Áp lực tại trụ trong lúc chữa cháy: <b>{scen.meta.p_fire_node_min} m</b>.</div>}
      <h4>So sánh kịch bản</h4>
      <div className="tbl-wrap">
        <table className="tbl cmp">
          <thead><tr><th>Kịch bản</th><th>% nút đạt</th><th>Hộ ảnh hưởng</th><th>kWh/m³</th><th>NRW %</th><th>Tuổi nước h</th></tr></thead>
          <tbody>
            {ana.scenarios.map((s) => (
              <tr key={s.key} className={s.key === scenKey ? "on" : ""} onClick={() => onPickScenario(s.key)}>
                <td>{s.title}</td><td>{fmt(s.kpi.pct_nodes_pressure_ok)}</td><td>{fmt(s.kpi.hh_affected, 0)}</td>
                <td>{fmt(s.kpi.kwh_per_m3, 3)}</td><td>{fmt(s.kpi.nrw_pct)}</td><td>{fmt(s.kpi.water_age_mean_h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Mọi số liệu dựa trên các giả định trong báo cáo (số hộ, đồ thị dùng nước, bơm, rò rỉ, van). Cần hiệu chỉnh bằng số liệu đo thực tế.</p>
    </div>
  );
}

export function IssueList({ ana, onPick }) {
  const groups = {};
  for (const i of ana.issues) (groups[i.kind] ||= []).push(i);
  return (
    <div>
      {Object.entries(groups).map(([k, arr]) => (
        <details key={k} open={arr.length <= 6}>
          <summary>{KIND[k] || k} <span className="badge">{arr.length}</span></summary>
          <ul className="list">
            {arr.map((i) => (
              <li key={i.id} onClick={() => onPick(i)}><span className={"dot dot-" + i.severity} />{i.id} · {i.title}</li>
            ))}
          </ul>
        </details>
      ))}
      <details>
        <summary>Lỗi số hóa bản vẽ <span className="badge">{ana.errors.filter((e) => e.severity !== "info").length}</span></summary>
        <ul className="list">
          {ana.errors.filter((e) => e.severity !== "info").map((e) => (
            <li key={e.id} onClick={() => onPick({ ...e, lonlat: e.ll, isError: true })}><span className={"dot dot-" + e.severity} />{e.id} · {e.msg}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function RecList({ ana, onPickItem }) {
  return (
    <ol className="recs">
      {ana.recs.map((r, k) => (
        <li key={k}>
          <div><span className={"prio prio-" + r.priority}>Ưu tiên {r.priority}</span> <b>{r.title}</b></div>
          {r.detail && <div className="rec-d">{r.detail}</div>}
          <div className="rec-w">{r.why}</div>
          {r.items?.length > 0 && r.items.length <= 20 && (
            <div className="rec-items">
              {r.items.map((it, j) => (
                <button key={j} onClick={() => onPickItem(r, it)}>{it.node || it.pipe || it.dma || it.from_node || "xem"}{it.to_node ? "–" + it.to_node : ""}</button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
