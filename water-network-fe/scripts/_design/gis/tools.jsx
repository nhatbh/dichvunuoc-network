/* GIS — Công cụ liên thông & truy vấn.
   ServiceLinks : section "Liên thông service" trong inspector (A).
   CommandPalette: tìm kiếm toàn cục Cmd/Ctrl-K (C).
   QueryPanel    : truy vấn thuộc tính + không gian trên bản đồ (C).
   Load SAU ui.jsx, TRƯỚC map.jsx & app.jsx. */
const { useState: tlU, useEffect: tlE, useRef: tlR, useMemo: tlM } = React;

/* ───────────────────────── A · Liên thông service ───────────────────────── */
function ServiceLinks({ asset, toast }) {
  const G = window.GIS;
  const links = asset ? G.assetLinks(asset) : [];
  if (!links.length) return null;
  const code = asset.code || asset.id;
  return (
    <div className="mb-3 rounded-lg border border-line bg-[var(--surface2)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
        {React.createElement(window.IcLink, { size: 12 })}Liên thông service
      </div>
      <div className="flex flex-col gap-0.5">
        {links.map((l) => {
          const s = G.SERVICES[l.id]; const st = G.LINK_STATE[l.status];
          const col = window.tone(s.col), sc = window.tone(st.col);
          return (
            <button key={l.id} onClick={() => toast("Mở " + s.label + " · " + code, "info")} title={"Mở " + code + " trong " + s.label}
              className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--surface)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: window.chex(s.col, window.cTheme() === "light" ? 0.12 : 0.2), color: col }}>{React.createElement(window[s.icon], { size: 15 })}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-[color:var(--text)]">{s.label}</div>
                <div className="truncate text-[10.5px] text-[color:var(--muted)]">{l.detail}</div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-[1px] text-[9.5px] font-medium" style={{ background: window.chex(st.col, window.cTheme() === "light" ? 0.1 : 0.2), color: sc }}><span className="h-1 w-1 rounded-full" style={{ background: sc }}></span>{st.label}</span>
              <span className="shrink-0 text-[color:var(--muted2)] opacity-0 transition-opacity group-hover:opacity-100">{React.createElement(window.IcExternal, { size: 13 })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── C1 · Command palette (Cmd-K) ──────────────────── */
const CMD_NAV = [
  ["dashboard", "Tổng quan GIS", "IcGridSq"], ["map", "Bản đồ mạng lưới", "IcMap"],
  ["editor", "Biên tập mạng lưới", "IcPencil"], ["assets", "Tài sản không gian", "IcPipe"],
  ["topology", "Kiểm tra topology", "IcGitBranch"], ["trace", "Truy vết & cô lập van", "IcRoute"],
  ["connections", "Đấu nối khách hàng", "IcPlug"], ["import", "Import khảo sát", "IcUpload"],
  ["field", "Ứng dụng hiện trường", "IcMobile"], ["scenarios", "Kịch bản mạng lưới", "IcGitBranch"],
  ["versions", "Phiên bản & phê duyệt", "IcCheckBadge"],
];

function CmdRow({ item, active, onRun, onHover }) {
  const ac = window.cAccent();
  return (
    <button onMouseMove={onHover} onClick={onRun}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
      style={{ background: active ? "var(--surface2)" : "transparent" }}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: active ? window.chex(item.col || "#0E7C86", window.cTheme() === "light" ? 0.14 : 0.22) : "var(--surface2)", color: active ? window.tone(item.col || window.cAccent()) : "var(--muted)" }}>{React.createElement(window[item.icon] || window.IcGridSq, { size: 15 })}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-[color:var(--text)]">{item.label}</div>
        {item.sub ? <div className="truncate font-mono text-[10px] text-[color:var(--muted)]">{item.sub}</div> : null}
      </div>
      {item.tag ? <span className="shrink-0 rounded px-1.5 py-[1px] text-[9.5px] font-medium text-[color:var(--muted)] bg-[var(--surface2)]">{item.tag}</span> : null}
      {active ? <span className="shrink-0 font-mono text-[10px] text-[color:var(--muted2)]">↵</span> : null}
    </button>
  );
}

function CommandPalette({ open, onClose, go, toast }) {
  const G = window.GIS;
  const [q, setQ] = tlU("");
  const [act, setAct] = tlU(0);
  const inputRef = tlR(null);

  tlE(() => { if (open) { setQ(""); setAct(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);

  const groups = tlM(() => {
    const k = window.cnorm(q.trim());
    const actions = [
      { id: "a-trace", label: "Cô lập van / truy vết sự cố", icon: "IcRoute", col: "#0E7C86", run: () => go({ name: "trace" }) },
      { id: "a-query", label: "Truy vấn nâng cao trên bản đồ", icon: "IcFilter", col: "#0969DA", run: () => go({ name: "map", openQuery: true }) },
      { id: "a-import", label: "Import dữ liệu khảo sát", icon: "IcUpload", col: "#8250DF", run: () => go({ name: "import" }) },
      { id: "a-new", label: "Thêm tài sản mới (biên tập)", icon: "IcPlus", col: "#1A7F37", run: () => go({ name: "editor" }) },
    ];
    const nav = CMD_NAV.map(([id, label, icon]) => ({ id: "n-" + id, label, icon, run: () => go({ name: id }) }));
    if (!k) {
      return [
        { title: "Hành động nhanh", items: actions },
        { title: "Điều hướng", items: nav },
      ];
    }
    const assetHits = G.assets.filter((a) => window.cnorm(a.code).includes(k) || window.cnorm(a.name).includes(k)).slice(0, 6)
      .map((a) => ({ id: "as-" + a.id, label: a.name, sub: a.code, icon: G.ASSET_TYPES[a.type].icon, col: G.ASSET_TYPES[a.type].col, tag: a.dma, run: () => go({ name: "map", focusAsset: { type: a.type, id: a.id } }) }));
    const connHits = G.connections.filter((c) => window.cnorm(c.danhbo).includes(k) || window.cnorm(c.name).includes(k) || window.cnorm(c.addr).includes(k)).slice(0, 4)
      .map((c) => ({ id: "co-" + c.id, label: c.name, sub: c.danhbo + " · " + c.addr, icon: "IcPlug", col: "#9A6700", tag: c.dma, run: () => { go({ name: "connections" }); toast("Danh bộ " + c.danhbo + " · " + c.name, "info"); } }));
    const navHits = nav.filter((n) => window.cnorm(n.label).includes(k));
    const actHits = actions.filter((a) => window.cnorm(a.label).includes(k));
    const out = [];
    if (assetHits.length) out.push({ title: "Tài sản không gian", items: assetHits });
    if (connHits.length) out.push({ title: "Đấu nối khách hàng", items: connHits });
    if (navHits.length) out.push({ title: "Điều hướng", items: navHits });
    if (actHits.length) out.push({ title: "Hành động", items: actHits });
    return out;
  }, [q]);

  const flat = tlM(() => groups.flatMap((g) => g.items), [groups]);
  tlE(() => { setAct(0); }, [q]);

  const runIdx = (i) => { const it = flat[i]; if (it) { it.run(); onClose(); } };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); runIdx(act); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  if (!open) return null;
  let idx = -1;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]" style={{ background: window.cTheme() === "light" ? "rgba(20,30,45,0.34)" : "rgba(0,0,0,0.62)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="crm-modal-in flex max-h-[72vh] w-full max-w-[560px] flex-col overflow-hidden border border-line bg-[var(--surface)]" style={{ borderRadius: window.rad() + 6, boxShadow: "0 24px 64px -16px rgba(0,0,0,0.45)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="shrink-0 text-[color:var(--muted2)]">{React.createElement(window.IcSearch, { size: 17 })}</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Tìm tài sản, danh bộ, địa chỉ, màn hình…" className="h-7 w-full bg-transparent text-[14px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted2)]"></input>
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--muted2)] sm:block">esc</kbd>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {flat.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center">
              <span className="text-[color:var(--faint)]">{React.createElement(window.IcSearch, { size: 22 })}</span>
              <div className="text-[12.5px] text-[color:var(--muted)]">Không có kết quả cho “{q}”</div>
            </div>
          ) : groups.map((g) => (
            <div key={g.title} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{g.title}</div>
              {g.items.map((it) => { idx++; const my = idx; return <CmdRow key={it.id} item={it} active={my === act} onRun={() => runIdx(my)} onHover={() => setAct(my)}></CmdRow>; })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[10.5px] text-[color:var(--muted2)]">
          <span className="flex items-center gap-1"><kbd className="rounded border border-line px-1 font-mono">↑↓</kbd>chọn</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-line px-1 font-mono">↵</kbd>mở</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="rounded border border-line px-1 font-mono">⌘K</kbd>tìm kiếm</span>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── C2 · Query builder panel ──────────────────────── */
const QTYPES = [["pipe", "Ống"], ["valve", "Van"], ["hydrant", "Trụ PCC"], ["pump", "Trạm bơm"], ["reservoir", "Bể/đài"]];
const DN_BUCKETS = { all: () => true, le150: (d) => d <= 150, m200: (d) => d >= 200 && d <= 250, ge300: (d) => d >= 300 };
const YR_BUCKETS = { all: () => true, pre2000: (y) => y < 2000, y00s: (y) => y >= 2000 && y <= 2010, post2010: (y) => y > 2010 };

function QChip({ on, onClick, children }) {
  return (
    <button onClick={onClick} className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] font-medium transition-colors"
      style={{ borderColor: on ? window.cAccent() : "var(--line)", background: on ? window.chex(window.cAccent(), window.cTheme() === "light" ? 0.12 : 0.22) : "transparent", color: on ? window.tone(window.cAccent()) : "var(--muted)", borderRadius: window.rad() - 2 }}>
      {children}
    </button>
  );
}
function QField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-[color:var(--muted2)]">{label}</span>
      {children}
    </div>
  );
}

function QueryPanel({ onClose, onApply, onFocus, toast }) {
  const G = window.GIS;
  const [types, setTypes] = tlU({ pipe: true, valve: true, hydrant: false, pump: false, reservoir: false });
  const [dma, setDma] = tlU("all");
  const [material, setMaterial] = tlU("all");
  const [dn, setDn] = tlU("all");
  const [yr, setYr] = tlU("all");
  const [cond, setCond] = tlU("all");
  const [status, setStatus] = tlU("all");

  const results = tlM(() => {
    return G.assets.filter((a) => {
      if (!types[a.type]) return false;
      if (dma !== "all" && a.dma !== dma) return false;
      const g = a.geomRef || {};
      if (material !== "all") { if (a.type !== "pipe" || g.material !== material) return false; }
      if (dn !== "all") { const d = g.dn; if (d == null || !DN_BUCKETS[dn](d)) return false; }
      if (yr !== "all") { const y = g.year; if (y == null || !YR_BUCKETS[yr](y)) return false; }
      if (cond !== "all" && a.cond !== cond) return false;
      if (status !== "all" && a.status !== status) return false;
      return true;
    });
  }, [types, dma, material, dn, yr, cond, status]);

  // áp dụng tô sáng lên bản đồ mỗi khi kết quả đổi
  tlE(() => {
    const pipes = results.filter((a) => a.type === "pipe").map((a) => a.id);
    const valves = results.filter((a) => a.type === "valve").map((a) => a.id);
    onApply({ pipes, valves, types });
    return () => onApply(null);
  }, [results]);

  const breakdown = tlM(() => QTYPES.map(([k, lbl]) => ({ label: lbl, col: G.ASSET_TYPES[k].col, n: results.filter((r) => r.type === k).length })).filter((r) => r.n > 0), [results]);
  const totalLen = tlM(() => results.filter((r) => r.type === "pipe").reduce((s, r) => s + (r.geomRef.lenM || 0), 0), [results]);

  const reset = () => { setTypes({ pipe: true, valve: true, hydrant: false, pump: false, reservoir: false }); setDma("all"); setMaterial("all"); setDn("all"); setYr("all"); setCond("all"); setStatus("all"); };

  const dmaOpts = [{ value: "all", label: "Tất cả DMA" }, ...G.dmas.map((d) => ({ value: d.id, label: d.id + " · " + d.name }))];
  const matOpts = [{ value: "all", label: "Mọi vật liệu" }, ...G.MATERIALS.map((m) => ({ value: m, label: m }))];
  const dnOpts = [{ value: "all", label: "Mọi đường kính" }, { value: "le150", label: "DN ≤ 150" }, { value: "m200", label: "DN 200 – 250" }, { value: "ge300", label: "DN ≥ 300" }];
  const yrOpts = [{ value: "all", label: "Mọi năm lắp" }, { value: "pre2000", label: "Trước 2000" }, { value: "y00s", label: "2000 – 2010" }, { value: "post2010", label: "Sau 2010" }];
  const condOpts = [{ value: "all", label: "Mọi tình trạng" }, ...Object.entries(G.COND).map(([k, v]) => ({ value: k, label: v.label }))];
  const stOpts = [{ value: "all", label: "Mọi trạng thái" }, ...Object.entries(G.PSTATUS).map(([k, v]) => ({ value: k, label: v.label }))];

  return (
    <div className="flex w-[268px] shrink-0 flex-col overflow-hidden border-r border-line bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[color:var(--text)]">{React.createElement(window.IcFilter, { size: 15 })}Truy vấn tài sản</span>
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">{React.createElement(window.IcX, { size: 14 })}</button>
      </div>

      <div className="flex flex-col gap-3 border-b border-line px-3.5 py-3">
        <QField label="Loại tài sản">
          <div className="flex flex-wrap gap-1.5">
            {QTYPES.map(([k, lbl]) => <QChip key={k} on={types[k]} onClick={() => setTypes((t) => ({ ...t, [k]: !t[k] }))}>{lbl}</QChip>)}
          </div>
        </QField>
        <QField label="Phân vùng (không gian)"><Select value={dma} onChange={setDma} options={dmaOpts}></Select></QField>
        <div className="grid grid-cols-2 gap-2">
          <QField label="Đường kính"><Select value={dn} onChange={setDn} options={dnOpts}></Select></QField>
          <QField label="Năm lắp"><Select value={yr} onChange={setYr} options={yrOpts}></Select></QField>
        </div>
        <QField label="Vật liệu (ống)"><Select value={material} onChange={setMaterial} options={matOpts}></Select></QField>
        <div className="grid grid-cols-2 gap-2">
          <QField label="Tình trạng"><Select value={cond} onChange={setCond} options={condOpts}></Select></QField>
          <QField label="Trạng thái"><Select value={status} onChange={setStatus} options={stOpts}></Select></QField>
        </div>
      </div>

      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-baseline gap-1.5"><span className="font-mono text-[18px] font-semibold text-[color:var(--text)]">{window.fmtInt(results.length)}</span><span className="text-[11px] text-[color:var(--muted)]">đối tượng</span></div>
        {totalLen > 0 ? <span className="font-mono text-[11px] text-[color:var(--muted)]">{window.fmtKm(totalLen)} ống</span> : null}
      </div>
      {breakdown.length ? <div className="px-3.5 pb-2.5"><StackBar rows={breakdown} h={8}></StackBar></div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 py-1.5">
        {results.length === 0 ? (
          <div className="px-2 py-8 text-center text-[11.5px] text-[color:var(--muted)]">Không có tài sản khớp bộ lọc.</div>
        ) : results.slice(0, 200).map((a) => (
          <button key={a.id} onClick={() => onFocus(a)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface2)]">
            <span className="shrink-0" style={{ color: window.tone(G.ASSET_TYPES[a.type].col) }}>{React.createElement(window[G.ASSET_TYPES[a.type].icon], { size: 14 })}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-[color:var(--text)]">{a.name}</div><div className="font-mono text-[10px] text-[color:var(--muted)]">{a.code}</div></div>
            <DmaChip dma={a.dma} sm></DmaChip>
          </button>
        ))}
        {results.length > 200 ? <div className="px-2 py-2 text-center font-mono text-[10px] text-[color:var(--muted2)]">… +{window.fmtInt(results.length - 200)} đối tượng khác</div> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line p-2.5">
        <Btn size="sm" variant="ghost" icon="IcRefresh" onClick={reset}>Xoá lọc</Btn>
        <Btn size="sm" icon="IcDownload" onClick={() => toast("Xuất " + window.fmtInt(results.length) + " đối tượng ra GeoJSON", "success")}>GeoJSON</Btn>
      </div>
    </div>
  );
}

Object.assign(window, { ServiceLinks, CommandPalette, QueryPanel });
