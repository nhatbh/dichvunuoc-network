/* Bản đồ mạng lưới GIS — App shell: sidebar + drawer + topbar + router + tweaks.
   Accent teal (khối Mạng lưới cấp nước). */
const { useState: aU, useEffect: aE, useMemo: aMe } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": ["#0E7C86", "#56C7D6"],
  "dark": false,
  "density": "regular",
  "radius": 9
}/*EDITMODE-END*/;

const NAV = [
  { sec: "Tổng quan", items: [{ id: "dashboard", label: "Tổng quan GIS", sub: "Tài sản · topology · luồng dữ liệu", icon: "IcGridSq" }] },
  { sec: "Bản đồ & Tài sản", items: [
    { id: "map", label: "Bản đồ mạng lưới", sub: "Lớp · zoom · inspector", icon: "IcMap" },
    { id: "editor", label: "Biên tập mạng lưới", sub: "Vẽ ống · gắn tài sản · change set", icon: "IcPencil" },
    { id: "assets", label: "Tài sản không gian", sub: "Point · line · polygon", icon: "IcPipe" },
  ] },
  { sec: "Phân tích mạng", items: [
    { id: "topology", label: "Kiểm tra topology", sub: "Dangling · cô lập · cao độ", icon: "IcGitBranch", badge: "topo" },
    { id: "trace", label: "Truy vết & cô lập van", sub: "Isolation · upstream", icon: "IcRoute" },
    { id: "netmodel", label: "Mô hình liên thông", sub: "Connectivity · xuất EPANET", icon: "IcLink" },
  ] },
  { sec: "Khách hàng", items: [
    { id: "connections", label: "Đấu nối khách hàng", sub: "Geocode · gán DMA", icon: "IcPlug" },
  ] },
  { sec: "Dữ liệu & Phiên bản", items: [
    { id: "import", label: "Import khảo sát", sub: "RTK · GeoJSON · Shapefile", icon: "IcUpload", badge: "imp" },
    { id: "quality", label: "Chất lượng dữ liệu", sub: "Hoàn thiện · RTK · độ phủ", icon: "IcShield" },
    { id: "field", label: "Ứng dụng hiện trường", sub: "Offline · đồng bộ · xung đột", icon: "IcMobile", badge: "field" },
    { id: "scenarios", label: "Kịch bản mạng lưới", sub: "Nhánh · phiên bản · so sánh", icon: "IcGitBranch" },
    { id: "versions", label: "Phiên bản & phê duyệt", sub: "Change set · audit", icon: "IcCheckBadge", badge: "cs" },
  ] },
];

const TITLES = { dashboard: "Tổng quan GIS", map: "Bản đồ mạng lưới", editor: "Biên tập mạng lưới", assets: "Tài sản không gian", topology: "Kiểm tra topology", trace: "Truy vết & cô lập van", netmodel: "Mô hình liên thông mạng", connections: "Đấu nối khách hàng", import: "Import khảo sát", quality: "Chất lượng dữ liệu", field: "Ứng dụng hiện trường", scenarios: "Kịch bản mạng lưới", versions: "Phiên bản & phê duyệt" };
const SECOF = {}; NAV.forEach((g) => g.items.forEach((it) => (SECOF[it.id] = g.sec)));

