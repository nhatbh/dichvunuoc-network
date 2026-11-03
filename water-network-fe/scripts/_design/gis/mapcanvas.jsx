/* Bản đồ mạng lưới GIS — bộ render bản đồ (SVG giả lập map tile + lớp mạng lưới).
   Pan (kéo), zoom (lăn/nút), chọn tài sản, lớp bật/tắt, overlay topology & truy vết. */
const { useState: mU, useRef: mR, useEffect: mE, useMemo: mMe, useCallback: mCb } = React;

function centroid(pts) { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
function roundedPoly(pts, r = 16, shrink = 0.985) {
  const [cx, cy] = centroid(pts);
  const q = pts.map(([x, y]) => [cx + (x - cx) * shrink, cy + (y - cy) * shrink]);
  const n = q.length; let d = "";
  for (let i = 0; i < n; i++) {
    const p0 = q[(i + n - 1) % n], p1 = q[i], p2 = q[(i + 1) % n];
    const v1 = [p1[0] - p0[0], p1[1] - p0[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2) || 1;
    const r1 = Math.min(r, l1 / 2), r2 = Math.min(r, l2 / 2);
    const a = [p1[0] - (v1[0] / l1) * r1, p1[1] - (v1[1] / l1) * r1];
    const b = [p1[0] + (v2[0] / l2) * r2, p1[1] + (v2[1] / l2) * r2];
    d += (i === 0 ? `M ${a[0]} ${a[1]} ` : `L ${a[0]} ${a[1]} `) + `Q ${p1[0]} ${p1[1]} ${b[0]} ${b[1]} `;
  }
  return d + "Z";
}

const MAP_PAL = {
  light: { bg: "#E7ECEF", water: "#aaccE3", waterLine: "#8DBBD6", park: "#CDE6C4", parkLine: "#B6D7AB", block: "#D9DEE3", block2: "#D0D6DC", blockLine: "rgba(30,40,55,0.05)", road: "#FFFFFF", roadMinor: "#F3F1EB", roadLine: "rgba(30,40,55,0.05)", grid: "rgba(30,40,55,0.03)" },
  dark: { bg: "#0D1117", water: "#13293f", waterLine: "#1d3a55", park: "#13241a", parkLine: "#1c3326", block: "#161b22", block2: "#1a212a", blockLine: "rgba(240,246,252,0.04)", road: "rgba(240,246,252,0.10)", roadMinor: "rgba(240,246,252,0.045)", roadLine: "rgba(240,246,252,0.05)", grid: "rgba(240,246,252,0.02)" },
};

const PAINT_MAT = { "Gang dẻo": "#0E7C86", "HDPE": "#1A7F37", "uPVC": "#0969DA", "Thép": "#8250DF", "Gang xám": "#9A6700" };
function pipeColor(p, theme, paint) {
  const t = (h) => (theme === "light" ? h : window.lighten(h));
  const mode = paint && paint.mode;
  if (mode && mode !== "status") {
    if (p.status === "abandoned") return theme === "light" ? "#C2CAD3" : "#4a5260";
    if (mode === "material") return t(PAINT_MAT[p.material] || "#7E8997");
    if (mode === "cond") return t((window.GIS.COND[p.cond] || {}).col || "#7E8997");
    if (mode === "dma") return t((window.GIS.dmas.find((d) => d.id === p.dma) || {}).col || "#7E8997");
    if (mode === "dn") { const d = p.dn; return t(d >= 500 ? "#8250DF" : d >= 300 ? "#0969DA" : d >= 200 ? "#0E7C86" : d >= 150 ? "#1A7F37" : "#9A6700"); }
    if (mode === "age") { const a = 2026 - p.year; return t(a > 30 ? "#D1242F" : a > 18 ? "#D86C1F" : a > 8 ? "#9A6700" : "#1A7F37"); }
  }
  if (p.status === "leak") return t("#D1242F");
  if (p.status === "planned") return t("#0969DA");
  if (p.status === "abandoned") return theme === "light" ? "#AEB8C4" : "#5a6573";
  return p.trunk ? t("#0E7C86") : (theme === "light" ? "#3FA0A8" : "#7fd0db");
}

// minor connector streets (chỉ trang trí) — sinh 1 lần từ blocks
function minorStreets() {
  const G = window.GIS, out = [];
  G.blocks.forEach((b, i) => { if (i % 4 === 0) out.push([[b.x - 8, b.y + b.h / 2], [b.x + b.w + 8, b.y + b.h / 2]]); });
  return out;
}

function NetworkMap({ layers, selected, onSelect, emphasis, pins, focus, theme: themeProp, onBg, controls = true, legend = true, paint, legendRows, measure, onMeasureClick }) {
  const G = window.GIS;
  const theme = themeProp || window.cTheme();
  const pal = MAP_PAL[theme];
  const svgRef = mR(null);
  const W = G.world.w, H = G.world.h;
  const fullVB = [-40, -40, W + 80, H + 80];
  const [vb, setVb] = mU(fullVB);
  const vbRef = mR(vb); vbRef.current = vb;
  const drag = mR(null);
  const minor = mMe(() => minorStreets(), []);

  // focus → set viewBox
  const focusKey = focus ? JSON.stringify(focus) : "";
  mE(() => {
    if (!focus) return;
    const pad = Math.max(focus.w, focus.h) * 0.18 + 40;
    let x = focus.x - pad, y = focus.y - pad, w = focus.w + pad * 2, h = focus.h + pad * 2;
    const ar = (fullVB[2]) / (fullVB[3]);
    if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
    setVb([x, y, w, h]);
  }, [focusKey]);

  const toWorld = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    const [x, y, w, h] = vbRef.current;
    return [x + ((clientX - r.left) / r.width) * w, y + ((clientY - r.top) / r.height) * h];
  };
  const onWheel = (e) => {
    e.preventDefault();
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const [x, y, w, h] = vbRef.current;
    const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    let nw = w * f, nh = h * f;
    nw = Math.max(180, Math.min(W * 1.6, nw)); nh = nw * (h / w);
    const nx = wx - ((wx - x) / w) * nw, ny = wy - ((wy - y) / h) * nh;
    setVb([nx, ny, nw, nh]);
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vb: vbRef.current, moved: false };
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const [x, y, w, h] = drag.current.vb;
    const dx = (e.clientX - drag.current.sx) / r.width * w, dy = (e.clientY - drag.current.sy) / r.height * h;
    if (Math.abs(e.clientX - drag.current.sx) + Math.abs(e.clientY - drag.current.sy) > 3) drag.current.moved = true;
    setVb([x - dx, y - dy, w, h]);
  };
  const onUp = (e) => {
    const wasMove = drag.current && drag.current.moved; drag.current = null;
    if (wasMove) return;
    if (onMeasureClick) { const [wx, wy] = toWorld(e.clientX, e.clientY); onMeasureClick([Math.round(wx), Math.round(wy)]); return; }
    if (onBg) onBg();
  };
  const zoomBtn = (f) => { const [x, y, w, h] = vbRef.current; const cx = x + w / 2, cy = y + h / 2; let nw = Math.max(180, Math.min(W * 1.6, w * f)); const nh = nw * (h / w); setVb([cx - nw / 2, cy - nh / 2, nw, nh]); };

  const L = layers || {};
  const emp = emphasis || {};
  const dimAll = !!emp.dim;
  const empSet = emp.pipes instanceof Set ? emp.pipes : new Set(emp.pipes || []);
  const selId = selected ? selected.id : null;
  const scalePx = vb[2] / W; // 1 = full

  // tỉ lệ thước (m) ~ dùng vb width
  const metersAcross = Math.round(vb[2] * 1.15);
  const scaleM = metersAcross > 4000 ? 1000 : metersAcross > 1500 ? 500 : metersAcross > 700 ? 200 : 100;
  const scaleUnits = scaleM / 1.15;
  const scaleFrac = scaleUnits / vb[2];

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: pal.bg }}>
      <svg ref={svgRef} viewBox={vb.join(" ")} className="h-full w-full" preserveAspectRatio="xMidYMid slice"
        style={{ cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
        onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => (drag.current = null)}>
        <defs>
          <pattern id="gispar" width="46" height="46" patternUnits="userSpaceOnUse"><path d="M46 0H0V46" fill="none" stroke={pal.grid} strokeWidth="1"></path></pattern>
          <filter id="pinsh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="rgba(0,0,0,0.35)"></feDropShadow></filter>
        </defs>
        <rect x={-200} y={-200} width={W + 400} height={H + 400} fill={pal.bg}></rect>
        <rect x={-200} y={-200} width={W + 400} height={H + 400} fill="url(#gispar)"></rect>

        {/* nước */}
        <path d={`${G.lake.reduce((s, p, i) => s + (i ? "L" : "M") + p[0] + " " + p[1] + " ", "")}Z`} fill={pal.water} stroke={pal.waterLine} strokeWidth="2"></path>
        <path d={G.river} fill="none" stroke={pal.water} strokeWidth="46" strokeLinecap="round"></path>
        <path d={G.river} fill="none" stroke={pal.waterLine} strokeWidth="48" strokeLinecap="round" opacity="0.4" style={{ mixBlendMode: theme === "light" ? "multiply" : "screen" }}></path>

        {/* công viên */}
        {G.parks.map((p) => <path key={p.id} d={roundedPoly(p.poly, 18)} fill={pal.park} stroke={pal.parkLine} strokeWidth="1.5"></path>)}

        {/* khối nhà */}
        {G.blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="2.5" fill={b.t > 0.6 ? pal.block2 : pal.block} stroke={pal.blockLine} strokeWidth="1"></rect>)}

        {/* đường phụ */}
        {minor.map((s, i) => <line key={i} x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]} stroke={pal.roadMinor} strokeWidth="5" strokeLinecap="round"></line>)}
        {/* casing đường (theo tuyến ống) */}
        {G.pipes.filter((p) => p.status !== "abandoned").map((p) => <line key={p.id} x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={pal.road} strokeWidth={p.trunk ? 12 : 7} strokeLinecap="round"></line>)}

        {/* DMA */}
        {L.dma && G.dmas.map((d) => {
          const sel = selected && selected.type === "dma" && selId === d.id;
          const col = window.tone(d.col);
          return <path key={d.id} d={roundedPoly(d.poly, 22, 0.97)} onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "dma", id: d.id }); }}
            fill={window.chex(d.col, theme === "light" ? 0.07 : 0.1)} stroke={col} strokeWidth={sel ? 2.6 : 1.4} strokeDasharray="7 5" className="cursor-pointer" style={{ opacity: dimAll ? 0.4 : 1 }}></path>;
        })}

        {/* tuyến ống */}
        {L.pipe && G.pipes.map((p) => {
          const col = pipeColor(p, theme, paint);
          const emphasized = empSet.has(p.id);
          const dimmed = dimAll && !emphasized;
          const sel = selected && selected.type === "pipe" && selId === p.id;
          const wBase = p.dn >= 500 ? 6 : p.dn >= 300 ? 4.6 : p.dn >= 200 ? 3 : 2.2;
          const dash = p.status === "planned" ? "8 5" : p.status === "abandoned" ? "3 6" : undefined;
          return (
            <g key={p.id} style={{ opacity: dimmed ? 0.16 : 1 }}>
              {(sel || emphasized) ? <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={window.cAccent()} strokeWidth={wBase + 5} strokeLinecap="round" opacity="0.34"></line> : null}
              <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={col} strokeWidth={wBase} strokeLinecap="round" strokeDasharray={dash}
                onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "pipe", id: p.id }); }} className="cursor-pointer"></line>
              {p.status === "leak" ? <circle cx={(p.pts[0][0] + p.pts[1][0]) / 2} cy={(p.pts[0][1] + p.pts[1][1]) / 2} r="6" fill="none" stroke={window.lighten("#D1242F")} strokeWidth="1.5" className="gis-pulse"></circle> : null}
            </g>
          );
        })}

        {/* nhãn ống */}
        {L.label && scalePx < 0.55 && G.pipes.filter((p) => p.trunk).map((p) => {
          const m = G.midOf(p); const ang = Math.atan2(p.pts[1][1] - p.pts[0][1], p.pts[1][0] - p.pts[0][0]) * 180 / Math.PI;
          const a = Math.abs(ang) > 90 ? ang + 180 : ang;
          return <text key={p.id} x={m[0]} y={m[1] - 5} fontSize="8.5" textAnchor="middle" fill={theme === "light" ? "#0E7C86" : "#7fd0db"} transform={`rotate(${a} ${m[0]} ${m[1] - 5})`} className="font-mono pointer-events-none">DN{p.dn}</text>;
        })}

        {/* đấu nối khách hàng */}
        {L.conn && scalePx < 0.85 && G.connDots.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={scalePx < 0.4 ? 2.4 : 1.7} fill={theme === "light" ? "#9A6700" : "#E3B341"} opacity={dimAll ? 0.25 : 0.62}></circle>)}

        {/* nút */}
        {L.node && scalePx < 0.6 && G.nodes.map((n) => {
          const sel = selected && selected.type === "node" && selId === n.id;
          return <circle key={n.id} cx={n.x} cy={n.y} r={sel ? 4.5 : 2.6} fill={theme === "light" ? "#fff" : "#0D1117"} stroke={sel ? window.cAccent() : window.tone("#8250DF")} strokeWidth={sel ? 2 : 1.4} className="cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "node", id: n.id }); }}></circle>;
        })}

        {/* van */}
        {L.valve && G.valves.map((v) => {
          const closed = (emp.valvesClosed && emp.valvesClosed.has(v.id)) || (!emp.valvesClosed && v.state === "closed");
          const opened = emp.valvesOpen && emp.valvesOpen.has(v.id);
          const sel = selected && selected.type === "valve" && selId === v.id;
          const col = closed ? window.tone("#D1242F") : v.kind === "boundary" ? window.tone("#0969DA") : window.tone("#0E7C86");
          const sz = sel ? 6 : v.kind === "boundary" ? 4.6 : 3.8;
          const dimmed = dimAll && !sel && !closed && !opened;
          return (
            <g key={v.id} style={{ opacity: dimmed ? 0.2 : 1 }} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "valve", id: v.id }); }}>
              {(sel || opened) ? <circle cx={v.x} cy={v.y} r={sz + 4} fill="none" stroke={window.cAccent()} strokeWidth="2" opacity="0.6"></circle> : null}
              <rect x={v.x - sz} y={v.y - sz} width={sz * 2} height={sz * 2} rx="1" transform={`rotate(45 ${v.x} ${v.y})`} fill={theme === "light" ? "#fff" : "#0D1117"} stroke={col} strokeWidth="1.6"></rect>
              {closed ? <rect x={v.x - sz + 1.4} y={v.y - sz + 1.4} width={(sz - 1.4) * 2} height={(sz - 1.4) * 2} transform={`rotate(45 ${v.x} ${v.y})`} fill={col}></rect> : null}
            </g>
          );
        })}

        {/* trụ cứu hoả */}
        {L.hydrant && G.hydrants.map((h) => {
          const sel = selected && selected.type === "hydrant" && selId === h.id;
          const col = h.status === "fault" ? window.tone("#D86C1F") : window.tone("#D1242F");
          return <g key={h.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "hydrant", id: h.id }); }} style={{ opacity: dimAll && !sel ? 0.3 : 1 }}>
            {sel ? <circle cx={h.x} cy={h.y} r="8" fill="none" stroke={window.cAccent()} strokeWidth="2"></circle> : null}
            <circle cx={h.x} cy={h.y} r="3.4" fill={col} stroke="#fff" strokeWidth="1.1"></circle>
          </g>;
        })}

        {/* nguồn */}
        {L.source && (
          <g>
            <g key="plant" transform={`translate(${G.plant.x},${G.plant.y})`}>
              <rect x="-11" y="-11" width="22" height="22" rx="3" fill={theme === "light" ? "#fff" : "#10243a"} stroke={window.tone("#0E7C86")} strokeWidth="2"></rect>
              <path d="M0 -5 C3 -1 5 1 5 3 a5 5 0 0 1 -10 0 c0 -2 2 -4 5 -8z" fill={window.tone("#0E7C86")} transform="translate(0,1)"></path>
            </g>
            {G.reservoirs.map((r) => { const sel = selected && selected.type === "reservoir" && selId === r.id; return (
              <g key={r.id} transform={`translate(${r.x},${r.y})`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "reservoir", id: r.id }); }}>
                {sel ? <rect x="-14" y="-13" width="28" height="26" rx="4" fill="none" stroke={window.cAccent()} strokeWidth="2"></rect> : null}
                <rect x="-10" y="-9" width="20" height="18" rx="2.5" fill={theme === "light" ? "#fff" : "#131a24"} stroke={window.tone("#1A7F37")} strokeWidth="1.8"></rect>
                <rect x="-8" y={7 - 14 * (r.level / 100)} width="16" height={14 * (r.level / 100)} rx="1" fill={window.tone("#1A7F37")} opacity="0.5"></rect>
              </g>
            ); })}
            {G.pumps.map((s) => { const sel = selected && selected.type === "pump" && selId === s.id; return (
              <g key={s.id} transform={`translate(${s.x},${s.y})`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelect && onSelect({ type: "pump", id: s.id }); }}>
                {sel ? <circle r="13" fill="none" stroke={window.cAccent()} strokeWidth="2"></circle> : null}
                <circle r="9" fill={theme === "light" ? "#fff" : "#10243a"} stroke={window.tone("#D86C1F")} strokeWidth="1.8"></circle>
                <text y="3.4" textAnchor="middle" fontSize="10" fontWeight="700" fill={window.tone("#D86C1F")} className="font-mono pointer-events-none">P</text>
              </g>
            ); })}
          </g>
        )}

        {/* pins overlay (topology / target) */}
        {(pins || []).map((pin, i) => (          <g key={pin.id || i} transform={`translate(${pin.x},${pin.y})`} className={pin.onClick ? "cursor-pointer" : ""} onClick={(e) => { if (pin.onClick) { e.stopPropagation(); pin.onClick(); } }}>
            {pin.pulse ? <circle r="12" fill="none" stroke={pin.col} strokeWidth="1.6" className="gis-pulse"></circle> : null}
            {pin.shape === "diamond"
              ? <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill={pin.col} stroke="#fff" strokeWidth="1.4" filter="url(#pinsh)"></rect>
              : <g filter="url(#pinsh)"><path d="M0 -11 C5 -11 8 -7 8 -3 C8 2 0 9 0 9 C0 9 -8 2 -8 -3 C-8 -7 -5 -11 0 -11z" fill={pin.col} stroke="#fff" strokeWidth="1.3"></path><circle cy="-3" r="2.6" fill="#fff"></circle></g>}
            {pin.sel ? <circle r="16" fill="none" stroke={window.cAccent()} strokeWidth="2"></circle> : null}
          </g>
        ))}

        {/* overlay đo khoảng cách */}
        {measure && measure.length ? (() => {
          const pxw = vb[2] / (svgRef.current ? svgRef.current.clientWidth : 1000);
          const ac = window.cAccent(); let cum = 0;
          return (
            <g className="pointer-events-none">
              {measure.length > 1 ? <polyline points={measure.map((p) => p[0] + "," + p[1]).join(" ")} fill="none" stroke={ac} strokeWidth={2.2 * pxw} strokeDasharray={`${6 * pxw} ${4 * pxw}`} strokeLinejoin="round" strokeLinecap="round"></polyline> : null}
              {measure.map((p, i) => {
                let seg = null;
                if (i > 0) { const a = measure[i - 1]; const d = Math.hypot(p[0] - a[0], p[1] - a[1]) * 1.15; cum += d; const mx = (p[0] + a[0]) / 2, my = (p[1] + a[1]) / 2;
                  seg = <text x={mx} y={my - 5 * pxw} fontSize={10 * pxw} textAnchor="middle" fill={ac} className="font-mono" style={{ paintOrder: "stroke" }} stroke={theme === "light" ? "#fff" : "#0D1117"} strokeWidth={3.5 * pxw}>{window.fmtKm(d)}</text>; }
                return <g key={i}>{seg}<circle cx={p[0]} cy={p[1]} r={3.6 * pxw} fill={theme === "light" ? "#fff" : "#0D1117"} stroke={ac} strokeWidth={1.9 * pxw}></circle></g>;
              })}
            </g>
          );
        })() : null}
      </svg>

      {/* zoom controls */}
      {controls ? (
        <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-line bg-[var(--surface)]" style={{ boxShadow: "var(--card-shadow)" }}>
          <button onClick={() => zoomBtn(1 / 1.4)} title="Phóng to" className="flex h-8 w-8 items-center justify-center text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">{React.createElement(window.IcPlus, { size: 16 })}</button>
          <button onClick={() => zoomBtn(1.4)} title="Thu nhỏ" className="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">{React.createElement(window.IcMinus, { size: 16 })}</button>
          <button onClick={() => setVb(fullVB)} title="Toàn mạng" className="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">{React.createElement(window.IcExpand, { size: 15 })}</button>
        </div>
      ) : null}

      {/* thước tỉ lệ */}
      {controls ? (
        <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-0.5">
          <div className="h-1.5 rounded-sm" style={{ width: Math.max(28, Math.min(160, scaleFrac * (svgRef.current ? svgRef.current.clientWidth : 600))), background: theme === "light" ? "#1B2733" : "#c6cfd9" }}></div>
          <span className="font-mono text-[10px]" style={{ color: theme === "light" ? "#566270" : "#8B949E" }}>{scaleM >= 1000 ? scaleM / 1000 + " km" : scaleM + " m"}</span>
        </div>
      ) : null}

      {legend ? (
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-line bg-[var(--surface)]/90 px-3 py-1.5 text-[10.5px] text-[color:var(--muted)] backdrop-blur" style={{ maxWidth: 440 }}>
          {legendRows && legendRows.length ? legendRows.map((r) => (
            <span key={r.label} className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 rounded" style={{ background: window.tone(r.col) }}></span>{r.label}</span>
          )) : (<>
            <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 rounded" style={{ background: window.tone("#0E7C86") }}></span>Ống chính</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 rounded" style={{ background: theme === "light" ? "#3FA0A8" : "#7fd0db" }}></span>Ống phân phối</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 border" style={{ borderColor: window.tone("#0969DA") }}></span>Van</span>
            <span className="flex items-center gap-1.5"><StatusDot color={window.tone("#D1242F")} size={8}></StatusDot>Rò rỉ / cảnh báo</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-sm border border-dashed" style={{ borderColor: window.tone("#9A6700") }}></span>Ranh DMA</span>
          </>)}
        </div>
      ) : null}
    </div>
  );
}
function plantNode() { return window.GIS.plant; }

Object.assign(window, { NetworkMap, gisRoundedPoly: roundedPoly, gisCentroid: centroid });
