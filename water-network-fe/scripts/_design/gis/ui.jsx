/* Bản đồ mạng lưới GIS — UI atoms. Load SAU icons. Runtime ở window.GISUI = { theme, tweaks }.
   Accent mặc định = teal (#0E7C86 / #56C7D6) — khối Mạng lưới cấp nước. */
const { useState: gU, useEffect: gE, useRef: gR } = React;

window.GISUI = window.GISUI || { theme: "light", tweaks: {} };
const cTheme = () => window.GISUI.theme;
const cTw = () => window.GISUI.tweaks || {};
const chex = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
const cAccent = () => { const a = cTw().accent; const pair = Array.isArray(a) ? a : ["#0E7C86", "#56C7D6"]; return pair[cTheme() === "light" ? 0 : 1]; };
const tone = (hex) => (cTheme() === "light" ? hex : lighten(hex));
function lighten(hex) {
  const map = { "#1A7F37": "#3FB950", "#0969DA": "#58A6FF", "#8250DF": "#A371F7", "#9A6700": "#E3B341", "#D1242F": "#F85149", "#7E8997": "#9aa4b1", "#0E7C86": "#56C7D6", "#D86C1F": "#E8893E", "#8B949E": "#9aa4b1" };
  return map[hex] || hex;
}
const cnorm = (s) => (s || "").toLowerCase().normalize("NFC");
const rad = () => (cTw().radius != null ? cTw().radius : 9);

function Tile({ icon, col, size = 36, r, glyph }) {
  const C = window[icon] || window.IcGridSq;
  const fg = cTheme() === "light" ? "#fff" : tone(col);
  const bg = cTheme() === "light" ? col : chex(col, 0.16);
  return <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: r != null ? r : rad() * 0.9, background: bg, color: fg }}><C size={glyph || Math.round(size * 0.5)}></C></span>;
}

function Badge({ children, color, soft, mono, dot, className = "" }) {
  const c = color || (cTheme() === "light" ? "#566270" : "#8B949E");
  return (
    <span className={"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-medium " + (mono ? "font-mono " : "") + className}
      style={{ background: soft ? chex(c, cTheme() === "light" ? 0.1 : 0.18) : "transparent", color: c, border: soft ? "none" : `1px solid var(--line)` }}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }}></span> : null}{children}
    </span>
  );
}
function StatusDot({ color, size = 8 }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }}></span>;
}

// GIS pills
function CondPill({ cond, sm }) {
  const c = window.GIS.COND[cond] || window.GIS.COND.good; const col = tone(c.col);
  return <span className={"inline-flex items-center whitespace-nowrap rounded-full font-medium " + (sm ? "px-1.5 py-[1px] text-[10px]" : "px-2 py-[3px] text-[10.5px]")} style={{ background: chex(col, cTheme() === "light" ? 0.12 : 0.2), color: col }}>{c.label}</span>;
}
function AssetTypeChip({ type, sm }) {
  const t = window.GIS.ASSET_TYPES[type]; if (!t) return null; const col = tone(t.col);
  return <span className={"inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium " + (sm ? "px-1.5 py-[1px] text-[10px]" : "px-2 py-[3px] text-[10.5px]")} style={{ background: chex(col, cTheme() === "light" ? 0.12 : 0.2), color: col }}>{React.createElement(window[t.icon], { size: sm ? 10 : 12 })}{t.label}</span>;
}
function DmaChip({ dma, sm }) {
  const d = window.GIS.dmas.find((x) => x.id === dma); if (!d) return null; const col = tone(d.col);
  return <span className={"inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium " + (sm ? "px-1.5 py-[1px] text-[10px]" : "px-2 py-[3px] text-[10.5px]")} style={{ background: chex(col, cTheme() === "light" ? 0.1 : 0.18), color: col }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: col }}></span>{d.id}</span>;
}

