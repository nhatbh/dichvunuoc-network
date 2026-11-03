# GIS Viewer — Bug Fix + Theme/Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock the map basemap (CSP) and re-skin the existing GIS viewer to the teal/slate "Published Network Viewer" design language — no layout restructuring.

**Architecture:** Three independent slices. (1) A one-line CSP change in the nginx template whitelists external tile hosts so OpenLayers tiles load. (2) Two CSS custom-property changes swap the shadcn blue accent for teal-600. (3) A reusable `StatusBadge` and a shared floating-surface class polish the existing widgets in place — same structure, restyled wrappers.

**Tech Stack:** SolidJS, OpenLayers (`@wn/map-runtime`), Tailwind + shadcn-solid, Vitest + `@solidjs/testing-library`, nginx (deploy).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-gis-viewer-theme-polish-design.md`.
- **Skin only** — do NOT add/restructure panels (no app bar, attribute filters, trust-state legend, parent/child cards, new zoom/scale controls).
- All paths below are relative to `apps/gis/` unless noted; run commands from `apps/gis/`.
- Accent color: teal-600 = `hsl(175 84% 32%)` (light), teal tint `hsl(172 66% 50%)` (dark).
- Keep existing test suites green; new behavior is TDD'd.
- Conventional commits. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse the existing shadcn `Badge` (`src/shared/ui/shadcn/badge.tsx`) — do NOT fork it.

---

### Task 1: CSP — whitelist map tile hosts

**Files:**
- Modify: `nginx.conf.template:15`

No unit test (deploy config). Verified by re-reading the directive.

- [ ] **Step 1: Edit the `img-src` directive**

In `nginx.conf.template`, the `Content-Security-Policy` header currently contains:

```
img-src 'self' data: blob:;
```

Change ONLY that token to:

```
img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com;
```

Leave every other directive (`default-src`, `script-src`, `style-src`, `font-src`, `connect-src`, `frame-src`) exactly as-is.

- [ ] **Step 2: Verify the full header line**

Run: `grep -n "img-src" nginx.conf.template`
Expected: one line showing the three whitelisted hosts appended after `blob:`, and the rest of the CSP header intact on the same line.

- [ ] **Step 3: Commit**

```bash
git add apps/gis/nginx.conf.template
git commit -m "fix(gis): allow OSM/Carto tile hosts in CSP img-src so basemap renders"
```

---

### Task 2: Theme — teal accent tokens

**Files:**
- Modify: `src/app/app.css` (`:root` and `.dark` blocks)

No unit test (CSS tokens). Verified by typecheck/build staying green and visual.

- [ ] **Step 1: Swap light-mode accent**

In `src/app/app.css`, inside `:root`, replace these three lines:

```css
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
```
```css
    --ring: 221.2 83.2% 53.3%;
```

with:

```css
    --primary: 175 84% 32%;
    --primary-foreground: 0 0% 100%;
```
```css
    --ring: 175 84% 32%;
```

(`--primary` and `--primary-foreground` are adjacent; `--ring` is a few lines below — edit each in place, leave all other tokens unchanged.)

- [ ] **Step 2: Swap dark-mode accent**

Inside the `.dark` block, change:

```css
    --primary: 217.2 91.2% 59.8%;
```
to:
```css
    --primary: 172 66% 50%;
```

and change the dark `--ring` line:

```css
    --ring: 224.3 76.3% 48%;
```
to:
```css
    --ring: 172 66% 50%;
```

(Leave dark `--primary-foreground` as-is — dark text reads well on bright teal. If the dark `--ring` value in the file differs from `224.3 76.3% 48%`, just set whatever the existing dark `--ring` is to `172 66% 50%`.)

- [ ] **Step 3: Verify build compiles the CSS**

Run: `npm run typecheck`
Expected: PASS (no TS errors; this confirms the workspace is intact — CSS itself isn't type-checked but this is the cheap gate before commit).

- [ ] **Step 4: Commit**

```bash
git add apps/gis/src/app/app.css
git commit -m "feat(gis): teal-600 brand accent in place of default shadcn blue"
```

---

### Task 3: `StatusBadge` component

A thin wrapper over the existing shadcn `Badge` that maps a feature status string to a color treatment. Slate fallback for unknown values.

**Files:**
- Create: `src/shared/ui/status-badge.tsx`
- Create: `src/shared/ui/status-badge.test.tsx`
- Modify: `src/shared/ui/index.ts` (add export)

**Interfaces:**
- Consumes: `Badge` from `./shadcn/badge`, `cn` from `@/shared/lib/utils`.
- Produces: `export function StatusBadge(props: { status: string; class?: string }): JSX.Element` — renders the status text inside a colored badge; `data-testid="status-badge"`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/ui/status-badge.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@solidjs/testing-library'
import { StatusBadge } from './status-badge'

describe('StatusBadge', () => {
  it('renders the status label', () => {
    render(() => <StatusBadge status="published" />)
    expect(screen.getByText('published')).toBeInTheDocument()
  })

  it('uses green treatment for published', () => {
    render(() => <StatusBadge status="published" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-green-700')
  })

  it('uses green treatment for passed', () => {
    render(() => <StatusBadge status="passed" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-green-700')
  })

  it('uses amber treatment for draft', () => {
    render(() => <StatusBadge status="draft" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-amber-700')
  })

  it('uses rose treatment for retired', () => {
    render(() => <StatusBadge status="retired" />)
    expect(screen.getByTestId('status-badge')).toHaveClass('text-rose-700')
  })

  it('falls back to slate for an unknown status (case-insensitive)', () => {
    render(() => <StatusBadge status="Whatever" />)
    const el = screen.getByTestId('status-badge')
    expect(el).toHaveClass('text-slate-700')
    expect(screen.getByText('Whatever')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/ui/status-badge.test.tsx`