function SidebarInner({ route, go, counts }) {
  const G = window.GIS;
  return (
    <>
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: cAccent(), color: cTheme() === "light" ? "#fff" : "#06231f" }}>{React.createElement(window.IcMap, { size: 19 })}</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-tight text-[color:var(--text)]">Bản đồ mạng lưới</div>
          <div className="truncate text-[10px] text-[color:var(--muted2)]">GIS · Water Platform</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 px-2.5 pb-2">
        {NAV.map((g) => (
          <div key={g.sec}>
            <div className="px-1 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{g.sec}</div>
            {g.items.map((n) => {
              const on = route.name === n.id;
              const cnt = n.badge ? counts[n.badge] : 0;
              return (
                <button key={n.id} onClick={() => go({ name: n.id })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors" style={{ background: on ? "var(--surface-active)" : "transparent" }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: on ? chex(cAccent(), cTheme() === "light" ? 0.14 : 0.22) : "var(--surface2)", color: on ? tone(cAccent()) : "var(--muted)" }}>{React.createElement(window[n.icon], { size: 16 })}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium" style={{ color: on ? "var(--text)" : "var(--text2)" }}>{n.label}</div>
                    <div className="truncate text-[10px] text-[color:var(--muted2)]">{n.sub}</div>
                  </div>
                  {cnt > 0 ? <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold text-white" style={{ background: n.badge === "topo" ? tone("#D1242F") : tone("#9A6700") }}>{cnt}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mx-3 my-3 rounded-xl border border-line bg-[var(--surface2)] p-3" style={{ borderRadius: rad() + 2 }}>
        <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Mạng lưới</span><Badge color={tone("#0E7C86")} soft dot>{G.SRID.split(" ")[0]}</Badge></div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between"><span className="text-[11.5px] text-[color:var(--muted)]">Chiều dài ống</span><span className="font-mono text-[12px] font-medium text-[color:var(--text2)]">{window.fmtDec(G.DASH.pipeKm, 1)} km</span></div>
          <div className="flex items-center justify-between"><span className="text-[11.5px] text-[color:var(--muted)]">Lỗi topology</span><span className="font-mono text-[12px] font-medium" style={{ color: tone("#D1242F") }}>{G.DASH.topoOpen}</span></div>
          <div className="flex items-center justify-between"><span className="text-[11.5px] text-[color:var(--muted)]">Chờ phê duyệt</span><span className="font-mono text-[12px] font-medium" style={{ color: tone("#9A6700") }}>{G.DASH.csPending}</span></div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2.5 border-t border-line p-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: chex(cAccent(), cTheme() === "light" ? 0.14 : 0.22), color: tone(cAccent()) }}>{React.createElement(window.IcUser, { size: 15 })}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] font-medium text-[color:var(--text)]">Lê Biên Tập</div>
          <div className="truncate text-[10px] text-[color:var(--muted2)]">GIS_EDITOR · NETWORK_ENGINEER</div>
        </div>
        <a href="App Menu.html" title="Về cổng ứng dụng" className="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[color:var(--text)]">{React.createElement(window.IcGrid, { size: 15 })}</a>
      </div>
    </>
  );
}

function TopBar({ route, theme, setTheme, go, onMenu, onCmd }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line px-4 py-3 backdrop-blur sm:px-5" style={{ background: cTheme() === "light" ? "rgba(255,255,255,0.85)" : "rgba(13,17,23,0.85)" }}>
      <button onClick={onMenu} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)] md:hidden" style={{ borderRadius: rad() }}>{React.createElement(window.IcLayers, { size: 15 })}</button>
      <nav className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        <span className="hidden text-[color:var(--muted)] sm:inline">{SECOF[route.name]}</span>
        {React.createElement(window.IcChevRight, { size: 13, className: "hidden shrink-0 text-[color:var(--faint)] sm:inline" })}
        <span className="truncate font-semibold text-[color:var(--text)]">{TITLES[route.name]}</span>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onCmd} title="Tìm kiếm (⌘K)" className="flex h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[color:var(--muted)] transition-colors hover:border-[color:var(--text2)] hover:text-[color:var(--text)]" style={{ borderRadius: rad() }}>{React.createElement(window.IcSearch, { size: 15 })}<span className="hidden font-mono text-[11px] text-[color:var(--muted2)] lg:inline">⌘K</span></button>
        <Btn variant="default" size="sm" icon="IcRoute" onClick={() => go({ name: "trace" })} title="Cô lập van"><span className="hidden sm:inline">Cô lập van</span></Btn>
        <Btn variant="primary" size="sm" icon="IcMap" onClick={() => go({ name: "map" })} title="Bản đồ"><span className="hidden sm:inline">Bản đồ</span></Btn>
        <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Đổi giao diện" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)]" style={{ borderRadius: rad() }}>{theme === "light" ? React.createElement(window.IcMoon, { size: 15 }) : React.createElement(window.IcSun, { size: 15 })}</button>
      </div>
    </header>
  );
}

