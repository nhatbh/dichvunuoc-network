/* GIS — Đấu nối khách hàng. Nhận khách từ CIS/Billing, geocode & gán vào DMA. Chỉ lưu mã tham chiếu. */
const { useState: cnU, useMemo: cnM } = React;

function ConnStatusPill({ st }) {
  const M = { active: { l: "Đang cấp", c: "#1A7F37" }, pending: { l: "Chờ đấu nối", c: "#9A6700" }, review: { l: "Chờ duyệt vị trí", c: "#0969DA" } };
  const s = M[st] || M.active; const col = window.tone(s.c);
  return <Badge color={col} soft dot>{s.l}</Badge>;
}

function ConnectionsScreen({ toast }) {
  const G = window.GIS;
  const [dma, setDma] = cnU("all");
  const [type, setType] = cnU("all");
  const [status, setStatus] = cnU("all");
  const [q, setQ] = cnU("");
  const [sel, setSel] = cnU(null);

  const rows = cnM(() => {
    const k = window.cnorm(q);
    return G.connections.filter((c) => (dma === "all" || c.dma === dma) && (type === "all" || c.type === type) && (status === "all" || c.status === status) && (!k || window.cnorm(c.name).includes(k) || c.danhbo.includes(q) || window.cnorm(c.meter).includes(k)));
  }, [dma, type, status, q]);

  const selConn = G.connections.find((c) => c.id === sel);
  const focus = selConn ? { x: selConn.x - 80, y: selConn.y - 80, w: 160, h: 160, _k: sel } : null;
  const pins = selConn ? [{ id: sel, x: selConn.x, y: selConn.y, col: window.tone(G.CTYPE[selConn.type].col), pulse: true }] : [];

  const geocoded = Math.round(G.connections.filter((c) => c.geocoded).length / G.connections.length * 100);
  const pendingN = G.connections.filter((c) => c.status !== "active").length;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Đấu nối khách hàng">
      <ScreenHead title="Đấu nối khách hàng" sub="Đồng bộ từ CIS/Billing · geocode & gán vào DMA · chỉ lưu mã tham chiếu, không dữ liệu thương mại"
        right={<><Btn size="sm" variant="ghost" icon="IcRefresh" onClick={() => toast("Đồng bộ đấu nối mới từ CIS/Billing")}>Đồng bộ CIS</Btn><Btn size="sm" variant="primary" icon="IcCrosshair" onClick={() => toast("Gán DMA tự động theo vị trí cho " + pendingN + " đấu nối")}>Tự gán DMA</Btn></>}></ScreenHead>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Tổng đấu nối", window.fmtInt(G.connections.length), "#9A6700", "IcPlug"], ["Đã geocode", geocoded + "%", "#1A7F37", "IcCrosshair"], ["GPS RTK", G.DASH.rtkPct + "%", "#0E7C86", "IcSatellite"], ["Chờ xử lý", pendingN, "#0969DA", "IcClock"]].map((s) => (
          <div key={s[0]} className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2 }}>
            <Tile icon={s[3]} col={s[2]} size={38}></Tile>
            <div><div className="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{s[1]}</div><div className="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <Card pad={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="w-full max-w-[220px]"><TextInput value={q} onChange={setQ} placeholder="Danh bộ / tên / đồng hồ…" icon="IcSearch"></TextInput></div>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-[130px]"><Select value={dma} onChange={setDma} options={[{ value: "all", label: "Mọi DMA" }].concat(G.dmas.map((d) => ({ value: d.id, label: d.id })))}></Select></div>
              <div className="w-[130px]"><Select value={type} onChange={setType} options={[{ value: "all", label: "Mọi loại" }].concat(Object.entries(G.CTYPE).map(([k, v]) => ({ value: k, label: v.label })))}></Select></div>
              <div className="w-[140px]"><Select value={status} onChange={setStatus} options={[{ value: "all", label: "Mọi trạng thái" }, { value: "active", label: "Đang cấp" }, { value: "pending", label: "Chờ đấu nối" }, { value: "review", label: "Chờ duyệt vị trí" }]}></Select></div>
            </div>
          </div>
          <div className="max-h-[calc(100vh-330px)] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 bg-[var(--surface2)] text-[10.5px] uppercase tracking-wider text-[color:var(--muted2)]">
                <tr><th className="px-3 py-2 font-semibold">Danh bộ</th><th className="px-3 py-2 font-semibold">Khách hàng</th><th className="px-3 py-2 font-semibold">DMA</th><th className="px-3 py-2 font-semibold">Đồng hồ</th><th className="px-3 py-2 font-semibold">Trạng thái</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((c) => {
                  const on = sel === c.id;
                  return (
                    <tr key={c.id} onClick={() => setSel(c.id)} className="cursor-pointer border-t border-line transition-colors" style={{ background: on ? window.chex(window.cAccent(), 0.08) : "transparent" }}>
                      <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--text2)]">{c.danhbo}</td>
                      <td className="px-3 py-2"><div className="truncate text-[12px] font-medium text-[color:var(--text)]" style={{ maxWidth: 170 }}>{c.name}</div><div className="truncate text-[10px] text-[color:var(--muted2)]" style={{ maxWidth: 170 }}>{c.addr}</div></td>
                      <td className="px-3 py-2"><DmaChip dma={c.dma} sm></DmaChip></td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[color:var(--muted)] whitespace-nowrap">{c.meter}</td>
                      <td className="px-3 py-2"><ConnStatusPill st={c.status}></ConnStatusPill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? <Empty title="Không có đấu nối khớp lọc"></Empty> : null}
            {rows.length > 200 ? <div className="border-t border-line px-3 py-2 text-center text-[11px] text-[color:var(--muted2)]">Hiển thị 200 / {window.fmtInt(rows.length)}</div> : null}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card pad={false} className="overflow-hidden"><div className="h-[280px]"><NetworkMap layers={{ basemap: true, dma: true, pipe: true, conn: true, source: true }} pins={pins} focus={focus} controls legend={false} onBg={() => {}}></NetworkMap></div></Card>
          {selConn ? (
            <Card>
              <div className="mb-1.5 flex items-center gap-1.5"><Badge color={window.tone(G.CTYPE[selConn.type].col)} soft>{G.CTYPE[selConn.type].label}</Badge><ConnStatusPill st={selConn.status}></ConnStatusPill></div>
              <h3 className="text-[14px] font-semibold text-[color:var(--text)]">{selConn.name}</h3>
              <div className="mt-2 flex flex-col">
                <KV label="Danh bộ (CIS)" mono>{selConn.danhbo}</KV>
                <KV label="Địa chỉ">{selConn.addr}</KV>
                <KV label="Đồng hồ" mono>{selConn.meter} · DN{selConn.dn}</KV>
                <KV label="DMA"><DmaChip dma={selConn.dma}></DmaChip></KV>
                <KV label="Định vị"><span className="inline-flex items-center gap-2">{selConn.geocoded ? <Badge color={window.tone("#1A7F37")} soft dot>Đã geocode</Badge> : <Badge color={window.tone("#D86C1F")} soft dot>Chưa geocode</Badge>}{selConn.gpsRtk ? <Badge color={window.tone("#0E7C86")} soft>RTK</Badge> : null}</span></KV>
              </div>
              <div className="mt-3 rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11px] text-[color:var(--muted)]">{React.createElement(window.IcShield, { size: 13, className: "mr-1 inline" })}Chỉ lưu mã tham chiếu danh bộ — dữ liệu cước & thương mại nằm ở CIS/Billing.</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Btn size="sm" icon="IcCrosshair" onClick={() => toast("Cập nhật vị trí đấu nối từ GPS RTK")}>Sửa vị trí</Btn>
                <Btn size="sm" variant="ghost" icon="IcExternal" onClick={() => toast("Mở hồ sơ khách hàng trong CIS")}>CIS</Btn>
              </div>
            </Card>
          ) : (
            <Card><Empty icon="IcPlug" title="Chọn một đấu nối" hint="Bấm dòng để định vị điểm đấu nối trên bản đồ và xem chi tiết."></Empty></Card>
          )}
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { ConnectionsScreen });
