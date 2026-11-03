/* GIS — Kịch bản & Phiên bản mạng lưới.
   Mô hình nhánh (branch) theo 3 trạng thái vòng đời: Quá khứ · Hiện tại · Tương lai.
   - Mỗi nhánh fork từ 1 base, chỉ lưu delta (card) chồng lên → kế thừa dữ liệu bản khác.
   - Card (= change set) cherry-pick được giữa các nhánh.
   - So sánh 2 bản → diff theo đối tượng + overlay bản đồ.
   - Chọn 1 nhánh làm bản CHÍNH THỨC → đóng băng bản cũ về Quá khứ, phát event sync. */
const { useState: scU, useMemo: scM } = React;

const SC_LANES = {
  past: { label: "Quá khứ", col: "#8B949E", sub: "Snapshot bất biến" },
  current: { label: "Hiện tại", col: "#0E7C86", sub: "Bản chính thức (of-record)" },
  future: { label: "Tương lai", col: "#0969DA", sub: "Kịch bản quy hoạch" },
};
const SC_STATE = {
  official: { l: "Chính thức", c: "#1A7F37", ic: "IcCheckBadge" },
  review: { l: "Đang duyệt", c: "#9A6700", ic: "IcClock" },
  draft: { l: "Nháp", c: "#0969DA", ic: "IcPencil" },
  archived: { l: "Lưu trữ", c: "#8B949E", ic: "IcDatabase" },
};

/* ---- card registry (đơn vị thay đổi di chuyển được) ---- */
const SC_CARDS = {
  "CS-314": { title: "Đồng bộ van biên DMA-01 / DMA-04", kind: "valve", adds: 4, mods: 11, dels: 0, dma: "DMA-01", by: "Phạm Khảo Sát" },
  "CS-316": { title: "Sửa cao độ 6 nút lưới Nguyễn Trãi", kind: "node", adds: 0, mods: 6, dels: 0, dma: "DMA-03", by: "Trần Đo Đạc" },
  "CS-318": { title: "Cập nhật tuyến ống DN300 Hai Bà Trưng", kind: "pipe", adds: 12, mods: 8, dels: 1, dma: "DMA-04", by: "Lê Biên Tập" },
  "CS-330": { title: "Tuyến truyền tải DN400 KĐT Đông", kind: "pipe", adds: 34, mods: 0, dels: 0, dma: "DMA-03", by: "Phòng Quy hoạch" },
  "CS-331": { title: "Thay 1,2km ống gang → HDPE Lê Lợi", kind: "pipe", adds: 18, mods: 18, dels: 18, dma: "DMA-02", by: "Lê Biên Tập" },
  "CS-332": { title: "Bổ sung 3 van phân vùng DMA-04", kind: "valve", adds: 3, mods: 2, dels: 0, dma: "DMA-04", by: "Network Eng." },
  "CS-333": { title: "Trạm tăng áp Đông — giai đoạn 2", kind: "pump", adds: 1, mods: 0, dels: 0, dma: "DMA-03", by: "Phòng Quy hoạch" },
  "CS-334": { title: "Vòng khép mạng DN300 Đông–Nam", kind: "pipe", adds: 9, mods: 4, dels: 0, dma: "DMA-05", by: "Phòng Quy hoạch" },
};
const cardDelta = (ids) => ids.reduce((s, id) => { const c = SC_CARDS[id]; return c ? { adds: s.adds + c.adds, mods: s.mods + c.mods, dels: s.dels + c.dels } : s; }, { adds: 0, mods: 0, dels: 0 });

