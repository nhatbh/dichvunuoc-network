/* Bản đồ mạng lưới GIS — icon registry (SolidJS port of menu-icons.jsx + icons-gis.jsx).
   Every Ic* the design references via `window.IcX` lives here; data references icons
   by string name (nav `icon:"IcMap"`, ASSET_TYPES `icon:"IcPipe"`) — resolve via iconByName. */
import type { JSX } from 'solid-js'

export interface IconProps {
  size?: number
  sw?: number
  class?: string
  className?: string
  style?: JSX.CSSProperties
}

export type IconComponent = (p: IconProps) => JSX.Element

// SolidJS: JSX evaluates to real DOM nodes (not React descriptors), so a node can
// only live in ONE place. Icons are reused many times across the app — pass the
// children as a THUNK and call it per render so each icon instance gets fresh nodes.
// (Passing an already-evaluated JSX element makes all-but-one instance render empty.)
function mk(children: () => JSX.Element): IconComponent {
  return (p: IconProps) => {
    const size = p.size ?? 16
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        stroke-width={p.sw ?? 1.7}
        stroke-linecap="round"
        stroke-linejoin="round"
        class={p.class ?? p.className}
        style={p.style}
        aria-hidden="true"
      >
        {children()}
      </svg>
    )
  }
}

/* ── menu-icons.jsx ── */
export const IcGrid = mk(() => <g><rect x="3" y="3" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" /></g>)
export const IcBell = mk(() => <g><path d="M6.2 9.3a5.8 5.8 0 0 1 11.6 0c0 5.5 2.2 7 2.2 7H4s2.2-1.5 2.2-7z" /><path d="M10.6 20a1.9 1.9 0 0 0 2.8 0" /></g>)
export const IcDroplet = mk(() => <path d="M12 3.5c3.2 4.3 5.8 7.2 5.8 10.5a5.8 5.8 0 0 1-11.6 0C6.2 10.7 8.8 7.8 12 3.5z" />)
export const IcZap = mk(() => <polygon points="13 2.5 4.5 14 11 14 10.2 21.5 19.5 9.5 13 9.5" />)
export const IcFlask = mk(() => <g><path d="M9 3h6" /><path d="M10 3v5.2L4.9 17.6A2 2 0 0 0 6.7 20.5h10.6a2 2 0 0 0 1.8-2.9L14 8.2V3" /><path d="M7.3 15h9.4" /></g>)
export const IcMonitor = mk(() => <g><rect x="2.5" y="4" width="19" height="12.5" rx="1.5" /><path d="M9 21h6" /><path d="M12 16.5V21" /></g>)
export const IcWarnTri = mk(() => <g><path d="M12 3.2 2.6 19.4h18.8L12 3.2z" /><path d="M12 9.5v4.2" /><path d="M12 16.7v.01" /></g>)
export const IcLayers = mk(() => <g><path d="m12 3 9 4.8-9 4.8-9-4.8L12 3z" /><path d="m4 13.4 8 4.3 8-4.3" /></g>)
export const IcUser = mk(() => <g><circle cx="12" cy="8.2" r="3.4" /><path d="M5.2 20c1.4-3.4 3.9-5 6.8-5s5.4 1.6 6.8 5" /></g>)
export const IcChevR = mk(() => <path d="m9.5 6 6 6-6 6" />)
export const IcChevL = mk(() => <path d="m14.5 6-6 6 6 6" />)
export const IcPin = mk(() => <g><path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21z" /><circle cx="12" cy="11" r="2.2" /></g>)
export const IcGauge = mk(() => <g><path d="M5 18.5a8.7 8.7 0 1 1 14 0" /><path d="M12 13.5 15.5 10" /></g>)
export const IcActivity = mk(() => <path d="M3 12h3.5L10 5.5 14 18.5 17.5 12H21" />)
export const IcWrench = mk(() => <path d="M14.5 6.5a4.5 4.5 0 0 0-6 6L3 18l3 3 5.5-5.5a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.5-3.5z" />)
export const IcSend = mk(() => <g><path d="M21 3 10.5 13.5" /><path d="M21 3l-7 18-3.5-7.5L3 10l18-7z" /></g>)
export const IcFile = mk(() => <g><path d="M6 2.5h8l4 4V21.5H6V2.5z" /><path d="M14 2.5v4h4" /></g>)
export const IcFactory = mk(() => <g><path d="M3 21V9l5 3.5V9l5 3.5V9l5 3.5V21H3z" /><path d="M3 21h18" /><path d="M7 21v-3.5" /><path d="M11 21v-3.5" /><path d="M15 21v-3.5" /></g>)
export const IcReceipt = mk(() => <g><path d="M5 3.5h14v17l-2.3-1.4L14.3 20l-2.3-1.4L9.7 20l-2.4-1.4L5 20.5v-17z" /><path d="M8.5 8h7" /><path d="M8.5 12h7" /></g>)
export const IcDollar = mk(() => <g><path d="M12 2.5v19" /><path d="M16.5 6.5c-1-1.3-2.7-2-4.5-2-2.5 0-4.5 1.3-4.5 3.4 0 4.4 9 2.2 9 6.6 0 2.1-2 3.5-4.5 3.5-1.9 0-3.6-.8-4.6-2.2" /></g>)
export const IcWaves = mk(() => <g><path d="M2 9c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0" /><path d="M2 15c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0" /></g>)
export const IcTank = mk(() => <g><ellipse cx="12" cy="5.2" rx="6.8" ry="2.4" /><path d="M5.2 5.2v13.6c0 1.3 3 2.4 6.8 2.4s6.8-1.1 6.8-2.4V5.2" /><path d="M5.2 12c0 1.3 3 2.4 6.8 2.4s6.8-1.1 6.8-2.4" /></g>)
export const IcSliders = mk(() => <g><path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" /><path d="M4 12h2" /><path d="M10 12h10" /><circle cx="8" cy="12" r="2" /><path d="M4 18h12" /><path d="M20 18h0.01" /><circle cx="18" cy="18" r="2" /></g>)
export const IcCube = mk(() => <g><path d="m12 2.6 8.4 4.7v9.4L12 21.4 3.6 16.7V7.3L12 2.6z" /><path d="m3.6 7.3 8.4 4.7 8.4-4.7" /><path d="M12 12v9.4" /></g>)
export const IcPipe = mk(() => <g><path d="M3 8.5h11a3.5 3.5 0 0 1 3.5 3.5v9" /><path d="M3 5.5v6" /><path d="M14.5 17.5h6" /></g>)
export const IcSpray = mk(() => <g><path d="M9 8.5h6v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-11z" /><path d="M10.5 8.5V5.5h3v3" /><path d="M16.5 4.5h.01" /><path d="M19 6h.01" /><path d="M19.5 9h.01" /><path d="M16.5 10.5h.01" /></g>)
export const IcClipboard = mk(() => <g><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5a3 3 0 0 1 6 0" /><path d="M9 11h6" /><path d="M9 15h4" /></g>)
export const IcTarget = mk(() => <g><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></g>)
export const IcSparkle = mk(() => <g><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" /></g>)
export const IcArrowR = mk(() => <g><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></g>)
export const IcExternal = mk(() => <g><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11" /></g>)
export const IcLayoutRows = mk(() => <g><rect x="3.5" y="4" width="17" height="6" rx="1.2" /><rect x="3.5" y="14" width="17" height="6" rx="1.2" /></g>)
export const IcLayoutSide = mk(() => <g><rect x="3.5" y="4" width="6" height="16" rx="1.2" /><rect x="12" y="4" width="8.5" height="16" rx="1.2" /></g>)
export const IcLayoutList = mk(() => <g><path d="M8 6h12" /><path d="M8 12h12" /><path d="M8 18h12" /><circle cx="4.3" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.3" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.3" cy="18" r="1.1" fill="currentColor" stroke="none" /></g>)
export const IcSun = mk(() => <g><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" /></g>)
export const IcMoon = mk(() => <path d="M20 14.2A8 8 0 1 1 9.8 4 6.3 6.3 0 0 0 20 14.2z" />)
export const IcHeadset = mk(() => <g><path d="M4 13.5v-1.5a8 8 0 0 1 16 0v1.5" /><rect x="2.5" y="13" width="3.5" height="6" rx="1.2" /><rect x="18" y="13" width="3.5" height="6" rx="1.2" /><path d="M20 19v.6a3 3 0 0 1-3 3h-3" /></g>)
export const IcCheck = mk(() => <path d="m5 12.5 4.2 4.2L19 6.8" />)
export const IcInbox = mk(() => <g><path d="M3 12.5h5l1.6 2.6h4.8L16 12.5h5" /><path d="M5.4 5.5h13.2l2.4 7v6H3v-6l2.4-7z" /></g>)
export const IcBriefcase = mk(() => <g><rect x="3" y="7.5" width="18" height="12" rx="2" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" /><path d="M3 12.5h18" /></g>)

/* ── icons-gis.jsx (generic + GIS) ── */
export const IcChevD = mk(() => <path d="m6 9.5 6 6 6-6" />)
export const IcChevU = mk(() => <path d="m6 14.5 6-6 6 6" />)
export const IcAlert = mk(() => <g><path d="M12 8v5" /><path d="M12 16.5v.01" /><circle cx="12" cy="12" r="9" /></g>)
export const IcInfo = mk(() => <g><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8v.01" /></g>)
export const IcCheckCircle = mk(() => <g><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></g>)
export const IcX = mk(() => <g><path d="M6 6l12 12" /><path d="M18 6L6 18" /></g>)
export const IcPlus = mk(() => <g><path d="M12 5v14" /><path d="M5 12h14" /></g>)
export const IcMinus = mk(() => <path d="M5 12h14" />)
export const IcSearch = mk(() => <g><circle cx="11" cy="11" r="6.8" /><path d="m20.5 20.5-4.2-4.2" /></g>)
export const IcFilter = mk(() => <path d="M3 5.5h18l-7 8.5v5l-4 2v-7L3 5.5z" />)
export const IcEye = mk(() => <g><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.7" /></g>)
export const IcEyeOff = mk(() => <g><path d="M4 4l16 16" /><path d="M9.5 5.7A10 10 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-3.3 4M6.5 7.6A17 17 0 0 0 2 12s3.6 6.5 10 6.5a10 10 0 0 0 3-.5" /><path d="M9.8 9.8a3 3 0 0 0 4.3 4.2" /></g>)
export const IcPencil = mk(() => <g><path d="M16.5 3.8a2 2 0 0 1 2.8 2.8L7 19l-4 1 1-4 12.5-12.2z" /><path d="M14.5 5.8l2.9 2.9" /></g>)
export const IcTrash = mk(() => <g><path d="M4 7h16" /><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" /><path d="M6 7l1 13h10l1-13" /></g>)
export const IcClock = mk(() => <g><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g>)
export const IcRefresh = mk(() => <g><path d="M20 11a8 8 0 0 0-14-4.5L3.5 9" /><path d="M4 13a8 8 0 0 0 14 4.5L20.5 15" /><path d="M3.5 4.5V9H8M20.5 19.5V15H16" /></g>)
export const IcMore = mk(() => <g><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" /></g>)
export const IcDownload = mk(() => <g><path d="M12 3.5v11M7.5 10l4.5 4.5L16.5 10" /><path d="M5 20.5h14" /></g>)
export const IcUpload = mk(() => <g><path d="M12 20.5v-11M7.5 14l4.5-4.5L16.5 14" /><path d="M5 3.5h14" /></g>)
export const IcChevRight = mk(() => <path d="m9.5 6 6 6-6 6" />)
export const IcExpand = mk(() => <g><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></g>)
export const IcValve = mk(() => <g><circle cx="12" cy="12" r="3.4" /><path d="M12 8.6V4M12 20v-4.6M8.6 12H4M20 12h-4.6" /><path d="M9.6 9.6 7 7M17 7l-2.6 2.6M9.6 14.4 7 17M17 17l-2.6-2.6" /></g>)
export const IcHydrant = mk(() => <g><path d="M8.5 9a3.5 3.5 0 0 1 7 0v7.5h-7V9z" /><path d="M7 16.5h10" /><path d="M6.5 20h11" /><path d="M7 16.5l-.5 3.5M17 16.5l.5 3.5" /><circle cx="12" cy="11.5" r="1.4" /><path d="M9 6.5l-1.5-1M15 6.5l1.5-1" /></g>)
export const IcNode = mk(() => <g><circle cx="12" cy="12" r="3" /><path d="M12 9V4M12 20v-5M9 12H4M20 12h-5" /></g>)
export const IcPump = mk(() => <g><circle cx="11" cy="13" r="5" /><path d="M11 13l3-3" /><path d="M11 8V4h5" /><path d="M16 4v5" /><path d="M6 17l-2 3" /></g>)
export const IcPolygon = mk(() => <path d="M12 3l8 5.5-3 10.5H7L4 8.5 12 3z" />)
export const IcLineGeom = mk(() => <g><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M6.5 17.5 17.5 6.5" /></g>)
export const IcRuler = mk(() => <g><rect x="2.5" y="8" width="19" height="8" rx="1.5" transform="rotate(-45 12 12)" /><path d="M9 7.5l1.5 1.5M11.5 10l1 1M14 7.5l1.5 1.5M7 10l1 1" /></g>)
export const IcCrosshair = mk(() => <g><circle cx="12" cy="12" r="8" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></g>)
export const IcRoute = mk(() => <g><circle cx="6" cy="18.5" r="2.4" /><circle cx="18" cy="5.5" r="2.4" /><path d="M8 17.5c5-1 8.5-4 8.5-9" /><path d="M6 16V12a3 3 0 0 1 3-3h3" /></g>)
export const IcGitBranch = mk(() => <g><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" /><path d="M6 8.4v7.2" /><path d="M18 10.4c0 4-3.5 4.6-6 5" /></g>)
export const IcCheckBadge = mk(() => <g><path d="m12 3 2.1 1.5 2.6-.2 1 2.4 2.2 1.4-.6 2.5 1.1 2.3-1.7 2 .1 2.6-2.5.6-1.5 2.1-2.4-.9-2.4.9-1.5-2.1-2.5-.6.1-2.6-1.7-2 1.1-2.3-.6-2.5L4.3 6.7l1-2.4 2.6.2L10 3z" /><path d="m9.5 12 1.8 1.8 3.5-3.8" /></g>)
export const IcMobile = mk(() => <g><rect x="6.5" y="2.5" width="11" height="19" rx="2.4" /><path d="M10.5 18.5h3" /></g>)
export const IcSatellite = mk(() => <g><path d="M9.5 7.5 7 5l-3 3 2.5 2.5" /><path d="m6.5 10.5 7 7" /><path d="M14 17.5 16.5 20l3-3-2.5-2.5" /><path d="M15 5a4 4 0 0 1 4 4" /><path d="M11.5 12.5 9 15" /></g>)
export const IcMap = mk(() => <g><path d="m3 6.5 6-2.5 6 2.5 6-2.5v14L15 20l-6-2.5L3 20v-14z" /><path d="M9 4v13.5M15 6.5V20" /></g>)
export const IcGlobe = mk(() => <g><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.3-3.6-8.5S9.6 5.8 12 3.5z" /></g>)
export const IcPlug = mk(() => <g><path d="M9 3v5M15 3v5" /><path d="M7 8h10v3a5 5 0 0 1-10 0V8z" /><path d="M12 16v5" /></g>)
export const IcShield = mk(() => <g><path d="M12 3 5 5.5v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9v-5L12 3z" /></g>)
export const IcDatabase = mk(() => <g><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" /><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></g>)
export const IcHistory = mk(() => <g><path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" /><path d="M3.5 12H7" /><path d="M12 7.5V12l3 2" /></g>)
export const IcGridSq = mk(() => <g><rect x="3" y="3" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" /></g>)
export const IcChartBar = mk(() => <g><path d="M4 20.5V4" /><path d="M4 20.5h16" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="14" width="3" height="4" /></g>)
export const IcLink = mk(() => <g><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 12.5 5a4 4 0 0 1 5.6 5.6L16.6 12" /><path d="M13 17.5 11.5 19a4 4 0 0 1-5.6-5.6L7.4 12" /></g>)
export const IcArrowDown = mk(() => <g><path d="M12 4v15" /><path d="m6 13 6 6 6-6" /></g>)
export const IcArrowUp = mk(() => <g><path d="M12 20V5" /><path d="m6 11 6-6 6 6" /></g>)
export const IcZoomIn = mk(() => <g><circle cx="11" cy="11" r="6.8" /><path d="m20.5 20.5-4.2-4.2" /><path d="M11 8.5v5M8.5 11h5" /></g>)
export const IcZoomOut = mk(() => <g><circle cx="11" cy="11" r="6.8" /><path d="m20.5 20.5-4.2-4.2" /><path d="M8.5 11h5" /></g>)
export const IcLockClosed = mk(() => <g><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></g>)
export const IcCopy = mk(() => <g><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M5.5 15.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5" /></g>)
export const IcOffset = mk(() => <g><path d="M4 17.5 13 5" /><path d="M9 19.5 18 7" /><circle cx="4" cy="17.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="18" cy="7" r="1.6" fill="currentColor" stroke="none" /></g>)
export const IcReshape = mk(() => <g><path d="M4 18 10 9l4 4 6-9" /><rect x="8.4" y="7.4" width="3.2" height="3.2" fill="none" /><rect x="12.4" y="11.4" width="3.2" height="3.2" fill="none" /></g>)
export const IcRedo = mk(() => <g><path d="M4 13a8 8 0 0 1 14-5.5L20.5 9" /><path d="M20.5 4.5V9H16" /></g>)
export const IcUndo = mk(() => <g><path d="M20 13a8 8 0 0 0-14-5.5L3.5 9" /><path d="M3.5 4.5V9H8" /></g>)
export const IcMerge = mk(() => <g><path d="M5 4v5c0 3 2 4 5 5l2 .6" /><path d="M19 4v5c0 3-2 4-5 5l-2 .6" /><path d="M12 14.5V21" /></g>)
export const IcGridDots = mk(() => <g fill="currentColor" stroke="none"><circle cx="6" cy="6" r="1.3" /><circle cx="12" cy="6" r="1.3" /><circle cx="18" cy="6" r="1.3" /><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /><circle cx="6" cy="18" r="1.3" /><circle cx="12" cy="18" r="1.3" /><circle cx="18" cy="18" r="1.3" /></g>)
export const IcCompass = mk(() => <g><circle cx="12" cy="12" r="8.5" /><path d="m15 9-4 1.6L9 15l4-1.6L15 9z" fill="currentColor" stroke="none" /></g>)
export const IcTag = mk(() => <g><path d="M3 6.5A3.5 3.5 0 0 1 6.5 3h6.2a2 2 0 0 1 1.4.6l6.2 6.2a2 2 0 0 1 0 2.8l-6 6a2 2 0 0 1-2.8 0L5.3 12.4A2 2 0 0 1 4.7 11V9" /><circle cx="7.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /></g>)
export const IcRows = mk(() => <g><rect x="3.5" y="4" width="17" height="4.5" rx="1.2" /><rect x="3.5" y="10.5" width="17" height="4.5" rx="1.2" /><rect x="3.5" y="17" width="17" height="4.5" rx="1.2" /></g>)
/* IcDots (vertical kebab) — used by later tasks, added here as alias to keep ICONS complete */
export const IcDots = mk(() => <g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></g>)

export const ICONS: Record<string, IconComponent> = {
  IcGrid, IcBell, IcDroplet, IcZap, IcFlask, IcMonitor, IcWarnTri, IcLayers, IcUser, IcChevR, IcChevL,
  IcPin, IcGauge, IcActivity, IcWrench, IcSend, IcFile, IcFactory, IcReceipt, IcDollar, IcWaves, IcTank,
  IcSliders, IcCube, IcPipe, IcSpray, IcClipboard, IcTarget, IcSparkle, IcArrowR, IcExternal,
  IcLayoutRows, IcLayoutSide, IcLayoutList, IcSun, IcMoon, IcHeadset, IcCheck, IcInbox, IcBriefcase,
  IcChevD, IcChevU, IcAlert, IcInfo, IcCheckCircle, IcX, IcPlus, IcMinus, IcSearch, IcFilter, IcEye,
  IcEyeOff, IcPencil, IcTrash, IcClock, IcRefresh, IcMore, IcDownload, IcUpload, IcChevRight, IcExpand,
  IcValve, IcHydrant, IcNode, IcPump, IcPolygon, IcLineGeom, IcRuler, IcCrosshair, IcRoute, IcGitBranch,
  IcCheckBadge, IcMobile, IcSatellite, IcMap, IcGlobe, IcPlug, IcShield, IcDatabase, IcHistory, IcGridSq,
  IcChartBar, IcLink, IcArrowDown, IcArrowUp, IcZoomIn, IcZoomOut, IcLockClosed, IcCopy, IcOffset,
  IcReshape, IcRedo, IcUndo, IcMerge, IcGridDots, IcCompass,
  IcTag, IcRows, IcDots,
}

/** Resolve an icon component by its string name (data references `icon:"IcMap"`). Falls back to IcGridSq. */
export function iconByName(name?: string): IconComponent {
  return (name && ICONS[name]) || IcGridSq
}

/** Render an icon by string name as JSX (replaces the design's `React.createElement(window[name], props)`). */
export function Icon(props: IconProps & { name?: string }): JSX.Element {
  const C = iconByName(props.name)
  return <C size={props.size} sw={props.sw} class={props.class ?? props.className} style={props.style} />
}
