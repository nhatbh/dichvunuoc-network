import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView.jsx";
import { SearchBox, Legend, Detail, Dashboard, IssueList, RecList } from "./Panels.jsx";
import { METRICS } from "./colors.js";

const DATA = "./data";
const LAYERS = [
  ["particles", "Hạt dòng chảy"],
  ["columns", "Cột áp lực 3D"],
  ["nodes", "Nút"],
  ["warnings", "Cảnh báo (ghim)"],
  ["errors", "Lỗi số hóa"],
  ["valves", "Van (giả định)"],
  ["sensors", "Đồng hồ DMA & logger"],
  ["loops", "Mạch vòng đề xuất"],
];

// Tham số URL (dạng #3d&metric=flow&scen=base&hour=19&play&view=lon,lat,zoom&panels=0) để mở thẳng một khung nhìn
const URLP = new URLSearchParams(window.location.hash.slice(1));
const VIEW = URLP.get("view")?.split(",").map(Number);
const PANELS = URLP.get("panels") !== "0" && window.innerWidth > 760;

export default function App() {
  const [net, setNet] = useState(null);
  const [ana, setAna] = useState(null);
  const [cache, setCache] = useState({});
  const [scenKey, setScenKey] = useState(URLP.get("scen") || "base");
  const [hour, setHour] = useState(URLP.has("hour") ? +URLP.get("hour") : 19);
  const [playing, setPlaying] = useState(URLP.has("play"));
  const [metric, setMetric] = useState(URLP.get("metric") || "pressure");
  const [show, setShow] = useState({ particles: true, columns: URLP.has("columns"), nodes: true, warnings: true, errors: false, valves: false, sensors: false, loops: false });
  const [is3D, setIs3D] = useState(URLP.has("3d"));
  const [sel, setSel] = useState(null);
  const [fly, setFly] = useState(null);
  const [tab, setTab] = useState("kpi");
  const [leftOpen, setLeftOpen] = useState(PANELS);
  const [rightOpen, setRightOpen] = useState(PANELS);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([fetch(`${DATA}/network.json`).then((r) => r.json()), fetch(`${DATA}/analysis.json`).then((r) => r.json())])
      .then(([n, a]) => {
        n.nodeIndex = Object.fromEntries(n.nodes.map((x, i) => [x.id, i]));
        n.pipeIndex = Object.fromEntries(n.pipes.map((x, i) => [x.id, i]));
        setNet(n); setAna(a);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    for (const k of new Set(["base", scenKey])) {
      if (cache[k]) continue;
      fetch(`${DATA}/scenarios/${k}.json`).then((r) => r.json()).then((d) => setCache((c) => ({ ...c, [k]: d })));
    }
  }, [scenKey]);

  // phát tự động thanh thời gian
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setHour((h) => (h + 1) % 24), 900);
    return () => clearInterval(t);
  }, [playing]);

  // tự bật lớp phù hợp với kịch bản
  useEffect(() => {
    if (scenKey === "ro_ri_an") setShow((s) => ({ ...s, sensors: true }));
    if (scenKey === "chua_chay") setHour(17);
    if (scenKey.startsWith("vo_ong")) setHour(19);
  }, [scenKey]);


  // trong lúc tải kịch bản mới vẫn giữ bản đồ (hiển thị hiện trạng) — không tạo lại map
  const base = cache.base, scen = cache[scenKey] || base, scenLoading = !cache[scenKey];

  function flyToObj(o) {
    if (!net) return;
    if (o.type === "node") { const n = net.nodes[net.nodeIndex[o.id]]; if (n) { setFly({ center: n.ll, zoom: 18, t: Date.now() }); setSel(o); } }
    else if (o.type === "pipe") {
      const p = net.pipes[net.pipeIndex[o.id]];
      if (p) {
        const xs = p.path.map((c) => c[0]), ys = p.path.map((c) => c[1]);
        setFly({ bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], t: Date.now() }); setSel(o);
      }
    } else if (o.type === "dma") {
      const ns = net.nodes.filter((n) => n.dma === o.id);
      const xs = ns.map((n) => n.ll[0]), ys = ns.map((n) => n.ll[1]);
      setMetric("dma"); setShow((s) => ({ ...s, sensors: true }));
      setFly({ bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], t: Date.now() });
    } else if (o.ll) { setFly({ center: o.ll, zoom: 17, t: Date.now() }); if (o.type === "issue" || o.type === "error") setSel(o); }
  }

  if (err) return <div className="loading">Không tải được dữ liệu: {err}. Hãy chạy <code>python scripts/07_export_web.py</code>.</div>;
  if (!net || !ana || !base) return <div className="loading">Đang tải mạng lưới…</div>;

  return (
    <div className={"app" + (rightOpen ? " right-open" : "")}>
      <MapView net={net} ana={ana} scen={scen} hour={hour} metric={metric} show={show} is3D={is3D}
        initialView={VIEW?.length === 3 ? VIEW : null} selection={sel} onSelect={(o) => { setSel(o); if (window.innerWidth <= 760) setRightOpen(false); }} flyTo={fly} />

      <div className="top-left">
        <SearchBox net={net} ana={ana} onPick={(it) => flyToObj(it.type === "place" ? { ll: it.ll } : it)} />
        <button className="toggle-left" onClick={() => setLeftOpen((v) => !v)}>{leftOpen ? "◀ Ẩn lớp" : "☰ Lớp & kịch bản"}</button>
      </div>

      {leftOpen && (
        <div className="panel left">
          <div className="brand">GIS cấp nước <b>Vĩnh Thịnh</b><small>{net.nodes.length} nút · {net.pipes.length} ống · {ana.summary.length_km} km · {ana.summary.households} hộ (giả định)</small></div>
          <label className="lbl">Kịch bản vận hành</label>
          {scenLoading && <div className="note">Đang tải kịch bản…</div>}
          <select value={scenKey} onChange={(e) => setScenKey(e.target.value)}>
            {ana.scenarios.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
          </select>
          <label className="lbl">Tô màu ống theo</label>
          <div className="metric-grid">
            {Object.entries(METRICS).map(([k, m]) => (
              <button key={k} className={metric === k ? "on" : ""} onClick={() => setMetric(k)}>{m.label.replace(/ \(.*/, "")}</button>
            ))}
          </div>
          <Legend metric={metric} />
          <label className="lbl">Lớp hiển thị</label>
          {LAYERS.map(([k, l]) => (
            <label key={k} className="chk"><input type="checkbox" checked={show[k]} onChange={() => setShow((s) => ({ ...s, [k]: !s[k] }))} /> {l}</label>
          ))}
          <p className="note">Nền: © OpenStreetMap, OpenFreeMap. Tọa độ gốc VN-2000 KTT 105°, múi 3°.</p>
        </div>
      )}

      <div className="view-btns">
        <button className={is3D ? "on" : ""} onClick={() => setIs3D((v) => !v)} title="Chuyển 2D/3D">{is3D ? "2D" : "3D"}</button>
      </div>

      {!rightOpen && <button className="toggle-right" onClick={() => setRightOpen(true)}>📊 Bảng điều khiển</button>}
      {rightOpen && (
        <div className="panel right">
          <div className="tabs">
            {[["kpi", "Chỉ số"], ["issues", `Vấn đề (${ana.issues.length})`], ["recs", "Đề xuất"]].map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
            <button className="tab-x" onClick={() => setRightOpen(false)} title="Ẩn bảng">×</button>
          </div>
          <div className="tab-body">
            {tab === "kpi" && <Dashboard ana={ana} scen={scen} baseKpi={base.kpi} scenKey={scenKey} onPickScenario={setScenKey} />}
            {tab === "issues" && <IssueList ana={ana} onPick={(i) => flyToObj(i.isError ? { type: "error", id: i.id, ll: i.lonlat } : { type: "issue", id: i.id, ll: i.lonlat })} />}
            {tab === "recs" && <RecList ana={ana} onPickItem={(r, it) => {
              if (r.kind === "mach_vong") setShow((s) => ({ ...s, loops: true }));
              if (r.kind === "dma") { setMetric("dma"); setShow((s) => ({ ...s, sensors: true })); }
              if (r.kind === "them_van") setShow((s) => ({ ...s, valves: true }));
              if (it.line) { const xs = it.line.map((c) => c[0]), ys = it.line.map((c) => c[1]); setFly({ bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], t: Date.now() }); setSel({ type: "loop", obj: it }); }
              else if (it.pipe && net.pipeIndex[it.pipe] != null) flyToObj({ type: "pipe", id: it.pipe });
              else if (it.meter_pipe && net.pipeIndex[it.meter_pipe] != null) flyToObj({ type: "pipe", id: it.meter_pipe });
              else if (it.node) flyToObj({ type: "node", id: it.node });
              else if (it.lonlat) flyToObj({ ll: it.lonlat });
            }} />}
          </div>
        </div>
      )}

      {sel && <Detail sel={sel} net={net} ana={ana} scen={scen} base={base} hour={hour} onFly={flyToObj} onClose={() => setSel(null)} />}

      <div className="timeline">
        <button onClick={() => setPlaying((p) => !p)} title="Phát / dừng">{playing ? "⏸" : "▶"}</button>
        <div className="tl-hour">{String(hour).padStart(2, "0")}:00</div>
        <input type="range" min={0} max={23} step={1} value={hour} onChange={(e) => setHour(+e.target.value)} />
        <div className="tl-ticks">{[0, 6, 12, 18, 23].map((h) => <span key={h}>{h}h</span>)}</div>
      </div>
    </div>
  );
}