function Switch({ on, onChange, disabled, accent }) {
  const ac = accent || cAccent(); const Wd = 38, Hh = 22, K = 16;
  const offBg = cTheme() === "light" ? "#D6DCE3" : "rgba(240,246,252,0.16)";
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
      className="relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
      style={{ width: Wd, height: Hh, background: on ? ac : offBg, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      <span className="absolute rounded-full bg-white transition-transform duration-200" style={{ width: K, height: K, left: 3, transform: on ? `translateX(${Wd - K - 6}px)` : "translateX(0)", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }}></span>
    </button>
  );
}

function Btn({ children, onClick, variant = "default", icon, iconR, danger, type = "button", disabled, full, size = "md", title }) {
  const h = size === "sm" ? "h-8 text-[12px] px-2.5 gap-1" : "h-9 text-[12.5px] px-3.5 gap-1.5";
  let cls = "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed " + h + (full ? " w-full" : "");
  let style = { borderRadius: rad() };
  const ac = cAccent();
  if (variant === "primary") { style.background = danger ? (cTheme() === "light" ? "#D1242F" : "#DA3633") : ac; style.color = danger ? "#fff" : (cTheme() === "light" ? "#fff" : "#06231f"); }
  else if (variant === "ghost") { cls += " text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"; }
  else { cls += " border border-line bg-[var(--surface)] hover:border-[color:var(--text2)]"; style.color = danger ? tone("#D1242F") : "var(--text2)"; }
  const C = icon ? window[icon] : null; const CR = iconR ? window[iconR] : null;
  return <button type={type} title={title} onClick={onClick} disabled={disabled} className={cls} style={style}>{C ? <C size={size === "sm" ? 14 : 15}></C> : null}{children}{CR ? <CR size={size === "sm" ? 14 : 15}></CR> : null}</button>;
}

function Field({ label, required, error, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <label className="flex items-center gap-1 text-[12px] font-medium text-[color:var(--text2)]">{label}{required ? <span style={{ color: tone("#D1242F") }}>*</span> : null}</label> : null}
      {children}
      {error ? <span className="flex items-center gap-1 text-[11px]" style={{ color: tone("#D1242F") }}>{React.createElement(window.IcAlert, { size: 12 })}{error}</span> : hint ? <span className="text-[11px] text-[color:var(--muted2)]">{hint}</span> : null}
    </div>
  );
}
const cInputCls = "h-9 w-full rounded-lg border bg-[var(--surface)] px-3 text-[12.5px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted2)] transition-colors";
function TextInput({ value, onChange, placeholder, error, mono, icon, ...p }) {
  const C = icon ? window[icon] : null;
  return (
    <div className="relative flex items-center">
      {C ? <C size={15} className="pointer-events-none absolute left-3 text-[color:var(--muted2)]"></C> : null}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} {...p}
        className={cInputCls + (mono ? " font-mono" : "") + (C ? " pl-9" : "")} style={{ borderColor: error ? tone("#D1242F") : "var(--line)", borderRadius: rad() }}
        onFocus={(e) => { if (!error) e.target.style.borderColor = cAccent(); }} onBlur={(e) => { if (!error) e.target.style.borderColor = "var(--line)"; }}></input>
    </div>
  );
}
function Select({ value, onChange, options, error }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cInputCls + " appearance-none pr-9"} style={{ borderColor: error ? tone("#D1242F") : "var(--line)", borderRadius: rad() }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {React.createElement(window.IcChevD, { size: 15, className: "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--muted2)]" })}
    </div>
  );
}

