/* GIS — Import dữ liệu khảo sát (GPS RTK / GeoJSON / CSV / Shapefile). Bất đồng bộ · rollback theo batch. */
const { useState: imU } = React;

const IMP_STATUS = { done: { l: "Hoàn tất", c: "#1A7F37", ic: "IcCheckCircle" }, running: { l: "Đang chạy", c: "#0969DA", ic: "IcRefresh" }, review: { l: "Chờ rà soát", c: "#9A6700", ic: "IcClock" }, failed: { l: "Thất bại", c: "#D1242F", ic: "IcAlert" } };

function ImportScreen({ toast, go, branchId, branches, setBranches }) {
  const G = window.GIS;
  const [sel, setSel] = imU(G.importJobs.find((j) => j.status === "review") ? G.importJobs.find((j) => j.status === "review").id : G.importJobs[0].id);
  const [drag, setDrag] = imU(false);
  const job = G.importJobs.find((j) => j.id === sel);

  const list = branches || [];
  const byId = Object.fromEntries(list.map((b) => [b.id, b]));
  const editable = list.filter((b) => b.state === "draft" || b.state === "review");
  const defTarget = (branchId && byId[branchId] && (byId[branchId].state === "draft" || byId[branchId].state === "review")) ? branchId : (editable[0] ? editable[0].id : "");
  const JOB_DMA = { "IMP-2041": "DMA-01", "IMP-2040": "DMA-02", "IMP-2039": "DMA-02", "IMP-2038": "DMA-04", "IMP-2037": "DMA-03" };
  const [jobBranch, setJobBranch] = imU({});
  const targetOf = (j) => jobBranch[j.id] || defTarget;
  const guessKind = (f) => { const s = (f || "").toLowerCase(); if (s.includes("van")) return "valve"; if (s.includes("tru") || s.includes("pcc")) return "hydrant"; if (s.includes("daunoi")) return "valve"; return "pipe"; };

  const commitImport = (j) => {
    const tId = targetOf(j); const t = byId[tId];
    if (!t) { toast("Chọn nhánh đích trước khi tạo card", "info"); return; }
    const id = "CS-" + (window.__impSeq = (window.__impSeq || 400) + 1);
    const dma = JOB_DMA[j.id] || "DMA-02";
    const cardTitle = "Import · " + j.file;
    if (window.SC_CARDS) window.SC_CARDS[id] = { title: cardTitle, kind: guessKind(j.file), adds: j.ok, mods: 0, dels: 0, dma, by: j.by };
    const nextVer = "v" + (parseInt(t.ver.slice(1)) + 1);
    if (setBranches) setBranches((bs) => bs.map((b) => (b.id === t.id ? { ...b, cards: [...b.cards, id], ver: nextVer, at: "vừa xong", by: j.by } : b)));
    window.GIS.changeSets.unshift({ id, title: cardTitle, author: j.by, at: "vừa xong", status: "pending", adds: j.ok, mods: 0, dels: 0, dma, reviewer: null });
    window.GIS.DASH.csPending = (window.GIS.DASH.csPending || 0) + 1;
    toast("Đã nạp " + window.fmtInt(j.ok) + " đối tượng vào “" + t.name + "” → " + nextVer, "success");
    if (go) setTimeout(() => go({ name: "scenarios" }), 600);
  };

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Import khảo sát">
      <ScreenHead title="Import dữ liệu khảo sát" sub="GPS RTK · GeoJSON · CSV · Shapefile — mỗi import nạp vào MỘT nhánh dưới dạng card, rồi qua phê duyệt"></ScreenHead>

      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-[var(--surface)] px-3.5 py-2.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2 }}>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--text2)]">{React.createElement(window.IcGitBranch, { size: 15, style: { color: window.tone(window.cAccent()) } })}Nạp vào nhánh</span>
        <div className="min-w-[240px] flex-1 max-w-[360px]">
          {editable.length ? <Select value={targetOf(job)} onChange={(v) => setJobBranch({ ...jobBranch, [sel]: v })} options={editable.map((b) => ({ value: b.id, label: b.name + " · " + b.ver }))}></Select> : <div className="text-[12px] text-[color:var(--muted)]">Chưa có nhánh nháp nào — tạo kịch bản ở màn Kịch bản mạng lưới.</div>}
        </div>
        <span className="text-[11px] text-[color:var(--muted2)]">Import = nguồn thay đổi như biên tập tay · chỉ bản chính thức mới sync ra ngoài</span>
        {go ? <button onClick={() => go({ name: "scenarios" })} className="ml-auto flex items-center gap-1 text-[11.5px] font-medium" style={{ color: window.tone(window.cAccent()) }}>{React.createElement(window.IcLayers, { size: 13 })}Mở Kịch bản</button> : null}
      </div>

      {/* dropzone */}
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); toast("Đã nhận tệp — tạo import job mới (async)"); }}
        className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-7 text-center transition-colors" style={{ borderColor: drag ? window.cAccent() : "var(--line)", background: drag ? window.chex(window.cAccent(), 0.05) : "var(--surface)" }}>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: window.chex(window.cAccent(), 0.12), color: window.cAccent() }}>{React.createElement(window.IcUpload, { size: 22 })}</span>
        <div className="text-[13px] font-medium text-[color:var(--text)]">Kéo thả tệp khảo sát vào đây hoặc <button onClick={() => toast("Mở hộp thoại chọn tệp")} className="font-semibold" style={{ color: window.cAccent() }}>chọn tệp</button></div>
        <div className="text-[11px] text-[color:var(--muted)]">Sẽ nạp vào: <b className="text-[color:var(--text2)]">{byId[targetOf(job)] ? byId[targetOf(job)].name : "— chọn nhánh —"}</b></div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {["GPS RTK", "GeoJSON", "CSV", "Shapefile (.shp)"].map((f) => <span key={f} className="rounded-md bg-[var(--surface2)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--muted)]">{f}</span>)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <Card pad={false} className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">Lịch sử import</div>
          <div className="max-h-[calc(100vh-380px)] overflow-y-auto">
            {G.importJobs.map((j) => {
              const S = IMP_STATUS[j.status]; const on = sel === j.id; const col = window.tone(S.c);
              const okPct = j.rows ? Math.round(j.ok / j.rows * 100) : 0;
              return (
                <button key={j.id} onClick={() => setSel(j.id)} className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left transition-colors hover:bg-[var(--surface2)]" style={{ background: on ? window.chex(window.cAccent(), 0.08) : "transparent" }}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: window.chex(col, 0.14), color: col }}>{React.createElement(window[S.ic], { size: 17 })}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="truncate font-mono text-[12px] font-medium text-[color:var(--text)]">{j.file}</span><Badge soft>{j.fmt}</Badge></div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-[color:var(--muted)]"><span>{j.src}</span>·<span>{j.by}</span>·<span>{j.at}</span></div>
                    {j.status !== "failed" ? <div className="mt-1.5 flex items-center gap-2"><div className="flex-1"><ProgressBar pct={okPct} tone={window.tone(j.err > 0 ? "#9A6700" : "#1A7F37")} h={5}></ProgressBar></div><span className="font-mono text-[10px] text-[color:var(--muted)]">{window.fmtInt(j.ok)}/{window.fmtInt(j.rows)}</span></div> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge color={col} soft>{S.l}</Badge>
                    {j.err > 0 ? <div className="mt-1 font-mono text-[10.5px]" style={{ color: window.tone("#D1242F") }}>{j.err} lỗi</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* detail */}
        <div className="flex flex-col gap-4">
          {job ? (
            <Card>
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: window.chex(window.tone(IMP_STATUS[job.status].c), 0.14), color: window.tone(IMP_STATUS[job.status].c) }}>{React.createElement(window[IMP_STATUS[job.status].ic], { size: 18 })}</span>
                <div className="min-w-0 flex-1"><h3 className="truncate font-mono text-[13px] font-semibold text-[color:var(--text)]">{job.file}</h3><div className="mt-0.5 text-[11px] text-[color:var(--muted)]">{job.id} · {job.src}</div></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[["Bản ghi", job.rows, "#0969DA"], ["Hợp lệ", job.ok, "#1A7F37"], ["Lỗi", job.err, "#D1242F"]].map((s) => <div key={s[0]} className="rounded-lg border border-line py-2"><div className="font-mono text-[16px] font-semibold" style={{ color: window.tone(s[2]) }}>{window.fmtInt(s[1])}</div><div className="text-[10px] text-[color:var(--muted)]">{s[0]}</div></div>)}
              </div>
              {job.err > 0 ? (
                <>
                  <div className="mb-1.5 mt-3.5 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Lỗi validation</span><span className="font-mono text-[10px] text-[color:var(--muted)]">{job.err} dòng</span></div>
                  <div className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto">
                    {G.importErrors.map((e, i) => (
                      <div key={i} className="rounded-lg border border-line px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5 text-[11px]"><span className="font-mono" style={{ color: window.tone("#D1242F") }}>dòng {e.row}</span><Badge soft mono>{e.field}</Badge></div>
                        <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">{e.msg}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : <div className="mt-3 rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11.5px]" style={{ color: window.tone("#1A7F37") }}>{React.createElement(window.IcCheckCircle, { size: 13, className: "mr-1 inline" })}Toàn bộ bản ghi hợp lệ, geometry đúng SRID.</div>}

              <div className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2" style={{ borderRadius: window.rad() }}>
                <span className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--muted)]">{React.createElement(window.IcGitBranch, { size: 14 })}Nạp vào nhánh</span>
                {byId[targetOf(job)] ? <Badge color={window.tone(window.cAccent())} soft dot>{byId[targetOf(job)].name} · {byId[targetOf(job)].ver}</Badge> : <span className="text-[11.5px] text-[color:var(--muted2)]">chưa chọn</span>}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {job.status === "review" || job.status === "done" ? <Btn full variant="primary" icon="IcPencil" onClick={() => go && go({ name: "editor", branch: targetOf(job), importJob: job.id })} disabled={!byId[targetOf(job)]}>Mở trong trình biên tập để rà soát & nối</Btn> : null}
                {job.status === "failed" ? <Btn full variant="primary" icon="IcRefresh" onClick={() => toast("Chạy lại import job")}>Chạy lại</Btn> : null}
                <div className="grid grid-cols-2 gap-2">
                  <Btn size="sm" variant="ghost" icon="IcHistory" onClick={() => toast("Rollback toàn bộ import job " + job.id)}>Rollback toàn bộ</Btn>
                  <Btn size="sm" variant="ghost" icon="IcDownload" onClick={() => toast("Tải báo cáo lỗi (CSV)")}>Báo cáo lỗi</Btn>
                </div>
              </div>
            </Card>
          ) : null}
          <Card>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Ánh xạ trường (Import Mapping)</div>
            {[["geometry", "→ GISFeature.geom"], ["DN", "→ pipe.diameter"], ["material", "→ pipe.material"], ["dma_id", "→ DMA reference"]].map((m) => (
              <div key={m[0]} className="flex items-center gap-2 py-1 text-[11.5px]"><span className="font-mono text-[color:var(--text2)]">{m[0]}</span><span className="text-[color:var(--muted2)]">{m[1]}</span></div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { ImportScreen });
