/* GIS — Bản đồ mạng lưới + Quản lý lớp. Full-bleed map · panel lớp trái · inspector phải. */
const { useState: pmU, useMemo: pmM, useEffect: pmE } = React;

const assetIndex = () => { const m = {}; window.GIS.assets.forEach((a) => (m[a.id] = a)); return m; };

const SYMB = [
  { id: "status", label: "Trạng thái" }, { id: "material", label: "Vật liệu" }, { id: "cond", label: "Tình trạng" },
  { id: "dn", label: "Đường kính" }, { id: "age", label: "Tuổi ống" }, { id: "dma", label: "Phân vùng DMA" },
];
function symbLegend(mode) {
  const G = window.GIS;
  if (mode === "material") return G.MATERIALS.map((m) => ({ label: m, col: ({ "Gang dẻo": "#0E7C86", "HDPE": "#1A7F37", "uPVC": "#0969DA", "Thép": "#8250DF", "Gang xám": "#9A6700" })[m] }));
  if (mode === "cond") return Object.values(G.COND).map((c) => ({ label: c.label, col: c.col }));
  if (mode === "dma") return G.dmas.map((d) => ({ label: d.id, col: d.col }));
  if (mode === "dn") return [{ label: "DN ≥ 500", col: "#8250DF" }, { label: "DN 300–400", col: "#0969DA" }, { label: "DN 200–250", col: "#0E7C86" }, { label: "DN 150", col: "#1A7F37" }, { label: "DN ≤ 110", col: "#9A6700" }];
  if (mode === "age") return [{ label: "> 30 năm", col: "#D1242F" }, { label: "18–30 năm", col: "#D86C1F" }, { label: "8–18 năm", col: "#9A6700" }, { label: "< 8 năm", col: "#1A7F37" }];
  return null;
}

