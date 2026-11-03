// Biểu tượng SVG (data URL) cho IconLayer.
const svg = (s) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);

const pin = (fill, glyph) =>
  svg(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64" viewBox="0 0 48 64">
  <path d="M24 2C12 2 3 11 3 23c0 15 21 38 21 38s21-23 21-38C45 11 36 2 24 2z" fill="${fill}" stroke="#fff" stroke-width="3"/>
  <text x="24" y="31" font-family="Arial" font-weight="bold" font-size="24" text-anchor="middle" fill="#fff">${glyph}</text></svg>`);

export const ICONS = {
  pinRed: { url: pin("#d7301f", "!"), width: 48, height: 64, anchorY: 62 },
  pinYellow: { url: pin("#f0a400", "!"), width: 48, height: 64, anchorY: 62 },
  pinBlue: { url: pin("#2171b5", "i"), width: 48, height: 64, anchorY: 62 },
  fire: { url: pin("#e6550d", "F"), width: 48, height: 64, anchorY: 62 },
  leakTrue: { url: pin("#a50f15", "R"), width: 48, height: 64, anchorY: 62 },
  leakEst: {
    url: svg(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="19" fill="none" stroke="#08519c" stroke-width="5"/><circle cx="24" cy="24" r="7" fill="#08519c"/></svg>`),
    width: 48, height: 48, anchorY: 24,
  },
  valve: {
    url: svg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="3" y="3" width="34" height="34" rx="6" fill="#111" stroke="#ffd400" stroke-width="4"/><path d="M10 12 L30 28 M10 28 L30 12" stroke="#ffd400" stroke-width="4"/></svg>`),
    width: 40, height: 40, anchorY: 20,
  },
  source: {
    url: svg(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="21" fill="#00a6d6" stroke="#fff" stroke-width="3"/><text x="24" y="31" font-family="Arial" font-weight="bold" font-size="18" text-anchor="middle" fill="#fff">TB</text></svg>`),
    width: 48, height: 48, anchorY: 24,
  },
  logger: {
    url: svg(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect x="3" y="3" width="30" height="30" rx="15" fill="#6a3d9a" stroke="#fff" stroke-width="3"/><text x="18" y="24" font-family="Arial" font-weight="bold" font-size="15" text-anchor="middle" fill="#fff">P</text></svg>`),
    width: 36, height: 36, anchorY: 18,
  },
  meter: {
    url: svg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="3" y="3" width="34" height="34" rx="4" fill="#1b9e77" stroke="#fff" stroke-width="3"/><text x="20" y="26" font-family="Arial" font-weight="bold" font-size="15" text-anchor="middle" fill="#fff">Q</text></svg>`),
    width: 40, height: 40, anchorY: 20,
  },
};
