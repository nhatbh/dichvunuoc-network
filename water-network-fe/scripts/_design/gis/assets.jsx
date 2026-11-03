/* GIS — Quản lý tài sản không gian (point / line / polygon). Bảng lọc + bản đồ định vị. */
const { useState: asU, useMemo: asM } = React;

function AssetsScreen({ toast, go }) {
  const G = window.GIS;
  const [type, setType] = asU("all");
  const [dma, setDma] = asU("all");
  const [cond, setCond] = asU("all");
  const [q, setQ] = asU("");
  const [sel, setSel] = asU(null);

  const rows = asM(() => {
    const k = window.cnorm(q);
    return G.assets.filter((a) =>
      (type === "all" || a.type === type) && (dma === "all" || a.dma === dma) && (cond === "all" || a.cond === cond) &&
      (!k || window.cnorm(a.code).includes(k) || window.cnorm(a.name).includes(k))
    );
  }, [type, dma, cond, q]);

  const selAsset = sel ? window.assetIndex()[sel.id] : null;
  const focus = asM(() => {
    if (!selAsset) return null;
    const g = selAsset.geomRef;
    if (selAsset.geom === "point") return { x: g.x - 70, y: g.y - 70, w: 140, h: 140, _k: sel.id };
    if (selAsset.geom === "line") { const xs = g.pts.map((p) => p[0]), ys = g.pts.map((p) => p[1]); return { x: Math.min(...xs) - 20, y: Math.min(...ys) - 20, w: Math.abs(xs[1] - xs[0]) + 40, h: Math.abs(ys[1] - ys[0]) + 40, _k: sel.id }; }
    const xs = g.poly.map((p) => p[0]), ys = g.poly.map((p) => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), _k: sel.id };
  }, [sel]);

  const typeChips = [["all", "Tất cả", G.assets.length]].concat(Object.keys(G.ASSET_TYPES).map((t) => [t, G.ASSET_TYPES[t].label, G.assets.filter((a) => a.type === t).length]));

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Tài sản không gian">
      <ScreenHead title="Quản lý tài sản không gian" sub={window.fmtInt(G.assets.length) + " đối tượng GIS · geometry có lịch sử phiên bản đầy đủ"}
        right={<><Btn size="sm" variant="ghost" icon="IcDownload" onClick={() => toast("Xuất GeoJSON " + rows.length + " đối tượng")}>Xuất</Btn><Btn size="sm" variant="primary" icon="IcPlus" onClick={() => toast("Vẽ tài sản mới trên bản đồ")}>Tài sản mới</Btn></>}></ScreenHead>

      {/* filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {typeChips.map((c) => {
          const on = type === c[0];
          return <button key={c[0]} onClick={() => setType(c[0])} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors" style={{ borderColor: on ? "transparent" : "var(--line)", background: on ? window.cAccent() : "var(--surface)", color: on ? (window.cTheme() === "light" ? "#fff" : "#06231f") : "var(--text2)" }}>{c[1]}<span className="font-mono opacity-70">{c[2]}</span></button>;
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* table */}
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="w-full max-w-[260px]"><TextInput value={q} onChange={setQ} placeholder="Tìm mã / tên tài sản…" icon="IcSearch"></TextInput></div>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-[150px]"><Select value={dma} onChange={setDma} options={[{ value: "all", label: "Mọi DMA" }].concat(G.dmas.map((d) => ({ value: d.id, label: d.id })))}></Select></div>
              <div className="w-[120px]"><Select value={cond} onChange={setCond} options={[{ value: "all", label: "Tình trạng" }].concat(Object.entries(G.COND).map(([k, v]) => ({ value: k, label: v.label })))}></Select></div>
            </div>
          </div>
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 bg-[var(--surface2)] text-[10.5px] uppercase tracking-wider text-[color:var(--muted2)]">
                <tr><th className="px-3 py-2 font-semibold">Mã</th><th className="px-3 py-2 font-semibold">Tên / loại</th><th className="px-3 py-2 font-semibold">DMA</th><th className="px-3 py-2 font-semibold">Tình trạng</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((a) => {
                  const on = sel && sel.id === a.id;
                  return (
                    <tr key={a.id} onClick={() => setSel({ type: a.type, id: a.id })} className="cursor-pointer border-t border-line transition-colors" style={{ background: on ? window.chex(window.cAccent(), 0.08) : "transparent" }}>
                      <td className="px-3 py-2 font-mono text-[11px] text-[color:var(--muted)] whitespace-nowrap">{a.code}</td>
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><span style={{ color: window.tone(G.ASSET_TYPES[a.type].col) }}>{React.createElement(window[G.ASSET_TYPES[a.type].icon], { size: 15 })}</span><span className="truncate text-[12px] font-medium text-[color:var(--text)]" style={{ maxWidth: 200 }}>{a.name}</span></div></td>
                      <td className="px-3 py-2"><DmaChip dma={a.dma} sm></DmaChip></td>
                      <td className="px-3 py-2"><CondPill cond={a.cond} sm></CondPill></td>
                      <td className="px-3 py-2 text-right">{React.createElement(window.IcChevRight, { size: 14, className: "text-[color:var(--faint)]" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? <Empty title="Không có tài sản khớp lọc" hint="Thử bỏ bớt bộ lọc"></Empty> : null}
            {rows.length > 200 ? <div className="border-t border-line px-3 py-2 text-center text-[11px] text-[color:var(--muted2)]">Hiển thị 200 / {window.fmtInt(rows.length)} — thu hẹp bộ lọc để xem tiếp</div> : null}
          </div>
        </Card>

        {/* map + inspector */}
        <div className="flex flex-col gap-4">
          <Card pad={false} className="overflow-hidden">
            <div className="h-[300px]"><NetworkMap layers={{ basemap: true, dma: true, pipe: true, valve: true, hydrant: true, node: true, source: true }} selected={sel} focus={focus} onSelect={setSel} onBg={() => {}} controls legend={false}></NetworkMap></div>
          </Card>
          {selAsset ? (
            <Card>
              <div className="mb-1.5 flex items-center gap-1.5"><AssetTypeChip type={selAsset.type} sm></AssetTypeChip><CondPill cond={selAsset.cond} sm></CondPill><span className="ml-auto font-mono text-[11px] text-[color:var(--muted)]">{selAsset.code}</span></div>
              <h3 className="text-[14px] font-semibold text-[color:var(--text)]">{selAsset.name}</h3>
              <div className="mt-2 flex flex-col">
                {Object.entries(selAsset.attrs).map(([k, v]) => <KV key={k} label={k} mono>{v}</KV>)}
                <KV label="DMA"><DmaChip dma={selAsset.dma}></DmaChip></KV>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Btn size="sm" icon="IcPencil" onClick={() => toast("Sửa geometry — yêu cầu GIS_EDITOR")}>Sửa geometry</Btn>
                <Btn size="sm" variant="ghost" icon="IcMap" onClick={() => go({ name: "map" })}>Xem trên bản đồ</Btn>
              </div>
            </Card>
          ) : (
            <Card><Empty icon="IcPolygon" title="Chọn một tài sản" hint="Bấm dòng trong bảng để định vị trên bản đồ và xem thuộc tính, lịch sử phiên bản."></Empty></Card>
          )}
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { AssetsScreen });