/* ---- nhánh ---- */
function scBranches() {
  return scSeed();
}
function scSeed() {
  return [
    { id: "B-2020", name: "Hiện trạng 2020", lane: "past", state: "archived", ver: "v6", base: null, at: "31/12/2020", by: "Phòng GIS", cards: [], x: 20, y: 70, pipeKm: 268.4, assets: 2140, note: "Snapshot bàn giao số hoá lần đầu." },
    { id: "B-2023", name: "Hiện trạng 2023", lane: "past", state: "archived", ver: "v9", base: "B-2020", at: "31/12/2023", by: "Phòng GIS", cards: ["CS-316"], x: 150, y: 210, pipeKm: 301.7, assets: 2680, note: "Đóng băng trước đợt thay ống lớn 2024." },
    { id: "B-CUR", name: "Hiện trạng mạng lưới", lane: "current", state: "official", ver: "v12", base: "B-2023", at: "10:15 hôm nay", by: "Lê Biên Tập", cards: ["CS-314", "CS-318"], x: 412, y: 150, pipeKm: 318.6, assets: 2914, note: "Bản of-record — nguồn sự thật, đồng bộ Hydraulic/DMA/EAM/Billing." },
    { id: "B-PIPE", name: "Thay ống gang Lê Lợi", lane: "future", state: "review", ver: "v2", base: "B-CUR", baseVer: "v12", at: "Hôm qua", by: "Lê Biên Tập", cards: ["CS-331"], x: 662, y: 36, pipeKm: 318.6, assets: 2914, note: "Kịch bản cải tạo DMA-02, chờ duyệt để nhập vào Hiện trạng." },
    { id: "B-QH30", name: "Quy hoạch 2030 — mở rộng Đông", lane: "future", state: "draft", ver: "v3", base: "B-CUR", baseVer: "v12", at: "19/06", by: "Phòng Quy hoạch", cards: ["CS-330", "CS-333"], x: 690, y: 168, pipeKm: 339.1, assets: 3050, note: "Mở rộng cấp nước KĐT Đông + tăng áp." },
    { id: "B-DMA4", name: "Tái cấu trúc DMA-04", lane: "future", state: "draft", ver: "v2", base: "B-CUR", baseVer: "v11", at: "17/06", by: "Network Eng.", cards: ["CS-332"], x: 662, y: 300, pipeKm: 319.9, assets: 2920, note: "Chia tách DMA-04 để giảm NRW, base ở v11 — cần rebase lên v12." },
    { id: "B-QH30B", name: "QH 2030 · giai đoạn 2", lane: "future", state: "draft", ver: "v1", base: "B-QH30", baseVer: "v3", at: "Hôm nay", by: "Phòng Quy hoạch", cards: ["CS-330", "CS-333", "CS-334"], x: 848, y: 300, pipeKm: 348.0, assets: 3120, note: "Kế thừa QH2030 + khép vòng mạng — minh hoạ nhánh-từ-nhánh." },
  ];
}

/* ---- persistence chia sẻ giữa các trang (localStorage) ---- */
const SC_LS_BRANCHES = "gis.branches.v1";
const SC_LS_CARDS = "gis.cards.v1";
function scLoadBranches() {
  try { const raw = localStorage.getItem(SC_LS_BRANCHES); if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr; } } catch (e) {}
  return scSeed();
}
function scSaveBranches(branches) {
  try { localStorage.setItem(SC_LS_BRANCHES, JSON.stringify(branches)); } catch (e) {}
}
function scLoadCards() {
  try { const raw = localStorage.getItem(SC_LS_CARDS); if (raw) return JSON.parse(raw) || {}; } catch (e) {}
  return {};
}
function scSaveCard(id, card) {
  try { const ex = scLoadCards(); ex[id] = card; localStorage.setItem(SC_LS_CARDS, JSON.stringify(ex)); } catch (e) {}
}
// nạp card đã commit ở phiên trước vào registry
try { Object.assign(SC_CARDS, scLoadCards()); } catch (e) {}

/* tập card hiệu lực (kế thừa theo chuỗi base) */
function effectiveCards(branch, all) {
  const byId = Object.fromEntries(all.map((b) => [b.id, b]));
  const out = []; let cur = branch; const seen = new Set();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); cur.cards.forEach((c) => { if (!out.includes(c)) out.unshift(c); }); cur = cur.base ? byId[cur.base] : null; }
  return out;
}
function pipesByDmas(dmas) { const s = new Set(dmas); return window.GIS.pipes.filter((p) => s.has(p.dma)).map((p) => p.id); }

/* ======================= LINEAGE GRAPH ======================= */
function LineageGraph({ branches, selId, compareSel, onSelect }) {
  const NW = 172, NH = 60;
  const byId = Object.fromEntries(branches.map((b) => [b.id, b]));
  const cx = (b) => b.x + NW / 2, cy = (b) => b.y + NH / 2;
  const edges = branches.filter((b) => b.base && byId[b.base]).map((b) => ({ from: byId[b.base], to: b, promote: byId[b.base].lane !== b.lane && b.lane !== "future" }));
  const ac = window.cAccent();

  return (
    <div className="relative overflow-x-auto">
      <div className="relative" style={{ width: 1040, height: 392 }}>
        {/* lane bands */}
        {[["past", 0, 380], ["current", 384, 252], ["future", 640, 400]].map(([k, x, w]) => (
          <div key={k} className="absolute top-0 bottom-0" style={{ left: x, width: w }}>
            <div className="absolute inset-y-2 left-0 right-0 rounded-2xl" style={{ background: window.chex(SC_LANES[k].col, window.cTheme() === "light" ? 0.045 : 0.08), border: `1px dashed ${window.chex(SC_LANES[k].col, 0.3)}` }}></div>
            <div className="absolute left-3 top-3 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: window.tone(SC_LANES[k].col) }}></span>
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: window.tone(SC_LANES[k].col) }}>{SC_LANES[k].label}</span>
              <span className="text-[10px] text-[color:var(--muted2)]">· {SC_LANES[k].sub}</span>
            </div>
          </div>
        ))}
        {/* edges */}
        <svg className="pointer-events-none absolute inset-0" width={1040} height={392}>
          {edges.map((e, i) => {
            const x1 = e.from.x + NW, y1 = cy(e.from), x2 = e.to.x, y2 = cy(e.to);
            const mx = (x1 + x2) / 2;
            const col = e.promote ? window.tone("#1A7F37") : window.chex(SC_LANES[e.to.lane].col, 0.55);
            return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={col} strokeWidth={e.promote ? 2.4 : 1.8} strokeDasharray={e.promote ? "none" : "5 4"}></path>;
          })}
        </svg>
        {/* nodes */}
        {branches.map((b) => {
          const st = SC_STATE[b.state]; const col = window.tone(SC_LANES[b.lane].col);
          const sel = selId === b.id; const inCmp = compareSel && (compareSel.a === b.id || compareSel.b === b.id);
          const official = b.state === "official";
          return (
            <button key={b.id} onClick={() => onSelect(b.id)} className="absolute flex flex-col justify-between rounded-xl border bg-[var(--surface)] px-3 py-2 text-left transition-all"
              style={{ left: b.x, top: b.y, width: NW, height: NH, borderColor: sel ? ac : official ? window.tone("#1A7F37") : "var(--line)", borderWidth: sel || official ? 2 : 1, boxShadow: sel ? `0 0 0 3px ${window.chex(ac, 0.16)}` : "var(--card-shadow)", outline: inCmp ? `2px solid ${window.tone("#8250DF")}` : "none", outlineOffset: 2 }}>
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ background: window.chex(col, 0.16), color: col }}>{React.createElement(window.IcGitBranch, { size: 12 })}</span>
                <span className="truncate text-[12px] font-semibold text-[color:var(--text)]">{b.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 font-mono text-[10px] text-[color:var(--muted)]">{b.ver}{official ? React.createElement(window.IcCheckBadge, { size: 12, className: "ml-0.5", style: { color: window.tone("#1A7F37") } }) : null}</span>
                <span className="flex items-center gap-1 text-[9.5px] font-medium" style={{ color: window.tone(st.c) }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: window.tone(st.c) }}></span>{st.l}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10.5px] text-[color:var(--muted)]">
        <span className="flex items-center gap-1.5"><span className="inline-block h-[2.4px] w-5 rounded" style={{ background: window.tone("#1A7F37") }}></span>Đề bạt chính thức</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-5 rounded border-b border-dashed" style={{ borderColor: window.tone("#0969DA") }}></span>Fork kịch bản</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded" style={{ outline: `2px solid ${window.tone("#8250DF")}` }}></span>Đang so sánh</span>
      </div>
    </div>
  );
}

