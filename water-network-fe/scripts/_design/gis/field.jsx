/* GIS — Ứng dụng hiện trường (offline-first). Đồng bộ bản ghi field, xử lý xung đột phiên bản, gói offline. */
const { useState: fdU } = React;

const SYNC = { synced: { l: "Đã đồng bộ", c: "#1A7F37", ic: "IcCheckCircle" }, pending: { l: "Chờ đồng bộ", c: "#9A6700", ic: "IcClock" }, conflict: { l: "Xung đột", c: "#D1242F", ic: "IcAlert" } };
const PKG = { active: { l: "Sẵn sàng", c: "#1A7F37" }, syncing: { l: "Đang đồng bộ", c: "#0969DA" }, expired: { l: "Hết hạn", c: "#8B949E" } };

function PhoneMock() {
  return (
    <div className="mx-auto w-[176px] shrink-0">
      <div className="rounded-[26px] border-[6px] border-[#1B2733] bg-[#0D1117] p-1.5" style={{ boxShadow: "0 12px 30px -10px rgba(0,0,0,0.45)" }}>
        <div className="relative overflow-hidden rounded-[18px]" style={{ height: 312, background: "#0D1117" }}>
          <div className="h-[120px]"><NetworkMap layers={{ basemap: true, pipe: true, valve: true, conn: true }} theme="dark" controls={false} legend={false} focus={{ x: 600, y: 400, w: 320, h: 260, _k: "ph" }} onBg={() => {}}></NetworkMap></div>
          <div className="flex items-center justify-between px-3 pt-2.5"><span className="text-[10px] font-semibold text-[#E6EDF3]">Hiện trường</span><span className="flex items-center gap-1 rounded-full bg-[#16341f] px-1.5 py-0.5 text-[8px] font-medium text-[#3FB950]"><span className="h-1 w-1 rounded-full bg-[#3FB950]"></span>Offline</span></div>
          <div className="mt-2 flex flex-col gap-1.5 px-3">
            {[["Van rò rỉ ti", "#D29922"], ["Trụ PCC lệch vị trí", "#F85149"], ["Bổ sung đồng hồ", "#58A6FF"]].map((r) => (
              <div key={r[0]} className="flex items-center gap-2 rounded-lg bg-[#161B22] px-2 py-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: r[1] }}></span><span className="text-[9px] text-[#c6cfd9]">{r[0]}</span></div>
            ))}
          </div>
          <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-center gap-1.5 rounded-lg py-1.5" style={{ background: "#0E7C86" }}><span className="text-[10px] font-semibold text-white">+ Ghi nhận tài sản</span></div>
        </div>
      </div>
    </div>
  );
}

function FieldScreen({ toast }) {
  const G = window.GIS;
  const [obs, setObs] = fdU(() => G.fieldObs.map((o) => ({ ...o })));
  const resolve = (id, how) => { setObs((a) => a.map((o) => (o.id === id ? { ...o, sync: "synced" } : o))); toast(how === "server" ? "Giữ phiên bản máy chủ" : "Áp phiên bản hiện trường — đồng bộ EAM/CMMS"); };
  const pending = obs.filter((o) => o.sync === "pending").length;
  const conflict = obs.filter((o) => o.sync === "conflict").length;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Ứng dụng hiện trường">
      <ScreenHead title="Ứng dụng hiện trường" sub="Offline-first · đồng bộ hai chiều EAM/CMMS · xử lý xung đột phiên bản"
        right={<Btn size="sm" variant="primary" icon="IcRefresh" onClick={() => toast("Đồng bộ tất cả bản ghi hiện trường")}>Đồng bộ tất cả</Btn>}></ScreenHead>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Chờ đồng bộ", pending, "#9A6700", "IcClock"], ["Xung đột", conflict, "#D1242F", "IcAlert"], ["Gói offline", G.offlinePkgs.length, "#0E7C86", "IcDownload"], ["Đội hiện trường", 3, "#0969DA", "IcMobile"]].map((s) => (
          <div key={s[0]} className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2 }}>
            <Tile icon={s[3]} col={s[2]} size={38}></Tile>
            <div><div className="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{s[1]}</div><div className="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card pad={false} className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">Bản ghi từ hiện trường</div>
          <div>
            {obs.map((o) => {
              const S = SYNC[o.sync]; const col = window.tone(S.c);
              return (
                <div key={o.id} className="flex items-start gap-3 border-t border-line px-4 py-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: window.chex(col, 0.14), color: col }}>{React.createElement(window[S.ic], { size: 16 })}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="text-[12.5px] font-medium text-[color:var(--text)]">{o.type}</span>{o.photo ? React.createElement(window.IcEye, { size: 12, className: "text-[color:var(--muted2)]" }) : null}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[color:var(--muted)]"><span className="font-mono">{o.id}</span>·<span>{o.by}</span>·<span>{o.at}</span>{o.asset !== "—" ? <><span>·</span><span className="font-mono">{o.asset}</span></> : null}</div>
                    {o.note ? <div className="mt-1 text-[11px] text-[color:var(--text2)]">{o.note}</div> : null}
                    {o.sync === "conflict" ? (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-[var(--surface2)] px-2.5 py-1.5">
                        <span className="text-[10.5px] text-[color:var(--muted)]">Geometry máy chủ ≠ hiện trường</span>
                        <div className="ml-auto flex items-center gap-1.5">
                          <button onClick={() => resolve(o.id, "field")} className="rounded-md px-2 py-1 text-[10.5px] font-medium text-white" style={{ background: window.cAccent() }}>Dùng hiện trường</button>
                          <button onClick={() => resolve(o.id, "server")} className="rounded-md border border-line px-2 py-1 text-[10.5px] font-medium text-[color:var(--text2)]">Giữ máy chủ</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <Badge color={col} soft dot>{S.l}</Badge>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Gói dữ liệu offline</div>
            <div className="flex flex-col gap-2">
              {G.offlinePkgs.map((p) => { const S = PKG[p.state]; const col = window.tone(S.c); return (
                <div key={p.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center gap-2"><span className="text-[12px] font-medium text-[color:var(--text)]">{p.area}</span><DmaChip dma={p.dma} sm></DmaChip><Badge color={col} soft className="ml-auto">{S.l}</Badge></div>
                  <div className="mt-1 flex items-center gap-2 text-[10.5px] text-[color:var(--muted)]"><span className="font-mono">{window.fmtInt(p.assets)} tài sản</span>·<span>{p.size}</span>·<span>{p.by}</span></div>
                </div>
              ); })}
            </div>
            <Btn size="sm" full variant="ghost" icon="IcPlus" onClick={() => toast("Tạo gói offline mới theo DMA")} className="mt-2">Tạo gói offline</Btn>
          </Card>
          <Card><PhoneMock></PhoneMock></Card>
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { FieldScreen });