function Tabs({ tabs, value, onChange }) {
  const ac = cAccent();
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} className="relative -mb-px flex shrink-0 items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors"
            style={{ color: on ? "var(--text)" : "var(--muted)", borderBottom: on ? `2px solid ${ac}` : "2px solid transparent" }}>
            {t.icon ? React.createElement(window[t.icon], { size: 15 }) : null}{t.label}
            {typeof t.count === "number" ? <span className="rounded-full px-1.5 py-[1px] text-[10px] font-mono" style={{ background: t.badge ? chex(tone("#D1242F"), 0.16) : "var(--surface2)", color: t.badge ? tone("#D1242F") : "var(--muted)" }}>{window.fmtInt(t.count)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
function SegToggle({ options, value, onChange }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-[var(--surface2)] p-0.5" style={{ borderRadius: rad() }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} title={o.title}
            className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors"
            style={{ background: on ? "var(--surface)" : "transparent", color: on ? "var(--text)" : "var(--muted)", boxShadow: on ? "var(--card-shadow)" : "none", borderRadius: rad() - 3 }}>
            {o.icon ? React.createElement(window[o.icon], { size: 14 }) : null}{o.label}
          </button>
        );
      })}
    </div>
  );
}
function ProgressBar({ pct, tone: tn, h = 8, bg = "var(--surface2)" }) {
  const p = Math.max(0, Math.min(100, pct));
  return <div className="w-full overflow-hidden rounded-full" style={{ height: h, background: bg }}><div className="h-full rounded-full transition-all" style={{ width: p + "%", background: tn || cAccent() }}></div></div>;
}
function StackBar({ rows, h = 14 }) {
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-full" style={{ height: h }}>
        {rows.map((r) => <div key={r.label} style={{ width: (r.n / total) * 100 + "%", background: tone(r.col || "#8B949E") }} title={r.label}></div>)}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: tone(r.col || "#8B949E") }}></span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--text2)]">{r.label}</span>
            <span className="shrink-0 font-mono text-[11px] text-[color:var(--muted)]">{r.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({ open, onClose, title, subtitle, icon, accent, children, footer, wide, xwide }) {
  gE(() => { if (!open) return; const h = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open, onClose]);
  if (!open) return null;
  const ac = accent || cAccent();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: cTheme() === "light" ? "rgba(20,30,45,0.34)" : "rgba(0,0,0,0.62)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="crm-modal-in relative my-auto w-full border border-line bg-[var(--surface)]" style={{ maxWidth: xwide ? 880 : wide ? 680 : 480, borderRadius: rad() + 6, boxShadow: "0 24px 64px -16px rgba(0,0,0,0.45)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: chex(ac, cTheme() === "light" ? 0.12 : 0.2), color: tone(ac), borderRadius: rad() }}>{React.createElement(window[icon] || window.IcGridSq, { size: 18 })}</span> : null}
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-[color:var(--text)]">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[11.5px] text-[color:var(--muted)]">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted2)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">{React.createElement(window.IcX, { size: 16 })}</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2.5 border-t border-line px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}

function ToastHost({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => {
        const cols = { success: "#1A7F37", error: "#D1242F", info: "#0969DA" };
        const col = tone(cols[t.kind] || cols.info);
        const ic = t.kind === "success" ? "IcCheckCircle" : t.kind === "error" ? "IcAlert" : "IcInfo";
        return (
          <div key={t.id} className="crm-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-[var(--surface)] px-3.5 py-2.5" style={{ boxShadow: "var(--toast-shadow)" }}>
            <span className="mt-px shrink-0" style={{ color: col }}>{React.createElement(window[ic], { size: 16 })}</span>
            <div className="min-w-0 flex-1 text-[12px] leading-snug text-[color:var(--text)]">{t.msg}</div>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ icon = "IcSearch", title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface2)] text-[color:var(--faint)]">{React.createElement(window[icon], { size: 22 })}</span>
      <div className="text-[13px] font-medium text-[color:var(--text2)]">{title}</div>
      {hint ? <div className="max-w-xs text-[11.5px] text-[color:var(--muted)]">{hint}</div> : null}
      {action || null}
    </div>
  );
}
function KV({ label, children, mono }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-[116px] shrink-0 pt-px text-[12px] text-[color:var(--muted)]">{label}</div>
      <div className={"min-w-0 flex-1 text-[12.5px] text-[color:var(--text)] " + (mono ? "font-mono" : "")}>{children}</div>
    </div>
  );
}
function Card({ children, className = "", pad = true }) {
  return <div className={"rounded-xl border border-line bg-[var(--surface)] " + (pad ? "p-4 " : "") + className} style={{ boxShadow: "var(--card-shadow)", borderRadius: rad() + 2 }}>{children}</div>;
}
function Check({ on, onChange }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }} className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors"
      style={{ borderColor: on ? cAccent() : "var(--line)", background: on ? cAccent() : "transparent", color: cTheme() === "light" ? "#fff" : "#06231f" }}>
      {on ? React.createElement(window.IcCheck, { size: 12, sw: 2.4 }) : null}
    </button>
  );
}
// Khối tiêu đề màn
function ScreenHead({ title, sub, right }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[color:var(--text)]">{title}</h1>
        {sub ? <p className="mt-0.5 text-[12.5px] text-[color:var(--muted)]">{sub}</p> : null}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

Object.assign(window, { cTheme, cTw, chex, cAccent, tone, lighten, cnorm, rad, Tile, Badge, StatusDot, CondPill, AssetTypeChip, DmaChip, Switch, Btn, Field, TextInput, Select, Tabs, SegToggle, ProgressBar, StackBar, Modal, ToastHost, Empty, KV, Card, Check, ScreenHead });
