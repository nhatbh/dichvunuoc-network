/* GIS — Truy vết mạng & phân tích cô lập van. Graph engine: chọn van cần đóng để cô lập điểm vỡ. */
const { useState: trU, useMemo: trM } = React;

function TraceScreen({ toast }) {
  const G = window.GIS, ISO = G.isolation;
  const [mode, setMode] = trU("isolation");
  const [ran, setRan] = trU(true);
  const [running, setRunning] = trU(false);

  const targetPipe = G.pipeBy[ISO.target];
  const empPipes = mode === "isolation" ? ISO.affectedPipes : G.pipes.filter((p) => p.dma === targetPipe.dma).slice(0, mode === "upstream" ? 7 : 10).map((p) => p.id);
  const closeValves = new Set(ISO.valves);
  const valveObjs = ISO.valves.map((id) => G.valves.find((v) => v.id === id)).filter(Boolean);

  const emphasis = ran ? { dim: true, pipes: empPipes, valvesClosed: closeValves, valvesOpen: new Set() } : {};
  const pins = [{ id: "target", x: ISO.targetMid[0], y: ISO.targetMid[1], col: window.tone("#D1242F"), pulse: true }];
  const focus = trM(() => ({ x: targetPipe.pts[0][0] - 260, y: targetPipe.pts[0][1] - 200, w: 520, h: 420, _k: mode }), [mode]);

  const run = () => { setRunning(true); setRan(false); toast("Chạy " + (mode === "isolation" ? "phân tích cô lập" : "truy vết") + " bằng graph engine…"); setTimeout(() => { setRunning(false); setRan(true); }, 1300); };

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Truy vết & cô lập">
      <ScreenHead title="Truy vết mạng & cô lập van" sub="Xác định tập van cần đóng và vùng bị ảnh hưởng khi sửa chữa — dùng chung bởi CMMS & Hydraulic"></ScreenHead>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* control + results */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Loại phân tích</div>
            <SegToggle value={mode} onChange={(m) => { setMode(m); setRan(false); }} options={[{ id: "isolation", label: "Cô lập van", icon: "IcValve" }, { id: "upstream", label: "Ngược dòng", icon: "IcArrowUp" }, { id: "downstream", label: "Xuôi dòng", icon: "IcArrowDown" }]}></SegToggle>
            <div className="mt-3 rounded-lg border border-line bg-[var(--surface2)] p-3">
              <div className="flex items-center gap-2"><span style={{ color: window.tone("#D1242F") }}>{React.createElement(window.IcCrosshair, { size: 16 })}</span><span className="text-[12px] font-medium text-[color:var(--text)]">Điểm phân tích</span></div>
              <div className="mt-1.5 flex items-center justify-between text-[11.5px]"><span className="text-[color:var(--muted)]">Tuyến ống vỡ giả định</span><span className="font-mono text-[color:var(--text2)]">{targetPipe.code}</span></div>
              <div className="mt-1 flex items-center justify-between text-[11.5px]"><span className="text-[color:var(--muted)]">DMA</span><DmaChip dma={targetPipe.dma} sm></DmaChip></div>
            </div>
            <div className="mt-3"><Btn full variant="primary" icon={running ? "IcRefresh" : "IcRoute"} onClick={run} disabled={running}>{running ? "Đang chạy graph…" : "Chạy phân tích"}</Btn></div>
          </Card>

          {ran ? (
            <Card>
              <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">{mode === "isolation" ? "Kết quả cô lập" : "Kết quả truy vết"}</div>
              <div className="grid grid-cols-2 gap-2.5">
                {[["Van cần đóng", valveObjs.length, "#D1242F"], ["Đoạn ảnh hưởng", empPipes.length, "#0E7C86"], ["Đấu nối mất nước", ISO.affectedConns, "#9A6700"], ["Dân số ~", Math.round(ISO.estPop), "#8250DF"]].map((s) => (
                  <div key={s[0]} className="rounded-lg border border-line p-2.5"><div className="font-mono text-[19px] font-semibold leading-none" style={{ color: window.tone(s[2]) }}>{window.fmtInt(s[1])}</div><div className="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div></div>
                ))}
              </div>
              {mode === "isolation" ? (
                <>
                  <div className="mb-2 mt-3.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Trình tự đóng van</div>
                  <div className="flex flex-col gap-1.5">
                    {valveObjs.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold" style={{ background: window.chex(window.tone("#D1242F"), 0.14), color: window.tone("#D1242F") }}>{i + 1}</span>
                        <span className="flex-1 font-mono text-[12px] text-[color:var(--text)]">{v.code} · DN{v.dn}</span>
                        <Badge color={window.tone("#0969DA")} soft>{v.kind === "boundary" ? "Van biên" : "Van chặn"}</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Btn size="sm" variant="primary" icon="IcSend" onClick={() => toast("Đã gửi tập van sang CMMS để lập phiếu công việc")}>Gửi CMMS</Btn>
                    <Btn size="sm" variant="ghost" icon="IcDownload" onClick={() => toast("Phát event gis.network-isolation.calculated")}>Xuất</Btn>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--muted)]">Truy vết {mode === "upstream" ? "ngược dòng về nguồn cấp" : "xuôi dòng tới các điểm tiêu thụ"} từ tuyến ống chọn — {empPipes.length} đoạn nằm trên đường truy vết.</p>
              )}
            </Card>
          ) : (
            <Card><Empty icon="IcRoute" title={running ? "Đang tính toán…" : "Chưa có kết quả"} hint="Bấm “Chạy phân tích” để graph engine tính tập van cô lập và vùng ảnh hưởng."></Empty></Card>
          )}
        </div>

        {/* map */}
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold text-[color:var(--text)]">Vùng ảnh hưởng</span>
            <div className="flex items-center gap-3 text-[10.5px] text-[color:var(--muted)]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: window.tone("#D1242F") }}></span>Van đóng</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 rounded" style={{ background: window.cAccent() }}></span>Đoạn cô lập</span>
            </div>
          </div>
          <div className="h-[520px]"><NetworkMap layers={{ basemap: true, dma: true, pipe: true, valve: true, conn: true, source: true }} emphasis={ran ? emphasis : {}} pins={pins} focus={focus} controls legend={false}></NetworkMap></div>
        </Card>
      </div>
    </div>
  );
}
Object.assign(window, { TraceScreen });