function GisTweaks({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Thương hiệu"></TweakSection>
      <TweakColor label="Màu accent" value={t.accent} options={[["#0E7C86", "#56C7D6"], ["#0969DA", "#58A6FF"], ["#1A7F37", "#3FB950"], ["#8250DF", "#A371F7"], ["#9A6700", "#E3B341"]]} onChange={(v) => setTweak("accent", v)}></TweakColor>
      <TweakToggle label="Giao diện tối" value={t.dark} onChange={(v) => setTweak("dark", v)}></TweakToggle>
      <TweakSection label="Bố cục"></TweakSection>
      <TweakRadio label="Mật độ" value={t.density} options={["compact", "regular", "comfy"]} onChange={(v) => setTweak("density", v)}></TweakRadio>
      <TweakSlider label="Bo góc" value={t.radius} min={4} max={16} unit="px" onChange={(v) => setTweak("radius", v)}></TweakSlider>
    </TweaksPanel>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = t.dark ? "dark" : "light";
  const [route, setRoute] = aU(() => { const h = (window.location.hash || "").replace(/^#/, ""); return { name: h && TITLES[h] ? h : "dashboard" }; });
  const [toasts, setToasts] = aU([]);
  const [drawer, setDrawer] = aU(false);
  const [cmd, setCmd] = aU(false);
  const [branches, setBranches] = aU(() => window.scLoadBranches());

  aE(() => { window.scSaveBranches(branches); }, [branches]);

  window.GISUI = { theme, tweaks: t };
  aE(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  aE(() => { document.documentElement.classList.toggle("crm-dense", t.density === "compact"); document.documentElement.classList.toggle("crm-comfy", t.density === "comfy"); }, [t.density]);
  aE(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setCmd((c) => !c); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const toast = (msg, kind = "info") => { const id = Math.random().toString(36).slice(2); setToasts((a) => [...a, { id, msg, kind }]); setTimeout(() => setToasts((a) => a.filter((x) => x.id !== id)), 3400); };
  const EDITOR_PAGE = "Biên tập mạng lưới.html";
  const go = (r) => {
    if (r && r.name === "editor") {
      window.scSaveBranches(branches);
      let url = EDITOR_PAGE;
      const qs = [];
      if (r.branch) qs.push("branch=" + encodeURIComponent(r.branch));
      if (r.importJob) qs.push("import=" + encodeURIComponent(r.importJob));
      if (qs.length) url += "?" + qs.join("&");
      window.location.href = url;
      return;
    }
    setRoute(r); setDrawer(false); window.scrollTo(0, 0);
  };

  const counts = aMe(() => ({
    topo: window.GIS.DASH.topoOpen,
    cs: window.GIS.DASH.csPending,
    imp: window.GIS.DASH.importPending,
    field: window.GIS.DASH.fieldPending,
  }), []);

  return (
    <div className="min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col overflow-y-auto border-r border-line bg-[var(--surface)] md:flex">
        <SidebarInner route={route} go={go} counts={counts}></SidebarInner>
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-[80] md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)}></div>
          <aside className="crm-menu-in absolute inset-y-0 left-0 flex w-[256px] flex-col overflow-y-auto border-r border-line bg-[var(--surface)]" style={{ boxShadow: "0 16px 50px rgba(0,0,0,0.4)" }}>
            <SidebarInner route={route} go={go} counts={counts}></SidebarInner>
          </aside>
        </div>
      ) : null}

      <div className="md:pl-[244px]">
        <TopBar route={route} theme={theme} setTheme={(th) => setTweak("dark", th === "dark")} go={go} onMenu={() => setDrawer(true)} onCmd={() => setCmd(true)}></TopBar>
        {route.name === "dashboard" ? <DashboardScreen go={go} toast={toast}></DashboardScreen> : null}
        {route.name === "map" ? <MapScreen toast={toast} go={go} focusAsset={route.focusAsset} openQuery={route.openQuery}></MapScreen> : null}
        {route.name === "assets" ? <AssetsScreen toast={toast} go={go}></AssetsScreen> : null}
        {route.name === "topology" ? <TopologyScreen toast={toast}></TopologyScreen> : null}
        {route.name === "trace" ? <TraceScreen toast={toast}></TraceScreen> : null}
        {route.name === "netmodel" ? <NetModelScreen toast={toast} go={go}></NetModelScreen> : null}
        {route.name === "connections" ? <ConnectionsScreen toast={toast}></ConnectionsScreen> : null}
        {route.name === "import" ? <ImportScreen toast={toast} go={go} branchId={route.branch} branches={branches} setBranches={setBranches}></ImportScreen> : null}
        {route.name === "quality" ? <QualityScreen toast={toast} go={go}></QualityScreen> : null}
        {route.name === "field" ? <FieldScreen toast={toast}></FieldScreen> : null}
        {route.name === "scenarios" ? <ScenariosScreen toast={toast} go={go} branches={branches} setBranches={setBranches}></ScenariosScreen> : null}
        {route.name === "versions" ? <VersionsScreen toast={toast}></VersionsScreen> : null}
      </div>
      <ToastHost toasts={toasts}></ToastHost>
      <CommandPalette open={cmd} onClose={() => setCmd(false)} go={go} toast={toast}></CommandPalette>
      <GisTweaks t={t} setTweak={setTweak}></GisTweaks>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App></App>);