Expected: FAIL — cannot resolve `./status-badge`.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/ui/status-badge.tsx`:

```tsx
import { Badge } from './shadcn/badge'
import { cn } from '@/shared/lib/utils'

/** Color treatments keyed by lowercased status. Unknown → slate. */
const STATUS_CLASS: Record<string, string> = {
  published: 'border-green-200 bg-green-50 text-green-700',
  passed: 'border-green-200 bg-green-50 text-green-700',
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
  staging: 'border-slate-200 bg-slate-50 text-slate-700',
  retired: 'border-rose-200 bg-rose-50 text-rose-700',
}

const FALLBACK = 'border-slate-200 bg-slate-50 text-slate-700'

/** A status pill built on the shared Badge. Text + ring + bg — not color alone. */
export function StatusBadge(props: { status: string; class?: string }) {
  const treatment = () => STATUS_CLASS[props.status.toLowerCase()] ?? FALLBACK
  return (
    <Badge
      variant="outline"
      data-testid="status-badge"
      class={cn('capitalize', treatment(), props.class)}
    >
      {props.status}
    </Badge>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/ui/status-badge.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Export it**

In `src/shared/ui/index.ts`, after the `export { Spinner } from './spinner'` line, add:

```ts
export { StatusBadge } from './status-badge'
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS

```bash
git add apps/gis/src/shared/ui/status-badge.tsx apps/gis/src/shared/ui/status-badge.test.tsx apps/gis/src/shared/ui/index.ts
git commit -m "feat(gis): StatusBadge — color-coded status pill on shared Badge"
```

---

### Task 4: PropertiesPalette — restyle + status badge

Keep the `aside` + `dl` structure and the empty-state. Restyle headings/rows and render `StatusBadge` for the status row (plain `—` when status is missing).

**Files:**
- Modify: `src/widgets/properties-palette/ui/properties-palette.tsx`
- Modify: `src/widgets/properties-palette/ui/properties-palette.test.tsx`

**Interfaces:**
- Consumes: `StatusBadge` from `@/shared/ui`, `NetworkFeature` from `@/entities/map-feature`.

- [ ] **Step 1: Extend the test (write the new failing assertions)**

In `src/widgets/properties-palette/ui/properties-palette.test.tsx`, add two cases inside the `describe('PropertiesPalette', ...)` block:

```tsx
  it('renders a status badge when the feature has a status', () => {
    const { getByTestId } = render(() => (
      <PropertiesPalette
        feature={{ type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'node', name: 'Valve 1', status: 'published' } }}
      />
    ));
    expect(getByTestId('status-badge')).toHaveTextContent('published')
  })

  it('shows a dash when the feature has no status', () => {
    const { queryByTestId, getByTestId } = render(() => (
      <PropertiesPalette
        feature={{ type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'node', name: 'Valve 1' } }}
      />
    ));
    expect(queryByTestId('status-badge')).toBeNull()
    expect(getByTestId('status-value')).toHaveTextContent('—')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/widgets/properties-palette/ui/properties-palette.test.tsx`
Expected: FAIL — no `status-badge` / `status-value` testids yet.

- [ ] **Step 3: Restyle the component**

Replace the body of `src/widgets/properties-palette/ui/properties-palette.tsx` with:

```tsx
import { Show } from 'solid-js';
import type { NetworkFeature } from '@/entities/map-feature';
import { StatusBadge } from '@/shared/ui';

export function PropertiesPalette(props: { feature: NetworkFeature | undefined }) {
  return (
    <aside class="w-72 shrink-0 border-l border-border bg-background p-4">
      <h2 class="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Properties
      </h2>
      <Show
        when={props.feature}
        fallback={<p data-testid="palette-empty" class="text-sm text-muted-foreground">Select a feature on the map.</p>}
      >
        {(f) => (
          <dl class="divide-y divide-border text-sm">
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-muted-foreground">Name</dt>
              <dd class="font-medium text-foreground">{f().properties.name ?? '—'}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-muted-foreground">Kind</dt>
              <dd class="font-medium text-foreground">{f().properties.kind}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-muted-foreground">Status</dt>
              <dd data-testid="status-value">
                <Show
                  when={f().properties.status}
                  fallback={<span class="font-medium text-foreground">—</span>}
                >
                  {(s) => <StatusBadge status={s()} />}
                </Show>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-muted-foreground">ID</dt>
              <dd class="font-mono text-xs text-foreground">{f().id}</dd>
            </div>
          </dl>
        )}
      </Show>
    </aside>
  );
}
```

- [ ] **Step 4: Run the palette test to verify it passes**

Run: `npx vitest run src/widgets/properties-palette/ui/properties-palette.test.tsx`
Expected: PASS (original 2 + new 2 = 4 tests). The existing `getByText('Valve 1')` / `getByText('node')` assertions still hold.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS

```bash
git add apps/gis/src/widgets/properties-palette/ui/properties-palette.tsx apps/gis/src/widgets/properties-palette/ui/properties-palette.test.tsx
git commit -m "feat(gis): polish PropertiesPalette typography + status badge"
```

---

### Task 5: Unified floating-panel surface

Introduce one shared surface class string and apply it to the floating panels so they read as consistent cards over the map. Styling only — no behavior or markup-structure change, so existing tests stay green.

**Files:**
- Create: `src/shared/ui/surface.ts`
- Modify: `src/shared/ui/index.ts` (export)
- Modify: `src/features/feature-search/ui/feature-search.tsx`
- Modify: `src/features/layer-control/ui/layer-control.tsx`
- Modify: `src/features/coordinate-readout/ui/coordinate-readout.tsx`

**Interfaces:**
- Produces: `export const floatingSurface: string` — border + translucent bg + blur + shadow (no radius; each panel adds its own).

- [ ] **Step 1: Create the surface constant**

Create `src/shared/ui/surface.ts`:

```ts
/** Shared visual treatment for panels that float over the map canvas.
 * Radius is intentionally omitted so each panel picks its own (chip vs card). */
export const floatingSurface =
  'border border-border bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80'
```

- [ ] **Step 2: Export it**

In `src/shared/ui/index.ts`, after the `export { StatusBadge } from './status-badge'` line, add:

```ts
export { floatingSurface } from './surface'
```

- [ ] **Step 3: Apply to FeatureSearch**

In `src/features/feature-search/ui/feature-search.tsx`:

Add the import after the existing imports:

```ts
import { cn } from '@/shared/lib/utils';
import { floatingSurface } from '@/shared/ui';
```

Change the `<input>` class from:

```
class="w-full rounded bg-background/95 px-3 py-1.5 text-sm shadow"
```
to:
```
class={cn('w-full rounded-lg px-3 py-1.5 text-sm', floatingSurface)}
```

Change the results `<ul>` class from:

```
class="mt-1 max-h-64 overflow-auto rounded bg-background shadow-lg"
```
to:
```
class={cn('mt-1 max-h-64 overflow-auto rounded-lg', floatingSurface)}
```

- [ ] **Step 4: Apply to LayerControl**

In `src/features/layer-control/ui/layer-control.tsx`:

Add imports:

```ts
import { cn } from '@/shared/lib/utils';
import { floatingSurface } from '@/shared/ui';
```

Change the trigger `<button>` class from:

```
class="rounded bg-background/90 px-3 py-1.5 shadow"
```
to:
```
class={cn('rounded-lg px-3 py-1.5', floatingSurface)}
```

Change the dropdown `<div>` class from:

```
class="mt-1 w-48 space-y-2 rounded bg-background p-3 shadow-lg"
```
to:
```
class={cn('mt-1 w-48 space-y-2 rounded-lg p-3', floatingSurface)}
```

- [ ] **Step 5: Apply to CoordinateReadout**

In `src/features/coordinate-readout/ui/coordinate-readout.tsx`:

Add imports:

```ts
import { cn } from '@/shared/lib/utils';
import { floatingSurface } from '@/shared/ui';
```

Change the wrapper `<div>` class from:

```
class="rounded bg-background/80 px-2 py-1 font-mono text-xs text-muted-foreground shadow"
```
to:
```
class={cn('rounded-md px-2 py-1 font-mono text-xs text-muted-foreground', floatingSurface)}
```

- [ ] **Step 6: Run the affected suites to confirm no regression**

Run: `npx vitest run src/features/feature-search src/features/layer-control src/features/coordinate-readout src/pages/gis`
Expected: PASS — testids and behavior unchanged.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS

```bash
git add apps/gis/src/shared/ui/surface.ts apps/gis/src/shared/ui/index.ts apps/gis/src/features/feature-search/ui/feature-search.tsx apps/gis/src/features/layer-control/ui/layer-control.tsx apps/gis/src/features/coordinate-readout/ui/coordinate-readout.tsx
git commit -m "feat(gis): unify floating panel surfaces over the map"
```

---

### Task 6: Full verification

**Files:** none (gate only).

- [ ] **Step 1: Full test run**

Run: `npm run test:run`
Expected: PASS — all suites including the new StatusBadge and updated PropertiesPalette tests.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (lint may auto-cache; fix any new warnings introduced by the edits).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: PASS — confirms Tailwind compiles the teal tokens and new classes.

- [ ] **Step 4 (manual, post-deploy): basemap loads**

After deploying the rebuilt image, open the viewer and confirm OSM/Carto tiles render with no `img-src` CSP violations in the console. (No automated harness for nginx CSP.)
