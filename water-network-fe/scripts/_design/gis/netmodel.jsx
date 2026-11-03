/* GIS — B · Mô hình liên thông mạng (connectivity model) + xuất EPANET.
   GIS dựng & kiểm định đồ thị nút–ống, xuất .inp cho service Mô phỏng thuỷ lực. */
const { useState: nmU, useMemo: nmM } = React;

function hwRough(mat) { return ({ "Gang dẻo": 130, "HDPE": 150, "uPVC": 150, "Thép": 120, "Gang xám": 100 })[mat] || 120; }

function nmBuild() {
  const G = window.GIS;
  const live = G.pipes.filter((p) => p.status !== "abandoned");
  const deg = {}; const adj = {};
  G.nodes.forEach((n) => { deg[n.id] = 0; adj[n.id] = []; });
  live.forEach((p) => { if (deg[p.from] != null) { deg[p.from]++; adj[p.from].push(p.to); } if (deg[p.to] != null) { deg[p.to]++; adj[p.to].push(p.from); } });
  const deadEnds = G.nodes.filter((n) => deg[n.id] === 1);
  const isolated = G.nodes.filter((n) => deg[n.id] === 0);
  const seen = {}; let comps = 0, biggest = 0;
  G.nodes.forEach((n) => {
    if (seen[n.id] || deg[n.id] === 0) return;
    comps++; let cnt = 0; const st = [n.id]; seen[n.id] = 1;
    while (st.length) { const c = st.pop(); cnt++; adj[c].forEach((k) => { if (!seen[k]) { seen[k] = 1; st.push(k); } }); }
    biggest = Math.max(biggest, cnt);
  });
  const degDist = [2, 3, 4].map((d) => ({ label: "Bậc " + d, n: G.nodes.filter((n) => deg[n.id] === d).length, col: d === 2 ? "#9A6700" : d === 3 ? "#0E7C86" : "#1A7F37" }));
  return { live, deg, deadEnds, isolated, comps, biggest, degDist, sources: 1 + G.reservoirs.length + G.pumps.length };
}

function nmInp() {
  const G = window.GIS; const live = G.pipes.filter((p) => p.status !== "abandoned");
  let s = "[TITLE]\n Bản đồ mạng lưới GIS — xuất EPANET (" + G.TODAY + ")\n SRID nguồn: " + G.SRID + "\n\n";
  s += "[JUNCTIONS]\n;ID\tElev\tDemand\n";
  G.nodes.forEach((n) => { s += ` ${n.id}\t${n.z}\t0\n`; });
  s += "\n[RESERVOIRS]\n;ID\tHead\n";
  s += ` ${G.plant.id}\t60\n`;
  G.reservoirs.forEach((r) => { s += ` ${r.id}\t${(30 + (r.level / 100) * 8).toFixed(1)}\n`; });
  s += "\n[PIPES]\n;ID\tNode1\tNode2\tLength\tDiam\tRough\n";
  live.forEach((p) => { s += ` ${p.id}\t${p.from}\t${p.to}\t${p.lenM}\t${p.dn}\t${hwRough(p.material)}\n`; });
  s += "\n[COORDINATES]\n;Node\tX\tY\n";
  G.nodes.forEach((n) => { s += ` ${n.id}\t${n.x}\t${G.world.h - n.y}\n`; });
  s += ` ${G.plant.id}\t${G.plant.x}\t${G.world.h - G.plant.y}\n`;
  G.reservoirs.forEach((r) => { s += ` ${r.id}\t${r.x}\t${G.world.h - r.y}\n`; });
  s += "\n[OPTIONS]\n Units\tLPS\n Headloss\tH-W\n\n[END]\n";
  return s;
}
function nmDownload(name, text) {
  const b = new Blob([text], { type: "text/plain;charset=utf-8" }); const u = URL.createObjectURL(b);
  const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}

function NmStat({ label, value, unit, col, alert }) {
  return (
    <Card>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-[26px] font-semibold leading-none" style={{ color: alert ? window.tone("#D86C1F") : (col ? window.tone(col) : "var(--text)") }}>{value}</span>
        {unit ? <span className="text-[12px] text-[color:var(--muted)]">{unit}</span> : null}
      </div>
    </Card>
  );
}

