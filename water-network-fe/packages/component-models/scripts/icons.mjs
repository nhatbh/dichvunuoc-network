// Writes dist/icons/<Code>.svg (+ <Code>-<status>.svg for status components) and dist/icons/_sheet.svg.
// Runs after `tsc`, from the built ESM (no extra tooling).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { CATALOG_ITEMS, STATUSES } from '../dist/catalog.js';
import { symbolSVG } from '../dist/symbols.js';

const dir = 'dist/icons';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
let n = 0;
for (const c of CATALOG_ITEMS) {
  writeFileSync(`${dir}/${c.code}.svg`, symbolSVG(c.code)); n++;
  if (c.hasStatus) for (const s of STATUSES) { writeFileSync(`${dir}/${c.code}-${s}.svg`, symbolSVG(c.code, { status: s })); n++; }
}
const cols = 9;
const cells = CATALOG_ITEMS.map((c, i) => `<g transform="translate(${(i % cols) * 110 + 31},${Math.floor(i / cols) * 100 + 20})">${symbolSVG(c.code, { size: 48, status: c.hasStatus ? 'normal' : undefined })}<text x="24" y="70" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="#1c2228">${c.code}</text></g>`).join('');
writeFileSync(`${dir}/_sheet.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * 110}" height="${Math.ceil(CATALOG_ITEMS.length / cols) * 100 + 20}"><rect width="100%" height="100%" fill="#eef1f3"/>${cells}</svg>`);
console.log(`icons: ${n} symbols + _sheet.svg in ${dir}`);
