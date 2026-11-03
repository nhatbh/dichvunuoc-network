/* App Hub — icon factory (kế thừa bộ icon IOC + bổ sung) */
function mkIcon(children) {
  return function Icon({ size = 16, sw = 1.7, className = "", style }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
        strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
        {children}
      </svg>
    );
  };
}
const IcGrid = mkIcon(<g><rect x="3" y="3" width="7.5" height="7.5" rx="1"></rect><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"></rect><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"></rect><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"></rect></g>);
const IcBell = mkIcon(<g><path d="M6.2 9.3a5.8 5.8 0 0 1 11.6 0c0 5.5 2.2 7 2.2 7H4s2.2-1.5 2.2-7z"></path><path d="M10.6 20a1.9 1.9 0 0 0 2.8 0"></path></g>);
const IcDroplet = mkIcon(<path d="M12 3.5c3.2 4.3 5.8 7.2 5.8 10.5a5.8 5.8 0 0 1-11.6 0C6.2 10.7 8.8 7.8 12 3.5z"></path>);
const IcZap = mkIcon(<polygon points="13 2.5 4.5 14 11 14 10.2 21.5 19.5 9.5 13 9.5"></polygon>);
const IcFlask = mkIcon(<g><path d="M9 3h6"></path><path d="M10 3v5.2L4.9 17.6A2 2 0 0 0 6.7 20.5h10.6a2 2 0 0 0 1.8-2.9L14 8.2V3"></path><path d="M7.3 15h9.4"></path></g>);
const IcMonitor = mkIcon(<g><rect x="2.5" y="4" width="19" height="12.5" rx="1.5"></rect><path d="M9 21h6"></path><path d="M12 16.5V21"></path></g>);
const IcSearch = mkIcon(<g><circle cx="11" cy="11" r="6.8"></circle><path d="m20.5 20.5-4.2-4.2"></path></g>);
const IcWarnTri = mkIcon(<g><path d="M12 3.2 2.6 19.4h18.8L12 3.2z"></path><path d="M12 9.5v4.2"></path><path d="M12 16.7v.01"></path></g>);
const IcX = mkIcon(<g><path d="M5.5 5.5l13 13"></path><path d="M18.5 5.5l-13 13"></path></g>);
const IcLayers = mkIcon(<g><path d="m12 3 9 4.8-9 4.8-9-4.8L12 3z"></path><path d="m4 13.4 8 4.3 8-4.3"></path></g>);
const IcUser = mkIcon(<g><circle cx="12" cy="8.2" r="3.4"></circle><path d="M5.2 20c1.4-3.4 3.9-5 6.8-5s5.4 1.6 6.8 5"></path></g>);
const IcChevR = mkIcon(<path d="m9.5 6 6 6-6 6"></path>);
const IcChevL = mkIcon(<path d="m14.5 6-6 6 6 6"></path>);
const IcPin = mkIcon(<g><path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21z"></path><circle cx="12" cy="11" r="2.2"></circle></g>);
const IcGauge = mkIcon(<g><path d="M5 18.5a8.7 8.7 0 1 1 14 0"></path><path d="M12 13.5 15.5 10"></path></g>);
const IcActivity = mkIcon(<path d="M3 12h3.5L10 5.5 14 18.5 17.5 12H21"></path>);
const IcWrench = mkIcon(<path d="M14.5 6.5a4.5 4.5 0 0 0-6 6L3 18l3 3 5.5-5.5a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.5-3.5z"></path>);
const IcSend = mkIcon(<g><path d="M21 3 10.5 13.5"></path><path d="M21 3l-7 18-3.5-7.5L3 10l18-7z"></path></g>);
const IcFile = mkIcon(<g><path d="M6 2.5h8l4 4V21.5H6V2.5z"></path><path d="M14 2.5v4h4"></path></g>);
const IcFactory = mkIcon(<g><path d="M3 21V9l5 3.5V9l5 3.5V9l5 3.5V21H3z"></path><path d="M3 21h18"></path><path d="M7 21v-3.5"></path><path d="M11 21v-3.5"></path><path d="M15 21v-3.5"></path></g>);
const IcReceipt = mkIcon(<g><path d="M5 3.5h14v17l-2.3-1.4L14.3 20l-2.3-1.4L9.7 20l-2.4-1.4L5 20.5v-17z"></path><path d="M8.5 8h7"></path><path d="M8.5 12h7"></path></g>);
const IcDollar = mkIcon(<g><path d="M12 2.5v19"></path><path d="M16.5 6.5c-1-1.3-2.7-2-4.5-2-2.5 0-4.5 1.3-4.5 3.4 0 4.4 9 2.2 9 6.6 0 2.1-2 3.5-4.5 3.5-1.9 0-3.6-.8-4.6-2.2"></path></g>);
const IcWaves = mkIcon(<g><path d="M2 9c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0"></path><path d="M2 15c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0"></path></g>);
const IcTank = mkIcon(<g><ellipse cx="12" cy="5.2" rx="6.8" ry="2.4"></ellipse><path d="M5.2 5.2v13.6c0 1.3 3 2.4 6.8 2.4s6.8-1.1 6.8-2.4V5.2"></path><path d="M5.2 12c0 1.3 3 2.4 6.8 2.4s6.8-1.1 6.8-2.4"></path></g>);
const IcSliders = mkIcon(<g><path d="M4 6h10"></path><path d="M18 6h2"></path><circle cx="16" cy="6" r="2"></circle><path d="M4 12h2"></path><path d="M10 12h10"></path><circle cx="8" cy="12" r="2"></circle><path d="M4 18h12"></path><path d="M20 18h0.01"></path><circle cx="18" cy="18" r="2"></circle></g>);
const IcCube = mkIcon(<g><path d="m12 2.6 8.4 4.7v9.4L12 21.4 3.6 16.7V7.3L12 2.6z"></path><path d="m3.6 7.3 8.4 4.7 8.4-4.7"></path><path d="M12 12v9.4"></path></g>);
const IcPipe = mkIcon(<g><path d="M3 8.5h11a3.5 3.5 0 0 1 3.5 3.5v9"></path><path d="M3 5.5v6"></path><path d="M14.5 17.5h6"></path></g>);
const IcSpray = mkIcon(<g><path d="M9 8.5h6v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-11z"></path><path d="M10.5 8.5V5.5h3v3"></path><path d="M16.5 4.5h.01"></path><path d="M19 6h.01"></path><path d="M19.5 9h.01"></path><path d="M16.5 10.5h.01"></path></g>);
const IcClipboard = mkIcon(<g><rect x="5" y="4.5" width="14" height="16" rx="2"></rect><path d="M9 4.5a3 3 0 0 1 6 0"></path><path d="M9 11h6"></path><path d="M9 15h4"></path></g>);
const IcTarget = mkIcon(<g><circle cx="12" cy="12" r="8.2"></circle><circle cx="12" cy="12" r="4.4"></circle><circle cx="12" cy="12" r="0.8" fill="currentColor"></circle></g>);
const IcSparkle = mkIcon(<g><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"></path></g>);
const IcArrowR = mkIcon(<g><path d="M4 12h15"></path><path d="m13 6 6 6-6 6"></path></g>);
const IcExternal = mkIcon(<g><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11"></path></g>);
const IcLayoutRows = mkIcon(<g><rect x="3.5" y="4" width="17" height="6" rx="1.2"></rect><rect x="3.5" y="14" width="17" height="6" rx="1.2"></rect></g>);
const IcLayoutSide = mkIcon(<g><rect x="3.5" y="4" width="6" height="16" rx="1.2"></rect><rect x="12" y="4" width="8.5" height="16" rx="1.2"></rect></g>);
const IcLayoutList = mkIcon(<g><path d="M8 6h12"></path><path d="M8 12h12"></path><path d="M8 18h12"></path><circle cx="4.3" cy="6" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="4.3" cy="12" r="1.1" fill="currentColor" stroke="none"></circle><circle cx="4.3" cy="18" r="1.1" fill="currentColor" stroke="none"></circle></g>);
const IcSun = mkIcon(<g><circle cx="12" cy="12" r="4"></circle><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4"></path></g>);
const IcMoon = mkIcon(<path d="M20 14.2A8 8 0 1 1 9.8 4 6.3 6.3 0 0 0 20 14.2z"></path>);
const IcHeadset = mkIcon(<g><path d="M4 13.5v-1.5a8 8 0 0 1 16 0v1.5"></path><rect x="2.5" y="13" width="3.5" height="6" rx="1.2"></rect><rect x="18" y="13" width="3.5" height="6" rx="1.2"></rect><path d="M20 19v.6a3 3 0 0 1-3 3h-3"></path></g>);
const IcCheck = mkIcon(<path d="m5 12.5 4.2 4.2L19 6.8"></path>);
const IcInbox = mkIcon(<g><path d="M3 12.5h5l1.6 2.6h4.8L16 12.5h5"></path><path d="M5.4 5.5h13.2l2.4 7v6H3v-6l2.4-7z"></path></g>);

const MENU_IC = { IcGrid, IcBell, IcDroplet, IcZap, IcFlask, IcMonitor, IcWarnTri, IcLayers, IcUser, IcPin, IcGauge, IcActivity, IcWrench, IcSend, IcFile, IcFactory, IcReceipt, IcDollar, IcWaves, IcTank, IcSliders, IcCube, IcPipe, IcSpray, IcClipboard, IcTarget, IcSparkle };

Object.assign(window, {
  IcGrid, IcBell, IcDroplet, IcZap, IcFlask, IcMonitor, IcSearch, IcWarnTri, IcX, IcLayers, IcUser,
  IcChevR, IcChevL, IcPin, IcGauge, IcActivity, IcWrench, IcSend, IcFile, IcFactory, IcReceipt, IcDollar,
  IcWaves, IcTank, IcSliders, IcCube, IcPipe, IcSpray, IcClipboard, IcTarget, IcSparkle, IcArrowR, IcExternal,
  IcLayoutRows, IcLayoutSide, IcLayoutList, IcSun, IcMoon, IcHeadset, IcCheck, IcInbox, MENU_IC,
});