function NetModelScreen({ toast, go }) {
  const G = window.GIS;
  const m = nmM(() => nmBuild(), []);
  const openBy = (kind) => G.topoIssues.filter((t) => t.kind === kind && t.status === "open").length;
  const checks = [
    { k: "disconnect", label: "Liên thông tới nguồn cấp", hint: m.comps + " thành phần · cụm lớn nhất " + window.fmtInt(m.biggest) + " nút" },
    { k: "dangling", label: "Không còn ống treo (dangling)", hint: "Mọi đầu ống đấu vào nút/ống" },
    { k: "overshoot", label: "Không còn ống vượt nút", hint: "Không có đoạn thừa tại giao điểm" },
    { k: "elev", label: "Cao độ nút đầy đủ & hợp lệ", hint: "Phục vụ tính cột áp mô hình" },
    { k: "flow", label: "Đủ van cô lập từng đoạn", hint: "Mỗi đoạn cô lập được khi sửa chữa" },
  ].map((c) => ({ ...c, n: openBy(c.k) }));
  const passN = checks.filter((c) => c.n === 0).length;
  const pins = m.deadEnds.slice(0, 48).map((n) => ({ id: n.id, x: n.x, y: n.y, col: window.tone("#D86C1F"), shape: "diamond" }))
    .concat(m.isolated.slice(0, 12).map((n) => ({ id: "iso" + n.id, x: n.x, y: n.y, col: window.tone("#D1242F"), shape: "diamond", pulse: true })));

  const doExport = () => { nmDownload("water-network.inp", nmInp()); toast("Đã xuất water-network.inp · " + window.fmtInt(G.nodes.length) + " nút · " + window.fmtInt(m.live.length) + " ống", "success"); };

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6" data-screen-label="Mô hình liên thông mạng">
      <ScreenHead title="Mô hình liên thông mạng" sub="Connectivity model · GIS dựng đồ thị nút–ống & xuất sang Mô phỏng thuỷ lực"
        right={<><Btn variant="default" icon="IcExternal" onClick={() => toast("Đẩy mô hình sang service Mô phỏng thuỷ lực", "info")}>Đẩy sang thuỷ lực</Btn><Btn variant="primary" icon="IcDownload" onClick={doExport}>Xuất EPANET (.inp)</Btn></>}></ScreenHead>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <NmStat label="Nút mạng" value={window.fmtInt(G.nodes.length)} unit="nút"></NmStat>
        <NmStat label="Tuyến ống" value={window.fmtInt(m.live.length)} unit="cạnh" col="#0E7C86"></NmStat>
        <NmStat label="Nguồn cấp" value={m.sources} unit="điểm" col="#1A7F37"></NmStat>
        <NmStat label="Nút đầu cuối" value={window.fmtInt(m.deadEnds.length)} unit="cụt" alert={m.deadEnds.length > 0}></NmStat>
        <NmStat label="Thành phần liên thông" value={m.comps} alert={m.comps > 1}></NmStat>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
        <Card pad={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[13px] font-semibold text-[color:var(--text)]">Xem trước mô hình</span>
            <div className="flex items-center gap-3 text-[10.5px] text-[color:var(--muted)]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: window.tone("#D86C1F") }}></span>Nút cụt</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: window.tone("#D1242F") }}></span>Cô lập</span>
            </div>
          </div>
          <div className="h-[360px] w-full overflow-hidden" style={{ borderRadius: "0 0 " + (window.rad() + 2) + "px " + (window.rad() + 2) + "px" }}>
            <NetworkMap layers={{ basemap: true, pipe: true, valve: false, source: true, node: false, dma: true }} pins={pins} paint={{ mode: "dma" }} legend={false} onBg={() => {}}></NetworkMap>
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[color:var(--text)]">Kiểm định mô hình</span>
              <Badge color={window.tone(passN === checks.length ? "#1A7F37" : "#9A6700")} soft dot>{passN}/{checks.length} đạt</Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              {checks.map((c) => {
                const ok = c.n === 0; const col = window.tone(ok ? "#1A7F37" : "#D86C1F");
                return (
                  <div key={c.k} className="flex items-start gap-2.5 rounded-lg px-1 py-1">
                    <span className="mt-px shrink-0" style={{ color: col }}>{React.createElement(ok ? window.IcCheckCircle : window.IcAlert, { size: 16 })}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-[color:var(--text)]">{c.label}</div>
                      <div className="truncate text-[11px] text-[color:var(--muted)]">{c.hint}</div>
                    </div>
                    {c.n > 0 ? <button onClick={() => go({ name: "topology" })} className="shrink-0 font-mono text-[11px] font-semibold" style={{ color: col }}>{c.n} lỗi ↗</button> : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="mb-2.5 text-[13px] font-semibold text-[color:var(--text)]">Phân bố bậc nút</div>
            <StackBar rows={m.degDist} h={12}></StackBar>
          </Card>

          <Card>
            <div className="mb-1 text-[13px] font-semibold text-[color:var(--text)]">Phục vụ dữ liệu</div>
            <p className="mb-2.5 text-[11.5px] leading-relaxed text-[color:var(--muted)]">Mô hình liên thông là đầu ra GIS cung cấp cho các service phân tích. Roughness suy ra theo vật liệu (Hazen-Williams), cao độ lấy từ nút lưới.</p>
            <div className="grid grid-cols-1 gap-2">
              <Btn full size="sm" icon="IcDownload" onClick={doExport}>Xuất EPANET .inp</Btn>
              <div className="grid grid-cols-2 gap-2">
                <Btn size="sm" variant="ghost" icon="IcDownload" onClick={() => { nmDownload("network-topology.geojson", JSON.stringify({ type: "FeatureCollection", srid: G.SRID, features: m.live.length }, null, 0)); toast("Xuất topology GeoJSON", "success"); }}>GeoJSON</Btn>
                <Btn size="sm" variant="ghost" icon="IcLink" onClick={() => toast("Webhook gis.topology.changed đã kích hoạt", "info")}>Event</Btn>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NetModelScreen });
