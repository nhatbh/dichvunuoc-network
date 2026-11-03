/* Bản đồ mạng lưới GIS — icon bổ sung (load SAU menu/icons.jsx).
   Factory riêng (scope babel độc lập). Thêm icon generic còn thiếu + icon GIS. */
function gicon(children) {
  return function Icon({ size = 16, sw = 1.7, className = "", style }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
        strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{children}</svg>
    );
  };
}
// generic còn thiếu
const IcChevD = gicon(<path d="m6 9.5 6 6 6-6"></path>);
const IcChevU = gicon(<path d="m6 14.5 6-6 6 6"></path>);
const IcAlert = gicon(<g><path d="M12 8v5"></path><path d="M12 16.5v.01"></path><circle cx="12" cy="12" r="9"></circle></g>);
const IcInfo = gicon(<g><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8v.01"></path></g>);
const IcCheckCircle = gicon(<g><circle cx="12" cy="12" r="9"></circle><path d="m8.5 12 2.5 2.5 4.5-5"></path></g>);
const IcBriefcase = gicon(<g><rect x="3" y="7.5" width="18" height="12" rx="2"></rect><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"></path><path d="M3 12.5h18"></path></g>);
const IcX = gicon(<g><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></g>);
const IcPlus = gicon(<g><path d="M12 5v14"></path><path d="M5 12h14"></path></g>);
const IcMinus = gicon(<path d="M5 12h14"></path>);
const IcSearch = gicon(<g><circle cx="11" cy="11" r="6.8"></circle><path d="m20.5 20.5-4.2-4.2"></path></g>);
const IcFilter = gicon(<path d="M3 5.5h18l-7 8.5v5l-4 2v-7L3 5.5z"></path>);
const IcEye = gicon(<g><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.7"></circle></g>);
const IcEyeOff = gicon(<g><path d="M4 4l16 16"></path><path d="M9.5 5.7A10 10 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-3.3 4M6.5 7.6A17 17 0 0 0 2 12s3.6 6.5 10 6.5a10 10 0 0 0 3-.5"></path><path d="M9.8 9.8a3 3 0 0 0 4.3 4.2"></path></g>);
const IcPencil = gicon(<g><path d="M16.5 3.8a2 2 0 0 1 2.8 2.8L7 19l-4 1 1-4 12.5-12.2z"></path><path d="M14.5 5.8l2.9 2.9"></path></g>);
const IcTrash = gicon(<g><path d="M4 7h16"></path><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"></path><path d="M6 7l1 13h10l1-13"></path></g>);
const IcClock = gicon(<g><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></g>);
const IcRefresh = gicon(<g><path d="M20 11a8 8 0 0 0-14-4.5L3.5 9"></path><path d="M4 13a8 8 0 0 0 14 4.5L20.5 15"></path><path d="M3.5 4.5V9H8M20.5 19.5V15H16"></path></g>);
const IcMore = gicon(<g><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"></circle></g>);
const IcDownload = gicon(<g><path d="M12 3.5v11M7.5 10l4.5 4.5L16.5 10"></path><path d="M5 20.5h14"></path></g>);
const IcUpload = gicon(<g><path d="M12 20.5v-11M7.5 14l4.5-4.5L16.5 14"></path><path d="M5 3.5h14"></path></g>);
const IcChevRight = gicon(<path d="m9.5 6 6 6-6 6"></path>);
const IcExpand = gicon(<g><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></g>);

// GIS-specific
const IcValve = gicon(<g><circle cx="12" cy="12" r="3.4"></circle><path d="M12 8.6V4M12 20v-4.6M8.6 12H4M20 12h-4.6"></path><path d="M9.6 9.6 7 7M17 7l-2.6 2.6M9.6 14.4 7 17M17 17l-2.6-2.6"></path></g>);
const IcHydrant = gicon(<g><path d="M8.5 9a3.5 3.5 0 0 1 7 0v7.5h-7V9z"></path><path d="M7 16.5h10"></path><path d="M6.5 20h11"></path><path d="M7 16.5l-.5 3.5M17 16.5l.5 3.5"></path><circle cx="12" cy="11.5" r="1.4"></circle><path d="M9 6.5l-1.5-1M15 6.5l1.5-1"></path></g>);
const IcNode = gicon(<g><circle cx="12" cy="12" r="3"></circle><path d="M12 9V4M12 20v-5M9 12H4M20 12h-5"></path></g>);
const IcPump = gicon(<g><circle cx="11" cy="13" r="5"></circle><path d="M11 13l3-3"></path><path d="M11 8V4h5"></path><path d="M16 4v5"></path><path d="M6 17l-2 3"></path></g>);
const IcPolygon = gicon(<path d="M12 3l8 5.5-3 10.5H7L4 8.5 12 3z"></path>);
const IcLineGeom = gicon(<g><circle cx="5" cy="19" r="2"></circle><circle cx="19" cy="5" r="2"></circle><path d="M6.5 17.5 17.5 6.5"></path></g>);
const IcRuler = gicon(<g><rect x="2.5" y="8" width="19" height="8" rx="1.5" transform="rotate(-45 12 12)"></rect><path d="M9 7.5l1.5 1.5M11.5 10l1 1M14 7.5l1.5 1.5M7 10l1 1"></path></g>);
const IcCrosshair = gicon(<g><circle cx="12" cy="12" r="8"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"></circle></g>);
const IcRoute = gicon(<g><circle cx="6" cy="18.5" r="2.4"></circle><circle cx="18" cy="5.5" r="2.4"></circle><path d="M8 17.5c5-1 8.5-4 8.5-9"></path><path d="M6 16V12a3 3 0 0 1 3-3h3"></path></g>);
const IcGitBranch = gicon(<g><circle cx="6" cy="6" r="2.4"></circle><circle cx="6" cy="18" r="2.4"></circle><circle cx="18" cy="8" r="2.4"></circle><path d="M6 8.4v7.2"></path><path d="M18 10.4c0 4-3.5 4.6-6 5"></path></g>);
const IcCheckBadge = gicon(<g><path d="m12 3 2.1 1.5 2.6-.2 1 2.4 2.2 1.4-.6 2.5 1.1 2.3-1.7 2 .1 2.6-2.5.6-1.5 2.1-2.4-.9-2.4.9-1.5-2.1-2.5-.6.1-2.6-1.7-2 1.1-2.3-.6-2.5L4.3 6.7l1-2.4 2.6.2L10 3z"></path><path d="m9.5 12 1.8 1.8 3.5-3.8"></path></g>);
const IcMobile = gicon(<g><rect x="6.5" y="2.5" width="11" height="19" rx="2.4"></rect><path d="M10.5 18.5h3"></path></g>);
const IcSatellite = gicon(<g><path d="M9.5 7.5 7 5l-3 3 2.5 2.5"></path><path d="m6.5 10.5 7 7"></path><path d="M14 17.5 16.5 20l3-3-2.5-2.5"></path><path d="M15 5a4 4 0 0 1 4 4"></path><path d="M15 9a0 0 0 0 1 0 0"></path><path d="M11.5 12.5 9 15"></path></g>);
const IcMap = gicon(<g><path d="m3 6.5 6-2.5 6 2.5 6-2.5v14L15 20l-6-2.5L3 20v-14z"></path><path d="M9 4v13.5M15 6.5V20"></path></g>);
const IcGlobe = gicon(<g><circle cx="12" cy="12" r="8.5"></circle><path d="M3.5 12h17"></path><path d="M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.3-3.6-8.5S9.6 5.8 12 3.5z"></path></g>);
const IcPlug = gicon(<g><path d="M9 3v5M15 3v5"></path><path d="M7 8h10v3a5 5 0 0 1-10 0V8z"></path><path d="M12 16v5"></path></g>);
const IcShield = gicon(<g><path d="M12 3 5 5.5v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9v-5L12 3z"></path></g>);
const IcDatabase = gicon(<g><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"></ellipse><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"></path><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"></path></g>);
const IcHistory = gicon(<g><path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1"></path><path d="M3.5 12H7"></path><path d="M12 7.5V12l3 2"></path></g>);
const IcGridSq = gicon(<g><rect x="3" y="3" width="7.5" height="7.5" rx="1"></rect><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"></rect><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"></rect><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"></rect></g>);
const IcChartBar = gicon(<g><path d="M4 20.5V4"></path><path d="M4 20.5h16"></path><rect x="7" y="12" width="3" height="6"></rect><rect x="12" y="8" width="3" height="10"></rect><rect x="17" y="14" width="3" height="4"></rect></g>);
const IcLink = gicon(<g><path d="M9.5 14.5 14.5 9.5"></path><path d="M11 6.5 12.5 5a4 4 0 0 1 5.6 5.6L16.6 12"></path><path d="M13 17.5 11.5 19a4 4 0 0 1-5.6-5.6L7.4 12"></path></g>);
const IcArrowDown = gicon(<g><path d="M12 4v15"></path><path d="m6 13 6 6 6-6"></path></g>);
const IcArrowUp = gicon(<g><path d="M12 20V5"></path><path d="m6 11 6-6 6 6"></path></g>);
const IcZoomIn = gicon(<g><circle cx="11" cy="11" r="6.8"></circle><path d="m20.5 20.5-4.2-4.2"></path><path d="M11 8.5v5M8.5 11h5"></path></g>);
const IcZoomOut = gicon(<g><circle cx="11" cy="11" r="6.8"></circle><path d="m20.5 20.5-4.2-4.2"></path><path d="M8.5 11h5"></path></g>);
const IcLockClosed = gicon(<g><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></g>);
const IcCopy = gicon(<g><rect x="8.5" y="8.5" width="11" height="11" rx="2"></rect><path d="M5.5 15.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5"></path></g>);
const IcOffset = gicon(<g><path d="M4 17.5 13 5"></path><path d="M9 19.5 18 7"></path><circle cx="4" cy="17.5" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="18" cy="7" r="1.6" fill="currentColor" stroke="none"></circle></g>);
const IcReshape = gicon(<g><path d="M4 18 10 9l4 4 6-9"></path><rect x="8.4" y="7.4" width="3.2" height="3.2" fill="none"></rect><rect x="12.4" y="11.4" width="3.2" height="3.2" fill="none"></rect></g>);
const IcRedo = gicon(<g><path d="M4 13a8 8 0 0 1 14-5.5L20.5 9"></path><path d="M20.5 4.5V9H16"></path></g>);
const IcUndo = gicon(<g><path d="M20 13a8 8 0 0 0-14-5.5L3.5 9"></path><path d="M3.5 4.5V9H8"></path></g>);
const IcMerge = gicon(<g><path d="M5 4v5c0 3 2 4 5 5l2 .6"></path><path d="M19 4v5c0 3-2 4-5 5l-2 .6"></path><path d="M12 14.5V21"></path></g>);
const IcGridDots = gicon(<g><g fill="currentColor" stroke="none"><circle cx="6" cy="6" r="1.3"></circle><circle cx="12" cy="6" r="1.3"></circle><circle cx="18" cy="6" r="1.3"></circle><circle cx="6" cy="12" r="1.3"></circle><circle cx="12" cy="12" r="1.3"></circle><circle cx="18" cy="12" r="1.3"></circle><circle cx="6" cy="18" r="1.3"></circle><circle cx="12" cy="18" r="1.3"></circle><circle cx="18" cy="18" r="1.3"></circle></g></g>);
const IcCompass = gicon(<g><circle cx="12" cy="12" r="8.5"></circle><path d="m15 9-4 1.6L9 15l4-1.6L15 9z" fill="currentColor" stroke="none"></path></g>);

Object.assign(window, {
  IcChevD, IcChevU, IcAlert, IcInfo, IcCheckCircle, IcBriefcase, IcX, IcPlus, IcMinus, IcSearch, IcFilter,
  IcEye, IcEyeOff, IcPencil, IcTrash, IcClock, IcRefresh, IcMore, IcDownload, IcUpload, IcChevRight, IcExpand,
  IcValve, IcHydrant, IcNode, IcPump, IcPolygon, IcLineGeom, IcRuler, IcCrosshair, IcRoute, IcGitBranch,
  IcCheckBadge, IcMobile, IcSatellite, IcMap, IcGlobe, IcPlug, IcShield, IcDatabase, IcHistory, IcGridSq,
  IcChartBar, IcLink, IcArrowDown, IcArrowUp, IcZoomIn, IcZoomOut, IcLockClosed,
  IcCopy, IcOffset, IcReshape, IcRedo, IcUndo, IcMerge, IcGridDots, IcCompass,
});
