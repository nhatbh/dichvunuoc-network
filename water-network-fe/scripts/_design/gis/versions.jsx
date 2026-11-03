/* GIS — Phiên bản & phê duyệt change set. Optimistic locking · audit · chỉ bản duyệt mới sync Hydraulic/DMA. */
const { useState: vsU } = React;

const CS_STATUS = { pending: { l: "Chờ duyệt", c: "#9A6700", ic: "IcClock" }, approved: { l: "Đã duyệt", c: "#1A7F37", ic: "IcCheckCircle" }, rejected: { l: "Từ chối", c: "#D1242F", ic: "IcX" }, draft: { l: "Nháp", c: "#8B949E", ic: "IcPencil" } };

function VersionsScreen({ toast }) {
  const G = window.GIS;
  const [sets, setSets] = vsU(() => G.changeSets.map((c) => ({ ...c })));
  const [sel, setSel] = vsU(sets.find((c) => c.status === "pending") ? sets.find((c) => c.status === "pending").id : sets[0].id);
  const cs = sets.find((c) => c.id === sel);
  const act = (id, st, msg) => { setSets((a) => a.map((c) => (c.id === id ? { ...c, status: st, reviewer: "Vũ Phê Duyệt" } : c))); toast(msg); };
  const pending = sets.filter((c) => c.status === "pending").length;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Phiên bản & phê duyệt">
      <ScreenHead title="Phiên bản & phê duyệt" sub="Change set · optimistic locking · audit đầy đủ — chỉ dữ liệu đã duyệt mới đồng bộ sang Hydraulic & DMA"
        right={<Btn size="sm" variant="primary" icon="IcPlus" onClick={() => toast("Tạo change set nháp mới")}>Change set mới</Btn>}></ScreenHead>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Chờ duyệt", pending, "#9A6700", "IcClock"], ["Đã duyệt", sets.filter((c) => c.status === "approved").length, "#1A7F37", "IcCheckCircle"], ["Từ chối", sets.filter((c) => c.status === "rejected").length, "#D1242F", "IcX"], ["Đối tượng thay đổi", sets.reduce((s, c) => s + c.adds + c.mods + c.dels, 0), "#0E7C86", "IcGitBranch"]].map((s) => (
          <div key={s[0]} className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5" style={{ boxShadow: "var(--card-shadow)", borderRadius: window.rad() + 2 }}>
            <Tile icon={s[3]} col={s[2]} size={38}></Tile>
            <div><div className="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{s[1]}</div><div className="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <Card pad={false} className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">Danh sách change set</div>
          <div>
            {sets.map((c) => {
              const S = CS_STATUS[c.status]; const on = sel === c.id; const col = window.tone(S.c);
              return (
                <button key={c.id} onClick={() => setSel(c.id)} className="flex w-full items-start gap-3 border-t border-line px-4 py-3 text-left transition-colors hover:bg-[var(--surface2)]" style={{ background: on ? window.chex(window.cAccent(), 0.08) : "transparent" }}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: window.chex(col, 0.14), color: col }}>{React.createElement(window[S.ic], { size: 16 })}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="font-mono text-[11px] text-[color:var(--muted)]">{c.id}</span><DmaChip dma={c.dma} sm></DmaChip></div>
                    <div className="mt-0.5 truncate text-[12.5px] font-medium text-[color:var(--text)]">{c.title}</div>
                    <div className="mt-1 flex items-center gap-2.5 text-[10.5px]">
                      <span className="text-[color:var(--muted2)]">{c.author} · {c.at}</span>
                      <span className="flex items-center gap-2 font-mono">
                        {c.adds ? <span style={{ color: window.tone("#1A7F37") }}>+{c.adds}</span> : null}
                        {c.mods ? <span style={{ color: window.tone("#9A6700") }}>~{c.mods}</span> : null}
                        {c.dels ? <span style={{ color: window.tone("#D1242F") }}>−{c.dels}</span> : null}
                      </span>
                    </div>
                  </div>
                  <Badge color={col} soft>{S.l}</Badge>
                </button>
              );
            })}
          </div>
        </Card>

        {cs ? (
          <div className="flex flex-col gap-4">
            <Card>
              <div className="flex items-center gap-1.5"><span className="font-mono text-[11px] text-[color:var(--muted)]">{cs.id}</span><Badge color={window.tone(CS_STATUS[cs.status].c)} soft>{CS_STATUS[cs.status].l}</Badge></div>
              <h3 className="mt-1 text-[14px] font-semibold text-[color:var(--text)]">{cs.title}</h3>
              <div className="mt-2 flex flex-col">
                <KV label="Tác giả">{cs.author}</KV>
                <KV label="Thời gian">{cs.at}</KV>
                <KV label="DMA"><DmaChip dma={cs.dma}></DmaChip></KV>
                {cs.reviewer ? <KV label="Người duyệt">{cs.reviewer}</KV> : null}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[["Thêm", cs.adds, "#1A7F37"], ["Sửa", cs.mods, "#9A6700"], ["Xoá", cs.dels, "#D1242F"]].map((s) => <div key={s[0]} className="rounded-lg border border-line py-2"><div className="font-mono text-[16px] font-semibold" style={{ color: window.tone(s[2]) }}>{s[1]}</div><div className="text-[10px] text-[color:var(--muted)]">{s[0]} đối tượng</div></div>)}
              </div>
              {cs.status === "pending" ? (
                <div className="mt-3 flex items-center gap-2">
                  <Btn full variant="primary" icon="IcCheck" onClick={() => act(cs.id, "approved", "Đã duyệt — phát event gis.change-set.approved, sync Hydraulic/DMA")}>Phê duyệt</Btn>
                  <Btn variant="default" danger icon="IcX" onClick={() => act(cs.id, "rejected", "Đã từ chối change set " + cs.id)}>Từ chối</Btn>
                </div>
              ) : cs.status === "approved" ? (
                <div className="mt-3 rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11.5px]" style={{ color: window.tone("#1A7F37") }}>{React.createElement(window.IcExternal, { size: 13, className: "mr-1 inline" })}Đã đồng bộ sang Hydraulic & DMA Management.</div>
              ) : null}
            </Card>
            <Card>
              <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Nhật ký audit</div>
              <div className="relative pl-4">
                <div className="absolute bottom-1 left-[5px] top-1 w-px bg-[var(--line)]"></div>
                {[["Tạo change set", cs.author, cs.at], ["Validate topology", "Hệ thống", "tự động · sạch"], cs.reviewer ? [cs.status === "approved" ? "Phê duyệt" : "Từ chối", cs.reviewer, "vừa xong"] : ["Đang chờ review", "—", "—"]].map((h, i) => (
                  <div key={i} className="relative mb-2.5 last:mb-0">
                    <span className="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: window.cAccent(), background: "var(--surface)" }}></span>
                    <div className="text-[11.5px] font-medium text-[color:var(--text)]">{h[0]}</div>
                    <div className="text-[10.5px] text-[color:var(--muted)]">{h[1]} · {h[2]}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
Object.assign(window, { VersionsScreen });
