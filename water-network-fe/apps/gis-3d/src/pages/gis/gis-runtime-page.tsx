import { Match, Switch, createSignal, lazy, onCleanup } from 'solid-js'
import { getGisRuntimePolicy } from '@/shared/config/runtime-config'
import { GisHome } from './gis-home'
import { LegacyGisHome } from './legacy-gis-home'
import { resolveGisExperience } from './lib/gis-runtime'
import { ThemeProvider } from './lib/theme'
import { TenantGisShell } from './shell/gis-shell'
import { MapPage } from './map-page'

const ImportScreen = lazy(() =>
  import('./screens/import').then(module => ({ default: module.ImportScreen }))
)

const NetworkEditor = lazy(() =>
  import('./network-editor/workspace').then(module => ({ default: module.NetworkEditor }))
)

export function GisRuntimePage() {
  // Import must remain reachable for tenants with no published network yet.
  const [importOpen, setImportOpen] = createSignal(
    ['#import', '#map-drafts'].includes(window.location.hash)
  )
  const [editorOpen, setEditorOpen] = createSignal(window.location.hash === '#editor')
  const [draftMap, setDraftMap] = createSignal(window.location.hash === '#map-drafts')
  const onHashChange = () => {
    setImportOpen(['#import', '#map-drafts'].includes(window.location.hash))
    setDraftMap(window.location.hash === '#map-drafts')
    setEditorOpen(window.location.hash === '#editor')
  }
  window.addEventListener('hashchange', onHashChange)
  onCleanup(() => window.removeEventListener('hashchange', onHashChange))
  const requestedViewer =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('viewer')
  const experience = resolveGisExperience(getGisRuntimePolicy(), requestedViewer)

  return (
    <Switch>
      <Match when={editorOpen() && experience === 'canonical-rich'}>
        <ThemeProvider>
          <TenantGisShell>
            <NetworkEditor />
          </TenantGisShell>
        </ThemeProvider>
      </Match>
      <Match when={importOpen()}>
        <ThemeProvider>
          <TenantGisShell>
            <ImportScreen draftMap={draftMap()} editorMode={editorOpen()} />
          </TenantGisShell>
        </ThemeProvider>
      </Match>
      <Match when={experience === 'legacy-rich'}>
        <LegacyGisHome />
      </Match>
      <Match when={experience === 'canonical-scalable'}>
        <MapPage />
      </Match>
      <Match when={experience === 'canonical-rich'}>
        <GisHome />
      </Match>
    </Switch>
  )
}
