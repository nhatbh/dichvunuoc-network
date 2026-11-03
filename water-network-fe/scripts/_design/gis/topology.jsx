/* GIS — Topology: kiểm tra & sửa lỗi kết nối (dangling, overshoot, nút trùng, sai cao độ, cô lập…). */
const { useState: tpU, useMemo: tpM } = React;

function TopologyScreen({ toast }) {
  const G = window.GIS;
  const [issues, setIssues] = tpU(() => G.topoIssues.map((t) => ({ ...t })));
  const [sel, setSel] = tpU(null);
  const [kind, setKind] = tpU("all");
  const [status, setStatus] = tpU("open");
  const [running, setRunning] = tpU(false);

  const rows = tpM(() => issues.filter((t) => (kind === "all" || t.kind === kind) && (status === "all" || t.status === status)), [issues, kind, status]);
  const open = issues.filter((t) => t.status === "open");
  const errs = open.filter((t) => G.TOPO_KINDS[t.kind].sev === "error").length;
  const warns = open.filter((t) => G.TOPO_KINDS[t.kind].sev === "warn").length;
  const infos = open.filter((t) => G.TOPO_KINDS[t.kind].sev === "info").length;

  const pins = rows.map((t) => ({ id: t.id, x: t.x, y: t.y, col: window.tone(G.TOPO_KINDS[t.kind].col), shape: "diamond", pulse: sel === t.id, sel: sel === t.id, onClick: () => setSel(t.id) }));
  const selIssue = issues.find((t) => t.id === sel);
  const focus = selIssue ? { x: selIssue.x - 90, y: selIssue.y - 90, w: 180, h: 180, _k: sel } : null;

  const runValidation = () => { setRunning(true); toast("Đang chạy topology validation trên graph engine…"); setTimeout(() => { setRunning(false); toast("Hoàn tất: " + open.length + " vấn đề · " + (errs) + " lỗi nghiêm trọng", "info"); }, 1600); };
  const setIssueStatus = (id, st, msg) => { setIssues((a) => a.map((t) => (t.id === id ? { ...t, status: st } : t))); toast(msg); };

  const kindOpts = [{ value: "all", label: "Mọi loại lỗi" }].concat(Object.entries(G.TOPO_KINDS).map(([k, v]) => ({ value: k, label: v.label })));

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Topology">
      <ScreenHead title="Kiểm tra & sửa lỗi topology" sub="Chỉ dữ liệu sạch topology mới được đồng bộ sang Hydraulic & DMA"
        right={<Btn size="sm" variant="primary" icon={running ? "IcRefresh" : "IcGitBranch"} onClick={runValidation} disabled={running}>{running ? "Đang kiểm tra…" : "Chạy validation"}</Btn>}></ScreenHead>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Lỗi nghiêm trọng", errs, "#D1242F", "IcAlert"], ["Cảnh báo", warns, "#D86C1F", "IcWarnTri"], ["Gợi ý", infos, "#0969DA", "IcInfo"], ["Đã xử lý", issues.filter((t) => t.status === "fixed").length, "#1A7F37", "IcCheckCircle"]].map((s) => (
          <div key={s[0]} className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2 }}>
            <Tile icon={s[3]} col={s[2]} size={38}></Tile>
            <div><div className="font-mono text-[20px] font-semibold leading-none text-[color:var(--text)]">{s[1]}</div><div className="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        {/* list */}
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="flex-1"><Select value={kind} onChange={setKind} options={kindOpts}></Select></div>
            <div className="w-[120px]"><Select value={status} onChange={setStatus} options={[{ value: "open", label: "Đang mở" }, { value: "all", label: "Tất cả" }, { value: "fixed", label: "Đã sửa" }, { value: "ignored", label: "Bỏ qua" }]}></Select></div>
          </div>
          <div className="max-h-[calc(100vh-330px)] overflow-y-auto">
            {rows.map((t) => {
              const K = G.TOPO_KINDS[t.kind]; const on = sel === t.id; const col = window.tone(K.col);
              return (
                <button key={t.id} onClick={() => setSel(t.id)} className="flex w-full items-start gap-2.5 border-t border-line px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]" style={{ background: on ? window.chex(window.cAccent(), 0.08) : "transparent" }}>
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: window.chex(col, 0.14), color: col }}>{React.createElement(window[K.sev === "error" ? "IcAlert" : K.sev === "warn" ? "IcWarnTri" : "IcInfo"], { size: 15 })}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="truncate text-[12.5px] font-medium text-[color:var(--text)]">{K.label}</span>{t.auto ? <Badge color={window.tone("#0E7C86")} soft>auto-fix</Badge> : null}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[color:var(--muted)]"><span className="font-mono">{t.id}</span>·<DmaChip dma={t.dma} sm></DmaChip>{t.status !== "open" ? <span style={{ color: t.status === "fixed" ? window.tone("#1A7F37") : "var(--muted2)" }}>· {t.status === "fixed" ? "đã sửa" : "bỏ qua"}</span> : null}</div>
                  </div>
                </button>
              );
            })}
            {rows.length === 0 ? <Empty icon="IcCheckCircle" title="Sạch topology" hint="Không còn vấn đề theo bộ lọc hiện tại."></Empty> : null}
          </div>
        </Card>

        {/* map + detail */}
        <div className="flex flex-col gap-4">
          <Card pad={false} className="overflow-hidden">
            <div className="h-[360px]"><NetworkMap layers={{ basemap: true, dma: true, pipe: true, valve: true, node: true, source: true }} pins={pins} focus={focus} emphasis={{ dim: !!sel, pipes: selIssue ? [selIssue.ref] : [] }} onBg={() => setSel(null)} controls legend={false}></NetworkMap></div>
          </Card>
          {selIssue ? (() => { const K = G.TOPO_KINDS[selIssue.kind]; const col = window.tone(K.col); return (
            <Card>
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: window.chex(col, 0.14), color: col }}>{React.createElement(window[K.sev === "error" ? "IcAlert" : K.sev === "warn" ? "IcWarnTri" : "IcInfo"], { size: 18 })}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-semibold text-[color:var(--text)]">{K.label}</h3>
                  <p className="mt-0.5 text-[12px] text-[color:var(--muted)]">{K.hint}</p>
                </div>
                <Badge color={col} soft>{K.sev === "error" ? "Lỗi" : K.sev === "warn" ? "Cảnh báo" : "Gợi ý"}</Badge>
              </div>
              <div className="mt-2 flex flex-col">
                <KV label="Đối tượng" mono>{selIssue.ref}</KV>
                <KV label="Vị trí" mono>X {selIssue.x} · Y {selIssue.y}</KV>
                <KV label="DMA"><DmaChip dma={selIssue.dma}></DmaChip></KV>
                <KV label="Phát hiện">{selIssue.auto ? "Tự động khi import" : "Validation thủ công"}</KV>
              </div>
              {selIssue.status === "open" ? (
                <div className="mt-3 flex items-center gap-2">
                  {selIssue.auto ? <Btn size="sm" variant="primary" icon="IcCheck" onClick={() => setIssueStatus(selIssue.id, "fixed", "Đã sửa tự động — tạo change set nháp")}>Sửa tự động</Btn> : <Btn size="sm" variant="primary" icon="IcPencil" onClick={() => setIssueStatus(selIssue.id, "fixed", "Mở công cụ sửa geometry")}>Sửa thủ công</Btn>}
                  <Btn size="sm" variant="ghost" icon="IcEyeOff" onClick={() => setIssueStatus(selIssue.id, "ignored", "Đã bỏ qua vấn đề này")}>Bỏ qua</Btn>
                </div>
              ) : <div className="mt-3 text-[11.5px]" style={{ color: selIssue.status === "fixed" ? window.tone("#1A7F37") : "var(--muted)" }}>{selIssue.status === "fixed" ? "✓ Đã xử lý" : "Đã bỏ qua"}</div>}
            </Card>
          ); })() : (
            <Card><Empty icon="IcGitBranch" title="Chọn một vấn đề topology" hint="Bấm vào danh sách để khoanh vùng trên bản đồ và xem hướng xử lý."></Empty></Card>
          )}
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { TopologyScreen });