/* ======================= CARD ROW ======================= */
function CardRow({ id, right, onClick, muted }) {
  const c = SC_CARDS[id]; if (!c) return null;
  const meta = window.GIS.ASSET_TYPES[c.kind] || { icon: "IcGitBranch", col: "#0E7C86", label: c.kind };
  return (
    <div onClick={onClick} className={"flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 " + (onClick ? "cursor-pointer transition-colors hover:bg-[var(--surface2)] " : "")} style={{ borderRadius: window.rad(), opacity: muted ? 0.6 : 1 }}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: window.chex(window.tone(meta.col), 0.14), color: window.tone(meta.col) }}>{React.createElement(window[meta.icon] || window.IcGitBranch, { size: 14 })}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[color:var(--text)]">{c.title}</div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-[color:var(--muted)]"><span>{id}</span><span className="flex items-center gap-1.5"><span style={{ color: window.tone("#1A7F37") }}>+{c.adds}</span><span style={{ color: window.tone("#9A6700") }}>~{c.mods}</span><span style={{ color: window.tone("#D1242F") }}>−{c.dels}</span></span></div>
      </div>
      {React.createElement(window.DmaChip, { dma: c.dma, sm: true })}
      {right}
    </div>
  );
}
function DeltaPills({ d }) {
  return <span className="flex items-center gap-2 font-mono text-[12px]"><span style={{ color: window.tone("#1A7F37") }}>+{d.adds}</span><span style={{ color: window.tone("#9A6700") }}>~{d.mods}</span><span style={{ color: window.tone("#D1242F") }}>−{d.dels}</span></span>;
}

