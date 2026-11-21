/*
 * The /twin opening screen, drawn before the app's code has loaded (that takes seconds in the mock build), so the logo
 * shows at once instead of a white page. The app's Splash (src/pages/twin/ui/intro.tsx) takes over this element,
 * lets the opening finish, and removes it once the map is ready. window.__twinBoot() draws it on demand (the app
 * calls it when /twin is reached from another page, e.g. after signing in).
 */
;(function () {
  var base = (document.currentScript && document.currentScript.src.replace(/twin-boot\.js.*$/, '')) || '/'
  var LOGO =
    '<svg class="tw-logo-anim" viewBox="0 0 200 200" aria-hidden="true">' +
    '<defs>' +
    '<linearGradient id="tw-drop" x1="0.25" y1="0" x2="0.75" y2="1"><stop offset="0" stop-color="#7fd0f6"/><stop offset="0.55" stop-color="#2aa7e6"/><stop offset="1" stop-color="#1678c4"/></linearGradient>' +
    '<linearGradient id="tw-hand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#43b4ee"/><stop offset="1" stop-color="#1b7fc8"/></linearGradient>' +
    '<clipPath id="tw-drop-clip"><path d="M100 26 C 96 34 70 66 70 88 a30 30 0 0 0 60 0 C 130 66 104 34 100 26 Z"/></clipPath>' +
    '</defs>' +
    '<circle class="ring" cx="100" cy="100" r="92"/>' +
    '<g class="ripple"><ellipse cx="100" cy="134" rx="26" ry="5"/></g>' +
    '<g class="hand left">' +
    '<path d="M100 158 C 80 160 58 152 44 138 C 34 128 26 116 21 103 C 30 103 38 109 46 115 C 60 125 78 133 98 137 Z"/>' +
    '<path d="M86 137 C 82 129 82 121 88 114 C 93 121 95 129 95 137 Z"/>' +
    '<path class="crease" d="M31 110 C 41 119 52 126 64 131"/><path class="crease" d="M40 121 C 50 129 61 135 74 139"/>' +
    '</g>' +
    '<g class="hand right">' +
    '<path d="M100 158 C 120 160 142 152 156 138 C 166 128 174 116 179 103 C 170 103 162 109 154 115 C 140 125 122 133 102 137 Z"/>' +
    '<path d="M114 137 C 118 129 118 121 112 114 C 107 121 105 129 105 137 Z"/>' +
    '<path class="crease" d="M169 110 C 159 119 148 126 136 131"/><path class="crease" d="M160 121 C 150 129 139 135 126 139"/>' +
    '</g>' +
    '<g class="drop">' +
    '<path class="body" d="M100 26 C 96 34 70 66 70 88 a30 30 0 0 0 60 0 C 130 66 104 34 100 26 Z"/>' +
    '<g clip-path="url(#tw-drop-clip)"><rect class="shine" x="40" y="10" width="26" height="140"/></g>' +
    '<path class="glint" d="M86 76 C 84 84 84 92 88 100"/>' +
    '</g>' +
    '</svg>'

  /** water along the bottom: three layers of waves drifting at different speeds */
  var WAVE = 'M0 40 Q 100 10 200 40 T 400 40 T 600 40 T 800 40 T 1000 40 T 1200 40 T 1400 40 T 1600 40 V 120 H 0 Z'
  var WAVES = '<svg class="tw-splash-waves" viewBox="0 0 1600 120" preserveAspectRatio="none" aria-hidden="true"><path class="w1" d="' + WAVE + '"/><path class="w2" d="' + WAVE + '"/><path class="w3" d="' + WAVE + '"/></svg>'

  window.__twinBoot = function () {
    var el = document.getElementById('tw-boot')
    if (el) return el
    if (!document.getElementById('tw-boot-css')) {
      var link = document.createElement('link')
      link.id = 'tw-boot-css'
      link.rel = 'stylesheet'
      link.href = base + 'twin-boot.css'
      document.head.appendChild(link)
    }
    // covers the page even before its stylesheet has applied
    el = document.createElement('div')
    el.id = 'tw-boot'
    el.className = 'tw-splash'
    el.style.cssText = 'position:fixed;inset:0;z-index:200;background:#fff'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.innerHTML =
      '<div class="tw-splash-glow"></div>' +
      '<div class="tw-splash-mark">' +
      LOGO +
      '<div class="tw-splash-name"><b>Bản đồ số 3D</b><span>Mạng lưới cấp nước Vĩnh Thịnh · Nhà máy nước sạch Sông Hồng</span></div>' +
      '<div class="tw-splash-progress"><i></i></div>' +
      '<div class="tw-splash-load"><span>&nbsp;</span></div>' +
      '</div>' +
      WAVES +
      '<div class="tw-splash-foot">Số liệu vận hành trực tuyến · Mô hình 3D từ bản vẽ thiết kế</div>'
    document.body.appendChild(el)
    window.__twinBootAt = performance.now()
    return el
  }

  if (/^\/twin(\/|$)/.test(location.pathname)) window.__twinBoot()
})()
