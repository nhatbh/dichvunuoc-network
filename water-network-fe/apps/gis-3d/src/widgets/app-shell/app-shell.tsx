import { Show, type JSX } from 'solid-js'
import { FEATURE_FLAGS, getFeatureFlag } from '@/shared/lib/feature-flags'

interface AppShellProps {
  active?: string
  children: JSX.Element
}

export function AppShell(props: AppShellProps) {
  return (
    <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Top header bar */}
      <header class="flex h-[53px] shrink-0 items-center gap-3 border-b border-border px-4">
        <div class="flex items-center gap-2">
          <span class="font-bold text-primary">GIS</span>
          <span class="text-sm text-muted-foreground">Mạng lưới cấp nước</span>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div class="flex min-h-0 flex-1">
        {/* Left sidebar */}
        <nav class="flex w-14 shrink-0 flex-col items-center border-r border-border bg-background py-3">
          {/* Map nav item */}
          <a
            href="/gis"
            title="Bản đồ mạng lưới"
            class="flex flex-col items-center gap-1 rounded-lg p-2 text-xs transition-colors"
            classList={{
              'bg-accent text-accent-foreground': props.active === 'map',
              'text-muted-foreground hover:bg-accent hover:text-accent-foreground': props.active !== 'map',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
              <line x1="9" y1="3" x2="9" y2="18" />
              <line x1="15" y1="6" x2="15" y2="21" />
            </svg>
            <span>Bản đồ</span>
          </a>

          <Show when={getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)}>
            <a
              href="/gis/editor"
              title="Biên tập mạng lưới"
              aria-current={props.active === 'editor' ? 'page' : undefined}
              class="mt-1 flex flex-col items-center gap-1 rounded-lg p-2 text-xs transition-colors"
              classList={{
                'bg-accent text-accent-foreground': props.active === 'editor',
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground': props.active !== 'editor',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              <span>Biên tập</span>
            </a>
          </Show>

          <a href="/gis#import" title="Import bản vẽ CAD" class="mt-1 flex flex-col items-center gap-1 rounded-lg p-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></svg>
            <span>Import</span>
          </a>

          {/* Spacer */}
          <div class="flex-1" />

          {/* Footer: "Về cổng" link */}
          <a
            href="/"
            title="Về cổng ứng dụng"
            class="flex flex-col items-center gap-1 rounded-lg p-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>Về cổng</span>
          </a>
        </nav>

        {/* Main content area */}
        <main class="min-w-0 flex-1 overflow-hidden">
          {props.children}
        </main>
      </div>
    </div>
  )
}
