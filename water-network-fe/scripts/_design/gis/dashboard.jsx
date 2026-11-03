/* GIS — Tổng quan hạ tầng số mạng lưới. */
function GKpi({ k, go }) {
  const col = window.tone(k.col);
  return (
    <button onClick={k.to ? () => go({ name: k.to }) : undefined} className={"flex items-center gap-3.5 rounded-xl border border-line bg-[var(--surface)] p-4 text-left transition-colors " + (k.to ? "hover:border-[color:var(--text2)]" : "")} style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2, cursor: k.to ? "pointer" : "default" }}>
      <Tile icon={k.icon} col={k.col} size={44}></Tile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] text-[color:var(--muted)]">{k.label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="whitespace-nowrap font-mono text-[22px] font-semibold leading-none text-[color:var(--text)]">{k.value}</span>
          {k.unit ? <span className="shrink-0 text-[11px] text-[color:var(--muted2)]">{k.unit}</span> : null}
        </div>
        {k.sub ? <div className="mt-1 truncate text-[10.5px]" style={{ color: col }}>{k.sub}</div> : null}
      </div>
    </button>
  );
}

function DashboardScreen({ go, toast }) {
  const G = window.GIS, D = G.DASH;
  const kpis = [
    { label: "Tổng chiều dài ống", value: window.fmtDec(D.pipeKm, 1), unit: "km", icon: "IcPipe", col: "#0E7C86", sub: D.pipeCount + " tuyến · " + G.MATERIALS.length + " loại vật liệu", to: "assets" },
    { label: "Tài sản điểm", value: window.fmtInt(D.valveCount + D.hydrantCount), unit: "đối tượng", icon: "IcValve", col: "#0969DA", sub: D.valveCount + " van · " + D.hydrantCount + " trụ PCC", to: "assets" },
    { label: "Đấu nối khách hàng", value: window.fmtInt(D.connCount), icon: "IcPlug", col: "#9A6700", sub: D.geocodedPct + "% đã geocode · " + D.rtkPct + "% GPS RTK", to: "connections" },
    { label: "Lỗi topology mở", value: D.topoOpen, icon: "IcGitBranch", col: "#D1242F", sub: "Cần xử lý trước khi đồng bộ Hydraulic", to: "topology" },
  ];
  const queue = [
    { icon: "IcCheckBadge", col: "#8250DF", label: "Change set chờ duyệt", n: D.csPending, to: "versions" },
    { icon: "IcUpload", col: "#0E7C86", label: "Job import đang xử lý", n: D.importPending, to: "import" },
    { icon: "IcMobile", col: "#D86C1F", label: "Bản ghi hiện trường chờ đồng bộ", n: D.fieldPending, to: "field" },
  ];
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-6 sm:px-6" data-screen-label="Tổng quan GIS">
      <ScreenHead title="Tổng quan hạ tầng số mạng lưới" sub={"Bản đồ GIS · tài sản không gian · topology — cập nhật " + G.TODAY}
        right={<><Btn variant="default" size="sm" icon="IcGitBranch" onClick={() => go({ name: "topology" })}>Topology</Btn><Btn variant="primary" size="sm" icon="IcMap" onClick={() => go({ name: "map" })}>Mở bản đồ</Btn></>}></ScreenHead>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">{kpis.map((k) => <GKpi key={k.label} k={k} go={go}></GKpi>)}</div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* map preview */}
        <div className="lg:col-span-2">
          <Card pad={false} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-[13px] font-semibold text-[color:var(--text)]">Bản đồ mạng lưới</span>
              <button onClick={() => go({ name: "map" })} className="flex items-center gap-1 text-[11.5px] font-medium" style={{ color: window.cAccent() }}>Toàn màn hình {React.createElement(window.IcArrowR, { size: 13 })}</button>
            </div>
            <div className="h-[340px]">
              <NetworkMap layers={{ basemap: true, dma: true, pipe: true, valve: true, source: true }} controls={false} legend={false} onSelect={() => go({ name: "map" })} onBg={() => go({ name: "map" })}></NetworkMap>
            </div>
          </Card>
        </div>
        {/* queue */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Hàng đợi xử lý</div>
            <div className="flex flex-col gap-1">
              {queue.map((q) => (
                <button key={q.label} onClick={() => go({ name: q.to })} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]">
                  <Tile icon={q.icon} col={q.col} size={34}></Tile>
                  <span className="min-w-0 flex-1 text-[12px] text-[color:var(--text2)]">{q.label}</span>
                  <span className="rounded-full px-2 py-0.5 font-mono text-[12px] font-semibold" style={{ background: window.chex(window.tone(q.col), 0.14), color: window.tone(q.col) }}>{q.n}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <div className="mb-2.5 text-[13px] font-semibold text-[color:var(--text)]">Vai trò người dùng</div>
            <div className="flex flex-col gap-1.5">
              {G.ROLES.map((r) => (
                <div key={r.id} className="flex items-center gap-2"><span className="font-mono text-[11px] font-medium" style={{ color: window.cAccent() }}>{r.id}</span><span className="ml-auto font-mono text-[11px] text-[color:var(--muted)]">{r.n}</span></div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Tình trạng tuyến ống</div>
          <StackBar rows={D.condMix.map((c) => ({ label: c.label, n: c.n, col: c.col }))}></StackBar>
        </Card>
        <Card>
          <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Vật liệu ống</div>
          <StackBar rows={D.matMix.map((m, i) => ({ label: m.label, n: m.n, col: ["#0E7C86", "#0969DA", "#8250DF", "#D86C1F", "#1A7F37"][i] }))}></StackBar>
        </Card>
        <Card>
          <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Luồng dữ liệu service</div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Đầu vào</div>
          <div className="flex flex-col gap-1.5">
            {G.DATAFLOW.inputs.map((f) => <div key={f.src} className="flex items-center gap-2 text-[11.5px]"><span className="font-mono font-medium text-[color:var(--text2)]">{f.src}</span><span className="text-[color:var(--muted2)]">→</span><span className="text-[color:var(--muted)]">{f.label}</span></div>)}
          </div>
          <div className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Sự kiện phát ra</div>
          <div className="flex flex-wrap gap-1">
            {G.DATAFLOW.outputs.map((o) => <span key={o} className="rounded-md bg-[var(--surface2)] px-1.5 py-0.5 font-mono text-[10px]" style={{ color: window.tone("#0E7C86") }}>{o}</span>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
Object.assign(window, { DashboardScreen });
