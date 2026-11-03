/* GIS — F · Chất lượng & độ phủ dữ liệu không gian.
   GIS tự đo độ tin cậy của dữ liệu nó cung cấp: hoàn thiện thuộc tính, độ phủ RTK, geocoding. */
const { useState: qlU, useMemo: qlM } = React;

function qlHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
// Suy ra "thiếu thuộc tính" theo seed cố định → danh sách cần hoàn thiện khớp với chỉ số
function pipeGaps(p) {
  const h = qlHash(p.id); const g = [];
  if (h % 11 === 0) g.push("Năm lắp");
  if (h % 4 === 0) g.push("Độ sâu chôn");
  if (h % 23 === 0) g.push("Vật liệu");
  if (h % 7 === 0 && !p.trunk) g.push("Cao độ đỉnh ống");
  return g;
}
const QL_ATTRS = ["Đường kính", "Vật liệu", "Năm lắp", "Cao độ đỉnh ống", "Độ sâu chôn"];

function Ring({ pct, size = 96, col }) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  const cc = col || window.tone("#0E7C86");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth="9"></circle>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={cc} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`}></circle>
      <text x="50%" y="50%" dy="0.1em" textAnchor="middle" className="font-mono" fontSize={size * 0.26} fontWeight="700" fill="var(--text)">{pct}</text>
      <text x="50%" y="50%" dy="1.5em" textAnchor="middle" fontSize={size * 0.12} fill="var(--muted)">%</text>
    </svg>
  );
}
function QlMetric({ label, pct, sub, col }) {
  const c = window.tone(col || (pct >= 90 ? "#1A7F37" : pct >= 75 ? "#9A6700" : "#D86C1F"));
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[color:var(--text2)]">{label}</span>
        <span className="font-mono text-[15px] font-semibold" style={{ color: c }}>{pct}%</span>
      </div>
      <div className="mt-2"><ProgressBar pct={pct} tone={c} h={7}></ProgressBar></div>
      {sub ? <div className="mt-1.5 text-[10.5px] text-[color:var(--muted)]">{sub}</div> : null}
    </Card>
  );
}

function QualityScreen({ toast, go }) {
  const G = window.GIS;
  const data = qlM(() => {
    const pipes = G.pipes; const N = pipes.length;
    const miss = Object.fromEntries(QL_ATTRS.map((a) => [a, 0]));
    pipes.forEach((p) => pipeGaps(p).forEach((a) => { if (miss[a] != null) miss[a]++; }));
    const compl = QL_ATTRS.map((a) => ({ label: a, pct: Math.round((1 - miss[a] / N) * 100), miss: miss[a] }));
    const complAvg = Math.round(compl.reduce((s, c) => s + c.pct, 0) / compl.length);
    const byDma = G.dmas.map((d) => { const ps = pipes.filter((p) => p.dma === d.id); const ok = ps.filter((p) => pipeGaps(p).length === 0).length; return { id: d.id, name: d.name, n: ps.length, pct: ps.length ? Math.round((ok / ps.length) * 100) : 100 }; });
    const gaps = pipes.map((p) => ({ p, g: pipeGaps(p) })).filter((x) => x.g.length);
    const score = Math.round(complAvg * 0.6 + G.DASH.rtkPct * 0.2 + G.DASH.geocodedPct * 0.2);
    return { compl, complAvg, byDma, gaps, score, totalGaps: gaps.length };
  }, []);
  const scoreCol = data.score >= 90 ? "#1A7F37" : data.score >= 75 ? "#9A6700" : "#D86C1F";

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6" data-screen-label="Chất lượng dữ liệu">
      <ScreenHead title="Chất lượng dữ liệu không gian" sub="Độ tin cậy GIS cung cấp cho các service — hoàn thiện thuộc tính · RTK · geocoding"
        right={<Btn variant="default" icon="IcDownload" onClick={() => toast("Xuất báo cáo QA dữ liệu (PDF)", "success")}>Xuất báo cáo QA</Btn>}></ScreenHead>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
        <Card>
          <div className="flex items-center gap-4">
            <Ring pct={data.score} col={window.tone(scoreCol)}></Ring>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Điểm chất lượng</div>
              <div className="mt-1 text-[13px] font-medium text-[color:var(--text)]">{data.score >= 90 ? "Rất tốt" : data.score >= 75 ? "Khá" : "Cần cải thiện"}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[color:var(--muted)]">{window.fmtInt(data.totalGaps)} đối tượng còn thiếu thuộc tính</div>
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QlMetric label="Hoàn thiện thuộc tính" pct={data.complAvg} sub="Bình quân 5 trường lõi"></QlMetric>
          <QlMetric label="Độ phủ GPS RTK" pct={G.DASH.rtkPct} sub={"Đấu nối đo bằng RTK · sai số ≤ 5 cm"} col="#0969DA"></QlMetric>
          <QlMetric label="Đã geocode" pct={G.DASH.geocodedPct} sub="Đấu nối gắn toạ độ & DMA" col="#8250DF"></QlMetric>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Hoàn thiện theo thuộc tính (tuyến ống)</div>
          <div className="flex flex-col gap-2.5">
            {data.compl.map((c) => {
              const col = window.tone(c.pct >= 95 ? "#1A7F37" : c.pct >= 80 ? "#9A6700" : "#D86C1F");
              return (
                <div key={c.label}>
                  <div className="mb-1 flex items-center justify-between text-[11.5px]"><span className="text-[color:var(--text2)]">{c.label}</span><span className="font-mono text-[color:var(--muted)]">{c.pct}% {c.miss ? <span style={{ color: col }}>· thiếu {window.fmtInt(c.miss)}</span> : null}</span></div>
                  <ProgressBar pct={c.pct} tone={col} h={7}></ProgressBar>
                </div>
              );
            })}
          </div>
        </Card>

        <Card pad={false}>
          <div className="border-b border-line px-4 py-3 text-[13px] font-semibold text-[color:var(--text)]">Hoàn thiện theo DMA</div>
          <div className="px-2 py-1.5">
            {data.byDma.map((d) => {
              const col = window.tone(d.pct >= 95 ? "#1A7F37" : d.pct >= 85 ? "#9A6700" : "#D86C1F");
              return (
                <div key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <DmaChip dma={d.id} sm></DmaChip>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--text2)]">{d.name}</span>
                  <div className="w-24 shrink-0"><ProgressBar pct={d.pct} tone={col} h={6}></ProgressBar></div>
                  <span className="w-9 shrink-0 text-right font-mono text-[11.5px] font-medium" style={{ color: col }}>{d.pct}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card pad={false} className="mt-3">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold text-[color:var(--text)]">Cần hoàn thiện</span>
          <Badge color={window.tone("#D86C1F")} soft dot>{window.fmtInt(data.totalGaps)} đối tượng</Badge>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-[var(--surface)]"><tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-[color:var(--muted2)]">
              <th className="px-4 py-2 font-semibold">Mã ống</th><th className="px-4 py-2 font-semibold">Tên</th><th className="px-4 py-2 font-semibold">DMA</th><th className="px-4 py-2 font-semibold">Thiếu</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {data.gaps.slice(0, 30).map(({ p, g }) => (
                <tr key={p.id} className="border-b border-line/60 transition-colors hover:bg-[var(--surface2)]">
                  <td className="px-4 py-2 font-mono text-[11.5px] text-[color:var(--text2)]">{p.code}</td>
                  <td className="px-4 py-2 text-[12px] text-[color:var(--text)]">Ống DN{p.dn} · {p.material}</td>
                  <td className="px-4 py-2"><DmaChip dma={p.dma} sm></DmaChip></td>
                  <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{g.map((x) => <span key={x} className="rounded px-1.5 py-[1px] text-[10px] font-medium" style={{ background: window.chex("#D86C1F", window.cTheme() === "light" ? 0.12 : 0.2), color: window.tone("#D86C1F") }}>{x}</span>)}</div></td>
                  <td className="px-4 py-2 text-right"><button onClick={() => go({ name: "map", focusAsset: { type: "pipe", id: p.id } })} className="font-mono text-[11px] font-semibold" style={{ color: window.tone(window.cAccent()) }}>Định vị ↗</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.gaps.length > 30 ? <div className="px-4 py-2.5 text-center font-mono text-[10.5px] text-[color:var(--muted2)]">… +{window.fmtInt(data.gaps.length - 30)} đối tượng khác</div> : null}
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { QualityScreen });