/* ======================= SCREEN ======================= */
function ScenariosScreen({ toast, go, branches, setBranches }) {
  const [selId, setSelId] = scU("B-QH30");
  const [mode, setMode] = scU("tree"); // tree | compare
  const [cmp, setCmp] = scU({ a: "B-CUR", b: "B-QH30" });
  const [impOpen, setImpOpen] = scU(false);
  const [forkOpen, setForkOpen] = scU(false);
  const [promo, setPromo] = scU(null);

  const byId = scM(() => Object.fromEntries(branches.map((b) => [b.id, b])), [branches]);
  const sel = byId[selId];
  const baseOf = sel && sel.base ? byId[sel.base] : null;
  const selDelta = scM(() => (sel ? cardDelta(sel.cards) : null), [sel, branches]);

  /* import card từ nhánh khác */
  const importableByBranch = scM(() => {
    if (!sel) return [];
    const own = new Set(effectiveCards(sel, branches));
    return branches.filter((b) => b.id !== sel.id).map((b) => ({ b, cards: b.cards.filter((c) => !own.has(c)) })).filter((g) => g.cards.length);
  }, [sel, branches]);

  const applyCard = (cardId) => {
    setBranches((bs) => bs.map((b) => (b.id === selId ? { ...b, cards: b.cards.includes(cardId) ? b.cards : [...b.cards, cardId], ver: "v" + (parseInt(b.ver.slice(1)) + 1) } : b)));
    toast("Đã nhập " + cardId + " vào " + sel.name + " — tạo " + ("v" + (parseInt(sel.ver.slice(1)) + 1)), "success");
  };

  const doFork = (name, baseIdSel, lane) => {
    const base = byId[baseIdSel];
    const id = "B-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const nb = { id, name: name || "Kịch bản mới", lane, state: "draft", ver: "v1", base: baseIdSel, baseVer: base.ver, at: "vừa xong", by: "Lê Biên Tập", cards: [], x: 848, y: 36, pipeKm: base.pipeKm, assets: base.assets, note: "Fork từ " + base.name + " @ " + base.ver + "." };
    setBranches((bs) => [...bs, nb]); setSelId(id); setForkOpen(false);
    toast("Đã tạo nhánh " + nb.name + " từ " + base.name, "success");
  };

  const doPromote = (b) => {
    setBranches((bs) => bs.map((x) => {
      if (x.id === b.id) return { ...x, lane: "current", state: "official", base: "B-CUR" };
      if (x.state === "official") return { ...x, lane: "past", state: "archived", name: x.name + " (cũ)" };
      return x;
    }));
    setPromo(null); setSelId(b.id);
    toast("Đã đề bạt “" + b.name + "” làm bản CHÍNH THỨC — đóng băng bản cũ, phát gis.network.published", "success");
  };

  const editable = (b) => b && (b.state === "draft" || b.state === "review");
  const cloneAndEdit = (b) => {
    const id = "B-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const nb = { id, name: b.name.replace(/ \(cũ\)$/, "") + " — bản sửa", lane: "future", state: "draft", ver: "v1", base: b.id, baseVer: b.ver, at: "vừa xong", by: "Lê Biên Tập", cards: [], x: 848, y: 36, pipeKm: b.pipeKm, assets: b.assets, note: "Nhân bản từ " + b.name + " @ " + b.ver + " để biên tập." };
    setBranches((bs) => [...bs, nb]);
    toast("Đã nhân bản → “" + nb.name + "”, mở để sửa", "success");
    if (go) go({ name: "editor", branch: id });
  };
  const openEdit = (b) => { if (editable(b)) go({ name: "editor", branch: b.id }); else cloneAndEdit(b); };

  const A = byId[cmp.a], B = byId[cmp.b];
  const diff = scM(() => {
    if (!A || !B) return null;
    const ea = new Set(effectiveCards(A, branches)), eb = new Set(effectiveCards(B, branches));
    const onlyB = [...eb].filter((c) => !ea.has(c)), onlyA = [...ea].filter((c) => !eb.has(c));
    const dmas = [...new Set([...onlyA, ...onlyB].map((c) => SC_CARDS[c] && SC_CARDS[c].dma).filter(Boolean))];
    return { onlyA, onlyB, delta: cardDelta(onlyB), dmas };
  }, [cmp, branches]);

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Kịch bản mạng lưới">
      <ScreenHead title="Kịch bản & phiên bản mạng lưới" sub="Quá khứ · Hiện tại · Tương lai — fork nhánh, cherry-pick card, so sánh, đề bạt bản chính thức"
        right={<>
          <SegToggle options={[{ id: "tree", label: "Cây phiên bản", icon: "IcGitBranch" }, { id: "compare", label: "So sánh", icon: "IcLayers" }]} value={mode} onChange={setMode}></SegToggle>
          <Btn size="sm" variant="primary" icon="IcPlus" onClick={() => setForkOpen(true)}>Tạo nhánh</Btn>
        </>}></ScreenHead>

      {/* lifecycle KPI */}
      <div className="grid grid-cols-3 gap-3">
        {["past", "current", "future"].map((k) => {
          const list = branches.filter((b) => b.lane === k);
          return (
            <div key={k} className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2 }}>
              <Tile icon={k === "past" ? "IcDatabase" : k === "current" ? "IcCheckBadge" : "IcGitBranch"} col={SC_LANES[k].col} size={38}></Tile>
              <div className="min-w-0">
                <div className="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{list.length}</div>
                <div className="mt-1 truncate text-[10.5px] text-[color:var(--muted)]">{SC_LANES[k].label} · {SC_LANES[k].sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {mode === "tree" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_372px]">
          <Card pad={false} className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">Cây phả hệ phiên bản</div>
            <div className="p-3"><LineageGraph branches={branches} selId={selId} compareSel={null} onSelect={setSelId}></LineageGraph></div>
          </Card>

          {sel ? (
            <div className="flex flex-col gap-3.5">
              <Card>
                <div className="flex items-start gap-2.5">
                  <Tile icon="IcGitBranch" col={SC_LANES[sel.lane].col} size={38}></Tile>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><Badge color={window.tone(SC_STATE[sel.state].c)} soft dot>{SC_STATE[sel.state].l}</Badge><Badge color={window.tone(SC_LANES[sel.lane].col)} soft>{SC_LANES[sel.lane].label}</Badge></div>
                    <h3 className="mt-1 text-[14.5px] font-semibold leading-tight text-[color:var(--text)]">{sel.name}</h3>
                    <div className="mt-0.5 font-mono text-[11px] text-[color:var(--muted)]">{sel.id} · {sel.ver}</div>
                  </div>
                </div>
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-[color:var(--muted)]">{sel.note}</p>
                <div className="mt-2.5 flex flex-col">
                  {baseOf ? <KV label="Tách từ"><button onClick={() => setSelId(baseOf.id)} className="font-medium text-[color:var(--text)] underline decoration-dotted">{baseOf.name}</button> <span className="font-mono text-[color:var(--muted)]">@ {sel.baseVer || baseOf.ver}</span></KV> : <KV label="Gốc">Bản nền — không kế thừa</KV>}
                  <KV label="Cập nhật">{sel.at} · {sel.by}</KV>
                  <KV label="Chiều dài ống" mono>{window.fmtDec(sel.pipeKm, 1)} km</KV>
                  {selDelta && (selDelta.adds + selDelta.mods + selDelta.dels) ? <KV label="Δ so với base"><DeltaPills d={selDelta}></DeltaPills></KV> : null}
                </div>
              </Card>

              <Card>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Card trong nhánh ({sel.cards.length})</span>
                  <button onClick={() => setImpOpen(true)} className="flex items-center gap-1 text-[11.5px] font-medium" style={{ color: window.tone(window.cAccent()) }}>{React.createElement(window.IcDownload, { size: 13 })}Nhập card</button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {sel.cards.length ? sel.cards.map((id) => <CardRow key={id} id={id}></CardRow>) : <div className="rounded-lg bg-[var(--surface2)] px-3 py-3 text-center text-[11.5px] text-[color:var(--muted)]">Nhánh kế thừa toàn bộ base, chưa có card delta riêng.</div>}
                </div>
              </Card>

              <div className="flex flex-col gap-2">
                {editable(sel)
                  ? <Btn full variant="primary" icon="IcPencil" onClick={() => openEdit(sel)}>Mở để sửa</Btn>
                  : <Btn full variant="primary" icon="IcGitBranch" onClick={() => cloneAndEdit(sel)}>Nhân bản để sửa</Btn>}
                <div className="grid grid-cols-2 gap-2">
                  <Btn icon="IcUpload" onClick={() => go({ name: "import", branch: editable(sel) ? sel.id : undefined })}>Import dữ liệu</Btn>
                  <Btn icon="IcLayers" onClick={() => { setCmp({ a: sel.base || "B-CUR", b: sel.id }); setMode("compare"); }}>So sánh base</Btn>
                </div>
                <Btn full icon="IcGitBranch" onClick={() => setForkOpen(true)}>Fork nhánh từ đây</Btn>
                {sel.state !== "official" ? <Btn full variant="default" icon="IcCheckBadge" onClick={() => setPromo(sel)}>Đặt làm bản chính thức</Btn>
                  : <div className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium" style={{ background: window.chex(window.tone("#1A7F37"), 0.12), color: window.tone("#1A7F37"), borderRadius: window.rad() }}>{React.createElement(window.IcCheckBadge, { size: 15 })}Đang là bản of-record</div>}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <CompareView branches={branches} cmp={cmp} setCmp={setCmp} A={A} B={B} diff={diff} toast={toast} onApplyAll={() => { setMode("tree"); setSelId(B.id); diff.onlyB.forEach((id) => applyCardTo(B.id, id, setBranches)); toast("Đã hợp nhất " + diff.onlyB.length + " card từ " + A.name + " vào " + B.name, "success"); }}></CompareView>
      )}

      {/* ---- Import modal ---- */}
      <Modal open={impOpen} onClose={() => setImpOpen(false)} title={"Nhập card vào " + (sel ? sel.name : "")} subtitle="Cherry-pick change set từ nhánh khác. Card đã có trong chuỗi kế thừa sẽ bị ẩn." icon="IcDownload" wide>
        {importableByBranch.length ? (
          <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
            {importableByBranch.map((g) => (
              <div key={g.b.id}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: window.tone(SC_LANES[g.b.lane].col) }}></span>{g.b.name}</div>
                <div className="flex flex-col gap-1.5">
                  {g.cards.map((id) => <CardRow key={id} id={id} right={<Btn size="sm" icon="IcPlus" onClick={() => { applyCard(id); setImpOpen(false); }}>Nhập</Btn>}></CardRow>)}
                </div>
              </div>
            ))}
          </div>
        ) : <Empty icon="IcDownload" title="Không có card nào để nhập" hint="Mọi card từ nhánh khác đã nằm trong chuỗi kế thừa của nhánh này."></Empty>}
      </Modal>

      {/* ---- Fork modal ---- */}
      <ForkModal open={forkOpen} branches={branches} defBase={selId} onClose={() => setForkOpen(false)} onCreate={doFork}></ForkModal>

      {/* ---- Promote modal ---- */}
      <Modal open={!!promo} onClose={() => setPromo(null)} title="Đề bạt bản chính thức" subtitle="Thao tác có kiểm soát — thay đổi nguồn sự thật của toàn hệ thống" icon="IcCheckBadge" accent="#1A7F37"
        footer={<><Btn variant="ghost" onClick={() => setPromo(null)}>Huỷ</Btn><Btn variant="primary" icon="IcCheckBadge" onClick={() => doPromote(promo)}>Xác nhận đề bạt</Btn></>}>
        {promo ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-line p-3 text-[12px]" style={{ borderRadius: window.rad() }}>
              <div className="font-semibold text-[color:var(--text)]">{promo.name} <span className="font-mono text-[11px] text-[color:var(--muted)]">{promo.ver}</span></div>
              {promo.base && byId[promo.base] ? <div className="mt-0.5 text-[11.5px] text-[color:var(--muted)]">Tách từ {byId[promo.base].name} @ {promo.baseVer || byId[promo.base].ver}</div> : null}
            </div>
            <div className="flex flex-col gap-2">
              {[["IcShield", "Validate topology toàn mạng trước khi publish"], ["IcDatabase", "Bản of-record hiện tại → đóng băng thành snapshot Quá khứ"], ["IcExternal", "Phát event sync sang Hydraulic · DMA · EAM · Billing"]].map((r, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[12px] text-[color:var(--text2)]"><span style={{ color: window.tone("#1A7F37") }}>{React.createElement(window[r[0]], { size: 15 })}</span>{r[1]}</div>
              ))}
            </div>
            <div className="rounded-lg px-3 py-2 text-[11.5px]" style={{ background: window.chex(window.tone("#9A6700"), 0.12), color: window.tone("#9A6700") }}>{React.createElement(window.IcAlert, { size: 13, className: "mr-1 inline" })}Cần quyền GIS_PUBLISHER. Hành động được ghi audit và có thể rollback về snapshot trước.</div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function applyCardTo(branchId, cardId, setBranches) {
  setBranches((bs) => bs.map((b) => (b.id === branchId ? { ...b, cards: b.cards.includes(cardId) ? b.cards : [...b.cards, cardId], ver: "v" + (parseInt(b.ver.slice(1)) + 1) } : b)));
}

/* ---- Compare ---- */
function CompareView({ branches, cmp, setCmp, A, B, diff, toast, onApplyAll }) {
  const opts = branches.map((b) => ({ value: b.id, label: b.name + " · " + b.ver }));
  const empPipes = diff ? new Set(pipesByDmas(diff.dmas)) : new Set();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
      <div className="flex flex-col gap-3.5">
        <Card>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">So sánh hai bản</div>
          <div className="flex flex-col gap-2.5">
            <Field label="Bản nền (A)"><Select value={cmp.a} onChange={(v) => setCmp({ ...cmp, a: v })} options={opts}></Select></Field>
            <div className="flex justify-center text-[color:var(--muted2)]">{React.createElement(window.IcArrowDown, { size: 16 })}</div>
            <Field label="Bản đích (B)"><Select value={cmp.b} onChange={(v) => setCmp({ ...cmp, b: v })} options={opts}></Select></Field>
          </div>
        </Card>
        {diff ? (
          <Card>
            <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Δ B so với A</span><DeltaPills d={diff.delta}></DeltaPills></div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              {[["Thêm", diff.delta.adds, "#1A7F37"], ["Sửa", diff.delta.mods, "#9A6700"], ["Xoá", diff.delta.dels, "#D1242F"]].map((s) => <div key={s[0]} className="rounded-lg border border-line py-2"><div className="font-mono text-[17px] font-semibold" style={{ color: window.tone(s[2]) }}>{s[1]}</div><div className="text-[10px] text-[color:var(--muted)]">{s[0]} đối tượng</div></div>)}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Card chỉ có ở B ({diff.onlyB.length})</div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {diff.onlyB.length ? diff.onlyB.map((id) => <CardRow key={id} id={id}></CardRow>) : <div className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11.5px] text-[color:var(--muted)]">B không thêm gì so với A.</div>}
            </div>
            {diff.onlyA.length ? <><div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Chỉ có ở A ({diff.onlyA.length}) — B chưa có</div><div className="mt-1.5 flex flex-col gap-1.5">{diff.onlyA.map((id) => <CardRow key={id} id={id} muted></CardRow>)}</div></> : null}
            {diff.onlyB.length ? <Btn full size="sm" variant="primary" icon="IcArrowDown" onClick={onApplyAll} className="mt-3">Hợp nhất A → B ({diff.onlyB.length} card)</Btn> : null}
          </Card>
        ) : null}
      </div>
      <Card pad={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold text-[color:var(--text)]">Overlay khác biệt trên bản đồ</span>
          <span className="text-[11px] text-[color:var(--muted)]">Vùng tô đậm = nơi B thay đổi so với A</span>
        </div>
        <div className="h-[440px]">
          {window.NetworkMap ? <NetworkMap layers={{ dma: true, pipe: true, valve: true, source: true, node: false, hydrant: false, conn: false, label: false }} emphasis={{ dim: true, pipes: empPipes }} selected={null} onSelect={() => {}} legend={false}></NetworkMap> : null}
        </div>
      </Card>
    </div>
  );
}

/* ---- Fork modal ---- */
function ForkModal({ open, branches, defBase, onClose, onCreate }) {
  const [name, setName] = scU(""); const [base, setBase] = scU(defBase); const [lane, setLane] = scU("future");
  React.useEffect(() => { if (open) { setName(""); setBase(defBase); setLane("future"); } }, [open, defBase]);
  const opts = branches.filter((b) => b.state !== "archived").map((b) => ({ value: b.id, label: b.name + " · " + b.ver }));
  return (
    <Modal open={open} onClose={onClose} title="Tạo nhánh kịch bản mới" subtitle="Nhánh mới kế thừa toàn bộ dữ liệu của base, chỉ lưu phần delta của bạn." icon="IcGitBranch"
      footer={<><Btn variant="ghost" onClick={onClose}>Huỷ</Btn><Btn variant="primary" icon="IcGitBranch" onClick={() => onCreate(name, base, lane)}>Tạo nhánh</Btn></>}>
      <div className="flex flex-col gap-3">
        <Field label="Tên kịch bản" required><TextInput value={name} onChange={setName} placeholder="vd: Mở rộng cấp nước phía Bắc"></TextInput></Field>
        <Field label="Tách từ (base)" hint="Nhánh sẽ dùng dữ liệu từ bản này làm nền."><Select value={base} onChange={setBase} options={opts}></Select></Field>
        <Field label="Vòng đời"><Select value={lane} onChange={setLane} options={[{ value: "future", label: "Tương lai — kịch bản quy hoạch" }, { value: "current", label: "Hiện tại — bản làm việc" }]}></Select></Field>
      </div>
    </Modal>
  );
}

Object.assign(window, { ScenariosScreen, scBranches, scSeed, scLoadBranches, scSaveBranches, scLoadCards, scSaveCard, SC_CARDS, SC_LANES, SC_STATE, effectiveCards });
