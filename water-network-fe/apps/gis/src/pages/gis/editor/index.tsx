import { AppShell } from '@/widgets/app-shell/app-shell'
import { DigitizeToolbar } from '@/features/digitize'
import { DraftPlane } from '@/features/draft-plane'
import { createSelectionStore } from '@/features/feature-selection/model/selection-store'
import { MapCanvas } from '@/features/map-canvas'
import { getEditorRevisionId, isDesignEditorApi } from '@/shared/config/editor-api'
import { MapRuntimeProvider } from '@/shared/lib/map-runtime'
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime'

const INITIAL_VIEW: MapViewOptions = {
  center: { lon: 105.83, lat: 21.02 },
  zoom: 12,
}

export function GisEditorPage(props: {
  snapshotId?: string
  mapFactory?: (opts: MapViewOptions) => Promise<MapEnginePort>
}) {
  const snapshotId = () => props.snapshotId ?? getEditorRevisionId() ?? 'snap-1'
  const selection = createSelectionStore()

  return (
    <AppShell active="editor">
      <MapRuntimeProvider view={INITIAL_VIEW} factory={props.mapFactory}>
        <div class="relative h-full min-h-0 overflow-hidden bg-[var(--bg)]">
          <MapCanvas
            snapshotId={snapshotId()}
            selectedId={selection.selectedId()}
            onSelect={selection.select}
          />
          <DraftPlane snapshotId={snapshotId()} />

          <div class="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
            <div class="pointer-events-auto">
              <DigitizeToolbar snapshotId={snapshotId()} />
            </div>
          </div>

          <div class="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-[var(--line)] bg-[var(--surface)]/92 px-2.5 py-1.5 text-[10.5px] text-[color:var(--muted)] shadow-sm backdrop-blur">
            {isDesignEditorApi() ? 'Design BFF · revision' : 'Đang biên tập bản nháp'}{' '}
            <span class="font-semibold text-[color:var(--text2)]">{snapshotId()}</span>
          </div>
        </div>
      </MapRuntimeProvider>
    </AppShell>
  )
}
