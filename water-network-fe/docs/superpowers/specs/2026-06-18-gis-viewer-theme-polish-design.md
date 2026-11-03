# GIS Viewer — Bug fix + Theme/Polish

Date: 2026-06-18
Scope: **skin only** — fix the blocking map-tile bug and re-skin the existing
viewer to the "Published Network Viewer" design language. **No layout
restructuring** (no full app bar, multi-tier attribute filters, trust-state
legend, parent/child relations, or new zoom/scale controls — deferred).

App: `apps/gis` (SolidJS + OpenLayers, `@wn/map-runtime`).
Design reference: `water-network-gis/water-network-gis-ui` ("Published Network
Viewer" Open Design mockup).

## Problem

1. **Blank basemap (critical).** `apps/gis/nginx.conf.template` sets
   `img-src 'self' data: blob:`. OpenLayers loads raster tiles via `Image()`,
   which is governed by `img-src`. Both basemaps load from external hosts
   (`tile.openstreetmap.org`, `*.basemaps.cartocdn.com`), so every tile is
   CSP-blocked → the map renders only floating vectors on white. This is the
   main reason the viewer looks broken.
2. **Generic look.** Theme uses the default shadcn blue accent
   (`--primary: 221 83% 53%`); widgets are minimal placeholders. The design
   uses a teal/emerald brand accent on a slate neutral base with status badges.

## Decisions

- **Map tiles:** whitelist the external tile hosts in CSP (staging-appropriate;
  self-hosting/proxy deferred to a future production hardening pass).
- **Accent:** teal-600 `#0d9488` ≈ `hsl(175 84% 32%)`.
- **Neutrals:** keep existing slate tokens (already match the design).

## Changes

### A. CSP — unblock tiles (`apps/gis/nginx.conf.template`)
Extend `img-src` only:
```
img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com;
```
Other directives unchanged. Deploy-config; verified by re-reading the string
(no unit test).

### B. Palette (`apps/gis/src/app/app.css`)
- Light: `--primary: 175 84% 32%`, `--ring: 175 84% 32%`,
  `--primary-foreground: 0 0% 100%`.
- Dark: `--primary: 172 66% 50%` (teal tint readable on dark slate),
  `--ring` to match.
- Slate neutrals unchanged.

### C. Component polish (in place — no structural change)

**New: `shared/ui/status-badge.tsx`** — a thin `StatusBadge` wrapper over the
**existing** shadcn `Badge` (`shared/ui/shadcn/badge.tsx`); do not fork the
primitive. Color treatment resolved from a feature `status` string:
- `published` / `passed` → green (`bg-green-50 text-green-700 ring-green-200`)
- `draft` → amber
- `staging` → slate
- `retired` → rose
- present but unknown value → slate badge with the raw label
Tailwind utility classes (palette `green/amber/slate/rose` already available via
default Tailwind). Accessible: text + ring, not color alone. The Badge always
renders a label (caller passes the resolved text); a **missing** status is
handled by the caller (PropertiesPalette shows plain `—`, no badge).

**`widgets/properties-palette`** — keep the `aside` + `dl` structure; restyle:
- Section heading → `text-xs font-medium uppercase tracking-wide text-muted-foreground`.
- Labels `text-muted-foreground`, values `font-medium text-foreground`.
- `Status` row renders `<Badge>` instead of raw text.
- Rows separated by a thin `divide-y divide-border` list; roomier spacing.

**Floating panels + aside** (`feature-search`, `layer-control`,
`coordinate-readout`, `properties-palette`) — unify the surface to a card:
`rounded-lg border border-border bg-background/95 backdrop-blur shadow-sm`.
Each panel keeps its current contents and behaviour; only the wrapper classes
change. (Where a panel already sets some of these, normalize to the shared set.)

**Typography** — group/legend headings across these panels normalize to the
same `text-xs uppercase tracking-wide` scale used by the palette heading.

## Out of scope (deferred)
Full top app bar, snapshot version chip, multi-tier attribute filter chips,
trust-state legend, enhanced-contrast toggle, parent/child relation cards,
redesigned zoom/rotate/scale controls, self-hosted tile proxy.

## Testing
- Keep existing vitest suites green (`properties-palette`, `gis-page`,
  `gis-viewer` smoke).
- TDD new `shared/ui/badge.tsx`: variant → classes/label mapping.
- Extend `properties-palette` test: a feature with `status: 'published'` renders
  a badge (assert role/text), unknown status renders the `—` fallback.
- CSP: manual re-read of the directive string (deploy config, no harness).

## Files touched
- `apps/gis/nginx.conf.template` (CSP)
- `apps/gis/src/app/app.css` (tokens)
- `apps/gis/src/shared/ui/status-badge.tsx` (+ `status-badge.test.tsx`) — new
- `apps/gis/src/shared/ui/surface.ts` — new (shared floating-panel surface class)
- `apps/gis/src/shared/ui/index.ts` (exports)
- `apps/gis/src/widgets/properties-palette/ui/properties-palette.tsx` (+ test)
- `apps/gis/src/features/feature-search/ui/*`, `features/layer-control/ui/*`,
  `features/coordinate-readout/ui/*` (wrapper classes only)
