import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
  type Accessor,
} from 'solid-js'
import { createImportApi, ImportApiError, importErrorMessage, type ImportApi } from './api'
import {
  isProcessing,
  reviewForJob,
  validateReview,
  type FeaturePage,
  type ImportCapabilities,
  type ImportJob,
  type ReviewConfig,
} from './types'

export const PREVIEW_LIMIT = 10_000

export function createImportWorkspace(scope: Accessor<string>) {
  const [jobs, setJobs] = createSignal<ImportJob[]>([])
  const [job, setJob] = createSignal<ImportJob | null>(null)
  const [config, setConfig] = createSignal<ReviewConfig | null>(null)
  const [undoStack, setUndoStack] = createSignal<ReviewConfig[]>([])
  const [redoStack, setRedoStack] = createSignal<ReviewConfig[]>([])
  const [dirty, setDirty] = createSignal(false)
  const [sketchActive, setSketchActive] = createSignal(false)
  const [capabilities, setCapabilities] = createSignal<ImportCapabilities | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')
  const [previewError, setPreviewError] = createSignal('')
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [preview, setPreview] = createSignal<FeaturePage | null>(null)
  const [rawPreview, setRawPreview] = createSignal<FeaturePage | null>(null)
  const [view, setView] = createSignal<'raw' | 'clean'>('raw')
  const [api, setApi] = createSignal<ImportApi | null>(null)
  let generation = 0
  let selectionVersion = 0
  let previewVersion = 0

  function receive(next: ImportJob, resetConfig = true) {
    // A revision and its committed config must become visible together to review editors.
    batch(() => {
      if (job()?.id !== next.id || job()?.version !== next.version) {
        setRawPreview(null)
        setView('raw')
      }
      setJobs(list => [next, ...list.filter(item => item.id !== next.id)])
      setJob(next)
      if (resetConfig) {
        setUndoStack([])
        setRedoStack([])
        setConfig(reviewForJob(next))
        setDirty(false)
      }
    })
  }

  createEffect(
    on(scope, nextScope => {
      const epoch = ++generation
      selectionVersion++
      previewVersion++
      const controller = new AbortController()
      setJobs([])
      setJob(null)
      setConfig(null)
      setPreview(null)
      setRawPreview(null)
      setDirty(false)
      setUndoStack([])
      setRedoStack([])
      setCapabilities(null)
      setError('')
      setPreviewError('')
      setBusy(false)
      setLoading(false)
      setPreviewLoading(false)
      setView('raw')
      setApi(null)
      onCleanup(() => controller.abort())
      if (!nextScope) return
      const client = createImportApi(nextScope, controller.signal)
      setApi(client)
      setLoading(true)
      void Promise.allSettled([client.capabilities(), client.list()]).then(results => {
        if (epoch !== generation || controller.signal.aborted) return
        const [caps, list] = results
        if (caps.status === 'fulfilled') setCapabilities(caps.value)
        if (list.status === 'fulfilled') {
          setJobs(list.value.items)
          const initial =
            list.value.items.find(j =>
              j.files.some(f => !j.reviewConfig?.excludedFileIds?.includes(f.id))
            ) ?? list.value.items[0]
          if (initial) receive(initial)
        }
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') setError(importErrorMessage(failure.reason))
        setLoading(false)
      })
    })
  )
  onCleanup(() => {
    generation++
    selectionVersion++
    previewVersion++
  })

  async function handleFailure(
    cause: unknown,
    client: ImportApi,
    epoch: number,
    selectedId?: string
  ) {
    if (epoch !== generation || (cause instanceof Error && cause.name === 'AbortError')) return
    setError(importErrorMessage(cause))
    if (cause instanceof ImportApiError && [409, 502].includes(cause.status) && selectedId) {
      try {
        const fresh = await client.get(selectedId)
        if (epoch === generation && job()?.id === selectedId) receive(fresh)
      } catch {
        /* retain the original actionable error */
      }
    }
  }

  async function refresh() {
    const client = api()
    const epoch = generation
    const selectedId = job()?.id
    if (!client || busy()) return
    setLoading(true)
    setError('')
    try {
      const results = await Promise.allSettled([client.capabilities(), client.list()])
      if (epoch !== generation) return
      const [caps, list] = results
      if (caps.status === 'fulfilled') setCapabilities(caps.value)
      if (list.status === 'fulfilled') {
        setJobs(list.value.items)
        if (job()?.id === selectedId && !dirty()) {
          const current =
            list.value.items.find(item => item.id === selectedId) ??
            (!selectedId ? list.value.items[0] : undefined)
          if (current) receive(current)
          else {
            setJob(null)
            setConfig(null)
            setRawPreview(null)
            setPreview(null)
          }
        }
      }
      for (const result of results)
        if (result.status === 'rejected') await handleFailure(result.reason, client, epoch)
    } finally {
      if (epoch === generation) setLoading(false)
    }
  }

  async function select(id: string) {
    const client = api()
    const epoch = generation
    const selected = ++selectionVersion
    if (!client || busy()) return
    setJob(null)
    setRawPreview(null)
    setConfig(null)
    setDirty(false)
    setError('')
    setLoading(true)
    try {
      const result = await client.get(id)
      if (epoch === generation && selected === selectionVersion) receive(result)
    } catch (cause) {
      if (selected === selectionVersion) await handleFailure(cause, client, epoch)
    } finally {
      if (epoch === generation && selected === selectionVersion) setLoading(false)
    }
  }

  async function mutate(run: (client: ImportApi) => Promise<ImportJob>) {
    const client = api()
    const epoch = generation
    const selectedId = job()?.id
    if (!client || busy() || loading()) return
    setBusy(true)
    setError('')
    try {
      const result = await run(client)
      if (epoch === generation) receive(result)
    } catch (cause) {
      await handleFailure(cause, client, epoch, selectedId)
    } finally {
      if (epoch === generation) setBusy(false)
    }
  }

  createEffect(
    on(
      () => [job()?.id, job()?.state, api()] as const,
      ([id, state, client]) => {
        if (!id || !client || !state || !['queued', 'analyzing', 'submitting'].includes(state))
          return
        const epoch = generation
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
          if (cancelled || epoch !== generation) return
          try {
            const next = await client.get(id)
            if (cancelled || epoch !== generation || untrack(job)?.id !== id) return
            receive(next, !untrack(dirty))
            if (isProcessing(next)) timer = setTimeout(() => void poll(), 2000)
          } catch (cause) {
            if (!cancelled) await handleFailure(cause, client, epoch, id)
          }
        }
        timer = setTimeout(() => void poll(), 2000)
        onCleanup(() => {
          cancelled = true
          clearTimeout(timer)
        })
      }
    )
  )

  const previewKey = createMemo(() => {
    const current = job()
    return current?.inventory && !isProcessing(current)
      ? `${current.id}:${current.version}:${view()}`
      : null
  })
  createEffect(
    on(previewKey, key => {
      const request = ++previewVersion
      const client = untrack(api)
      const current = untrack(job)
      const epoch = generation
      setPreview(null)
      setPreviewError('')
      setPreviewLoading(false)
      if (!key || !client || !current) return
      setPreviewLoading(true)
      void client
        .features(current.id, untrack(view))
        .then(page => {
          if (epoch !== generation || request !== previewVersion) return
          if (page.version !== current.version)
            throw new ImportApiError(
              'Bản xem trước đã thay đổi. Tải lại hồ sơ để xem đúng phiên bản.',
              409
            )
          setPreview(page)
          if (key.endsWith(':raw')) setRawPreview(page)
        })
        .catch(cause => {
          if (epoch === generation && request === previewVersion)
            setPreviewError(importErrorMessage(cause))
        })
        .finally(() => {
          if (epoch === generation && request === previewVersion) setPreviewLoading(false)
        })
    })
  )

  async function loadMore() {
    const client = api()
    const current = job()
    const previous = preview()
    const epoch = generation
    const request = previewVersion
    if (
      !client ||
      !current ||
      !previous?.hasMore ||
      previewLoading() ||
      previous.features.length >= PREVIEW_LIMIT
    )
      return
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const next = await client.features(
        current.id,
        view(),
        previous.offset + previous.features.length
      )
      if (epoch !== generation || request !== previewVersion) return
      if (next.version !== previous.version || next.coordinateSpace !== previous.coordinateSpace)
        throw new ImportApiError('Phiên bản xem trước đã thay đổi. Tải lại hồ sơ.', 409)
      const combined = {
        ...previous,
        features: [...previous.features, ...next.features],
        hasMore: next.hasMore,
        total: next.total,
      }
      setPreview(combined)
      if (view() === 'raw') setRawPreview(combined)
    } catch (cause) {
      if (epoch === generation && request === previewVersion)
        setPreviewError(importErrorMessage(cause))
    } finally {
      if (epoch === generation && request === previewVersion) setPreviewLoading(false)
    }
  }

  function edit(change: (value: ReviewConfig) => ReviewConfig) {
    const current = config()
    if (!current || busy() || isProcessing(job()) || job()?.submission?.revisionId) return
    setUndoStack(stack => [...stack.slice(-49), structuredClone(current)])
    setRedoStack([])
    setConfig(change(current))
    setDirty(true)
  }
  async function save() {
    if (sketchActive()) {
      setError('Hoàn tất hoặc hủy thao tác vẽ trước khi lưu bản nháp.')
      return
    }
    const current = job()
    const review = config()
    if (!current || !review) return
    const validation = validateReview(review)
    if (validation) {
      setError(validation)
      return
    }
    await mutate(client =>
      client.review(current.id, current.version, {
        ...review,
        sourceCrs: review.sourceCrs?.trim() || null,
        crsEvidence: review.crsEvidence.trim(),
      })
    )
  }

  async function downloadReport() {
    const client = api()
    const current = job()
    const epoch = generation
    if (!client || !current || busy()) return
    setBusy(true)
    setError('')
    try {
      const blob = await client.report(current.id)
      if (epoch !== generation) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `import-${current.id}-quality.json`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      await handleFailure(cause, client, epoch, current.id)
    } finally {
      if (epoch === generation) setBusy(false)
    }
  }

  return {
    jobs,
    job,
    config,
    dirty,
    sketchActive,
    setSketchActive,
    capabilities,
    busy,
    loading,
    error,
    previewError,
    previewLoading,
    preview,
    rawPreview,
    view,
    setView,
    refresh,
    select,
    mutate,
    edit,
    save,
    canUndo: () => undoStack().length > 0,
    canRedo: () => redoStack().length > 0,
    undo: () => {
      const current = config(),
        stack = undoStack()
      if (!current || !stack.length || busy() || isProcessing(job()) || job()?.submission) return
      setRedoStack(items => [...items, structuredClone(current)])
      setConfig(stack[stack.length - 1]!)
      setUndoStack(stack.slice(0, -1))
      setDirty(true)
    },
    redo: () => {
      const current = config(),
        stack = redoStack()
      if (!current || !stack.length || busy() || isProcessing(job()) || job()?.submission) return
      setUndoStack(items => [...items, structuredClone(current)])
      setConfig(stack[stack.length - 1]!)
      setRedoStack(stack.slice(0, -1))
      setDirty(true)
    },
    loadMore,
    downloadReport,
    setError,
    locked: createMemo(
      () => busy() || loading() || isProcessing(job()) || !!job()?.submission?.revisionId
    ),
  }
}