function AtlasModal({ open, onClose, toast }) {
  const G = window.GIS;
  const [sel, setSel] = pmU(() => Object.fromEntries(G.dmas.map((d) => [d.id, true])));
  const [paper, setPaper] = pmU("A3");
  const [scale, setScale] = pmU("1000");
  const n = Object.values(sel).filter(Boolean).length;
  return (
    <Modal open={open} onClose={onClose} title="Xuất tập bản đồ" subtitle="Map book theo DMA cho đội hiện trường" icon="IcFile" wide
      footer={<><Btn variant="ghost" onClick={onClose}>Huỷ</Btn><Btn variant="primary" icon="IcDownload" disabled={n === 0} onClick={() => { toast("Đang tạo tập bản đồ " + paper + " · " + n + " trang DMA (PDF)", "success"); onClose(); }}>Tạo PDF ({n} trang)</Btn></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Khổ giấy"><Select value={paper} onChange={setPaper} options={[{ value: "A3", label: "A3 ngang" }, { value: "A2", label: "A2 ngang" }, { value: "A1", label: "A1 ngang" }]}></Select></Field>
        <Field label="Tỉ lệ"><Select value={scale} onChange={setScale} options={[{ value: "500", label: "1 : 500" }, { value: "1000", label: "1 : 1.000" }, { value: "2000", label: "1 : 2.000" }]}></Select></Field>
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-[color:var(--text2)]"><span>Trang theo DMA</span><button onClick={() => setSel(Object.fromEntries(G.dmas.map((d) => [d.id, n !== G.dmas.length])))} className="text-[11px] text-[color:var(--muted)] hover:text-[color:var(--text)]">{n === G.dmas.length ? "Bỏ chọn" : "Chọn tất"}</button></div>
        <div className="flex flex-col gap-1 rounded-lg border border-line p-2">
          {G.dmas.map((d) => (
            <button key={d.id} onClick={() => setSel((s) => ({ ...s, [d.id]: !s[d.id] }))} className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--surface2)]">
              <Check on={sel[d.id]} onChange={() => setSel((s) => ({ ...s, [d.id]: !s[d.id] }))}></Check>
              <DmaChip dma={d.id} sm></DmaChip>
              <span className="flex-1 truncate text-[12px] text-[color:var(--text2)]">{d.name}</span>
              <span className="font-mono text-[10.5px] text-[color:var(--muted2)]">{window.fmtInt(G.pipes.filter((p) => p.dma === d.id).length)} ống</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function LayerPanel({ vis, setVis, onClose }) {
  const G = window.GIS;
  const groups = {};
  G.LAYERS.forEach((l) => { (groups[l.grp] = groups[l.grp] || []).push(l); });
  return (
    <div className="flex w-[230px] shrink-0 flex-col overflow-hidden border-r border-line bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[color:var(--text)]">{React.createElement(window.IcLayers, { size: 15 })}Lớp bản đồ</span>
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)] md:hidden">{React.createElement(window.IcX, { size: 14 })}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        {Object.entries(groups).map(([grp, items]) => (
          <div key={grp} className="mb-1.5">
            <div className="px-1.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{grp}</div>
            {items.map((l) => {
              const on = vis[l.id];
              return (
                <div key={l.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[var(--surface2)]">
                  <button onClick={() => !l.lock && setVis({ ...vis, [l.id]: !on })} disabled={l.lock} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ color: on ? window.cAccent() : "var(--muted2)", opacity: l.lock ? 0.6 : 1 }}>
                    {React.createElement(window[l.lock ? "IcLockClosed" : on ? "IcEye" : "IcEyeOff"], { size: 15 })}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium" style={{ color: on ? "var(--text)" : "var(--muted)" }}>{l.label}</div>
                    {typeof l.count === "number" ? <div className="text-[10px] text-[color:var(--muted2)] font-mono">{window.fmtInt(l.count)} đối tượng</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2.5">
        <div className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-[10.5px] text-[color:var(--muted)]">
          <div className="flex items-center justify-between"><span>Hệ toạ độ</span><span className="font-mono text-[color:var(--text2)]">{G.SRID}</span></div>
          <div className="mt-1 flex items-center justify-between"><span>Phép chiếu FE</span><span className="font-mono text-[color:var(--text2)]">WGS84</span></div>
        </div>
      </div>
    </div>
  );
}

function AssetInspector({ sel, onClose, go, toast }) {
  const G = window.GIS;
  if (!sel) return null;
  let title, code, typeChip, attrs = [], dma, condEl, actions = null, geomBadge, linkAsset = null;
  if (sel.type === "node") {
    const n = G.nodes.find((x) => x.id === sel.id);
    if (!n) return null;
    title = "Nút lưới " + n.code; code = n.id; geomBadge = "Điểm";
    attrs = [["Loại", "Giao lộ / phụ kiện"], ["Cao độ", window.fmtDec(n.z, 1) + " m"], ["Toạ độ X", Math.round(n.x)], ["Toạ độ Y", Math.round(n.y)]];
    dma = window.GIS.dmas.find((d) => true) && null;
    linkAsset = { type: "node", id: n.id, code: n.code };
  } else {
    const a = assetIndex()[sel.id];
    if (!a) return null;
    const t = G.ASSET_TYPES[a.type];
    title = a.name; code = a.code; dma = a.dma; geomBadge = { line: "Đường", point: "Điểm", polygon: "Vùng" }[a.geom];
    typeChip = a.type; condEl = a.cond;
    attrs = Object.entries(a.attrs);
    linkAsset = a;
  }
  return (
    <div className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-line bg-[var(--surface)]">
      <div className="flex items-start gap-2.5 border-b border-line px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            {typeChip ? <AssetTypeChip type={typeChip} sm></AssetTypeChip> : <Badge color={window.tone("#8250DF")} soft>{geomBadge}</Badge>}
            {condEl ? <CondPill cond={condEl} sm></CondPill> : null}
          </div>
          <h3 className="text-[14px] font-semibold leading-tight text-[color:var(--text)]">{title}</h3>
          <div className="mt-0.5 font-mono text-[11px] text-[color:var(--muted)]">{code}</div>
        </div>
        <button onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">{React.createElement(window.IcX, { size: 15 })}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3 flex flex-col">
          {attrs.map(([k, v]) => <KV key={k} label={k} mono>{v}</KV>)}
          {dma ? <KV label="Thuộc DMA"><DmaChip dma={dma}></DmaChip></KV> : null}
          <KV label="Geometry"><span className="inline-flex items-center gap-1.5">{geomBadge} · {G.SRID}</span></KV>
        </div>
        <ServiceLinks asset={linkAsset} toast={toast}></ServiceLinks>
        <div className="mb-3 rounded-lg border border-line bg-[var(--surface2)] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Lịch sử phiên bản</div>
          {[["v4 · hiện tại", "10:15 hôm nay", "Lê Biên Tập"], ["v3", "21/06/2026", "Phạm Khảo Sát"], ["v2", "04/2025", "Import RTK"]].map((h, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i === 0 ? window.cAccent() : "var(--faint)" }}></span>
              <span className="flex-1 text-[11.5px] text-[color:var(--text2)]">{h[0]}</span>
              <span className="text-[10px] text-[color:var(--muted2)]">{h[1]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <Btn size="sm" icon="IcPencil" onClick={() => go({ name: "editor" })}>Sửa</Btn>
        <Btn size="sm" icon="IcRoute" onClick={() => go({ name: "trace" })}>Truy vết</Btn>
      </div>
    </div>
  );
}

function MapScreen({ toast, go, focusAsset, openQuery }) {
  const G = window.GIS;
  const [vis, setVis] = pmU(Object.fromEntries(G.LAYERS.map((l) => [l.id, l.on])));
  const [sel, setSel] = pmU(null);
  const [focus, setFocus] = pmU(null);
  const [showLayers, setShowLayers] = pmU(true);
  const [query, setQuery] = pmU(!!openQuery);
  const [emphasis, setEmphasis] = pmU(null);
  const [paint, setPaint] = pmU("status");
  const [symbOpen, setSymbOpen] = pmU(false);
  const [measuring, setMeasuring] = pmU(false);
  const [mpts, setMpts] = pmU([]);
  const [atlas, setAtlas] = pmU(false);
  const [q, setQ] = pmU("");

  const measTotal = pmM(() => { let s = 0; for (let i = 1; i < mpts.length; i++) s += Math.hypot(mpts[i][0] - mpts[i - 1][0], mpts[i][1] - mpts[i - 1][1]) * 1.15; return s; }, [mpts]);

  const results = pmM(() => {
    if (!q.trim()) return [];
    const k = window.cnorm(q);
    return G.assets.filter((a) => window.cnorm(a.code).includes(k) || window.cnorm(a.name).includes(k)).slice(0, 7);
  }, [q]);

  const goToAsset = (a) => {
    const g = a.geomRef;
    let box;
    if (a.geom === "point") box = { x: g.x - 60, y: g.y - 60, w: 120, h: 120 };
    else if (a.geom === "line") { const xs = g.pts.map((p) => p[0]), ys = g.pts.map((p) => p[1]); box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]) + 40, h: Math.abs(ys[1] - ys[0]) + 40 }; }
    else { const xs = g.poly.map((p) => p[0]), ys = g.poly.map((p) => p[1]); box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
    setSel({ type: a.type, id: a.id }); setFocus({ ...box, _k: Math.random() }); setQ("");
    if (!vis[a.type] && vis.hasOwnProperty(a.type)) setVis((v) => ({ ...v, [a.type]: true }));
  };

  // focus từ command palette / route
  pmE(() => {
    if (!focusAsset) return;
    const a = assetIndex()[focusAsset.id];
    if (a) goToAsset(a);
  }, [focusAsset]);
  pmE(() => { if (openQuery) setQuery(true); }, [openQuery]);

  // áp dụng tô sáng kết quả truy vấn lên bản đồ
  const applyQuery = (res) => {
    if (!res) { setEmphasis(null); return; }
    const canHi = res.pipes.length + res.valves.length > 0;
    if (!canHi) { setEmphasis(null); return; }
    setEmphasis({ dim: true, pipes: new Set(res.pipes), valvesOpen: new Set(res.valves) });
    setVis((v) => ({ ...v, pipe: res.pipes.length ? true : v.pipe, valve: res.valves.length ? true : v.valve }));
  };

  return (
    <div className="flex h-[calc(100vh-53px)] flex-col" data-screen-label="Bản đồ mạng lưới">
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-[var(--surface)] px-3 py-2">
        <button onClick={() => setShowLayers((s) => !s)} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-[color:var(--text2)] transition-colors hover:border-[color:var(--text2)]" style={{ borderRadius: window.rad(), background: showLayers ? "var(--surface2)" : "transparent" }}>{React.createElement(window.IcLayers, { size: 15 })}<span className="hidden sm:inline">Lớp</span></button>
        <button onClick={() => setQuery((s) => !s)} title="Truy vấn thuộc tính & không gian" className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-[color:var(--text2)] transition-colors hover:border-[color:var(--text2)]" style={{ borderRadius: window.rad(), background: query ? "var(--surface2)" : "transparent" }}>{React.createElement(window.IcFilter, { size: 15 })}<span className="hidden sm:inline">Truy vấn</span></button>
        <div className="relative">
          <button onClick={() => setSymbOpen((o) => !o)} title="Tô màu tuyến ống" className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-[color:var(--text2)] transition-colors hover:border-[color:var(--text2)]" style={{ borderRadius: window.rad(), background: paint !== "status" ? "var(--surface2)" : "transparent" }}>
            <span className="h-3 w-3 rounded-sm" style={{ background: paint === "status" ? window.tone("#0E7C86") : `linear-gradient(90deg, ${window.tone("#0E7C86")}, ${window.tone("#9A6700")})` }}></span>
            <span className="hidden md:inline">{(SYMB.find((s) => s.id === paint) || {}).label}</span>{React.createElement(window.IcChevD, { size: 13 })}
          </button>
          {symbOpen ? (<>
            <div className="fixed inset-0 z-20" onClick={() => setSymbOpen(false)}></div>
            <div className="crm-menu-in absolute left-0 top-10 z-30 w-52 overflow-hidden rounded-lg border border-line bg-[var(--surface)] py-1" style={{ boxShadow: "var(--toast-shadow)", borderRadius: window.rad() }}>
              <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Tô màu ống theo</div>
              {SYMB.map((s) => (
                <button key={s.id} onClick={() => { setPaint(s.id); setSymbOpen(false); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--surface2)]" style={{ color: paint === s.id ? "var(--text)" : "var(--text2)" }}>
                  {s.label}{paint === s.id ? <span style={{ color: window.cAccent() }}>{React.createElement(window.IcCheck, { size: 14 })}</span> : null}
                </button>
              ))}
            </div>
          </>) : null}
        </div>
        <div className="relative w-full max-w-[340px]">
          <TextInput value={q} onChange={setQ} placeholder="Tìm tài sản theo mã / tên… (vd O.300)" icon="IcSearch"></TextInput>
          {results.length ? (
            <div className="crm-menu-in absolute left-0 top-10 z-30 w-full overflow-hidden rounded-lg border border-line bg-[var(--surface)]" style={{ boxShadow: "var(--toast-shadow)" }}>
              {results.map((a) => (
                <button key={a.id} onClick={() => goToAsset(a)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface2)]">
                  <span style={{ color: window.tone(G.ASSET_TYPES[a.type].col) }}>{React.createElement(window[G.ASSET_TYPES[a.type].icon], { size: 15 })}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-[color:var(--text)]">{a.name}</div><div className="font-mono text-[10px] text-[color:var(--muted)]">{a.code}</div></div>
                  <DmaChip dma={a.dma} sm></DmaChip>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn size="sm" variant={measuring ? "primary" : "ghost"} icon="IcRuler" onClick={() => { setMeasuring((m) => !m); if (measuring) setMpts([]); }} title="Đo khoảng cách"><span className="hidden lg:inline">Đo</span></Btn>
          <Btn size="sm" variant="ghost" icon="IcFile" onClick={() => setAtlas(true)} title="Xuất tập bản đồ"><span className="hidden lg:inline">Tập bản đồ</span></Btn>
          <Btn size="sm" variant="primary" icon="IcPlus" onClick={() => go({ name: "editor" })}><span className="hidden sm:inline">Tài sản</span></Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {showLayers ? <LayerPanel vis={vis} setVis={setVis} onClose={() => setShowLayers(false)}></LayerPanel> : null}
        {query ? <QueryPanel onClose={() => setQuery(false)} onApply={applyQuery} onFocus={goToAsset} toast={toast}></QueryPanel> : null}
        <div className="relative min-w-0 flex-1">
          <NetworkMap layers={vis} selected={sel} onSelect={(s) => { setSel(s); setFocus(null); }} emphasis={emphasis} focus={focus} onBg={() => setSel(null)} paint={{ mode: paint }} legendRows={symbLegend(paint)} measure={measuring ? mpts : null} onMeasureClick={measuring ? (pt) => setMpts((a) => [...a, pt]) : undefined}></NetworkMap>
          {measuring ? (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-lg border border-line bg-[var(--surface)] px-3 py-1.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() }}>
              <span className="flex items-center gap-1.5 text-[12px] text-[color:var(--text2)]" style={{ color: window.tone(window.cAccent()) }}>{React.createElement(window.IcRuler, { size: 14 })}<b className="font-mono text-[color:var(--text)]">{mpts.length > 1 ? window.fmtKm(measTotal) : "0 m"}</b></span>
              <span className="hidden text-[11px] text-[color:var(--muted2)] sm:inline">{mpts.length} điểm · bấm để thêm</span>
              <span className="h-4 w-px bg-[var(--line)]"></span>
              <button onClick={() => setMpts((a) => a.slice(0, -1))} disabled={!mpts.length} className="text-[11.5px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] disabled:opacity-40">Hoàn tác</button>
              <button onClick={() => setMpts([])} disabled={!mpts.length} className="text-[11.5px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] disabled:opacity-40">Xoá</button>
              <button onClick={() => { setMeasuring(false); setMpts([]); }} className="text-[11.5px] font-semibold" style={{ color: window.tone(window.cAccent()) }}>Xong</button>
            </div>
          ) : null}
          {/* mini stats trên map */}
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
            {[["Ống", G.DASH.pipeCount, "#0E7C86"], ["Van", G.DASH.valveCount, "#0969DA"], ["Đấu nối", G.DASH.connCount, "#9A6700"]].map((s) => (
              <span key={s[0]} className="flex items-center gap-1.5 rounded-md border border-line bg-[var(--surface)]/90 px-2 py-1 text-[10.5px] backdrop-blur"><StatusDot color={window.tone(s[2])} size={7}></StatusDot><span className="text-[color:var(--muted)]">{s[0]}</span><span className="font-mono font-semibold text-[color:var(--text)]">{window.fmtInt(s[1])}</span></span>
            ))}
          </div>
        </div>
        {sel ? <AssetInspector sel={sel} onClose={() => setSel(null)} go={go} toast={toast}></AssetInspector> : null}
      </div>
      <AtlasModal open={atlas} onClose={() => setAtlas(false)} toast={toast}></AtlasModal>
    </div>
  );
}

Object.assign(window, { MapScreen, AssetInspector, assetIndex });
