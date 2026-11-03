export type EditorApiMode = 'snapshot' | 'design'

/**
 * The core editor was originally built against the snapshot mock contract.
 * Dev VPS currently exposes the Design workflow instead, so keep the choice at
 * the API boundary and leave the default/test behavior unchanged.
 */
export function getEditorApiMode(): EditorApiMode {
  return import.meta.env.VITE_EDITOR_API_MODE === 'design' ? 'design' : 'snapshot'
}

export function isDesignEditorApi(): boolean {
  return getEditorApiMode() === 'design'
}

export function getEditorRevisionId(): string | undefined {
  const value = import.meta.env.VITE_EDITOR_REVISION_ID?.trim()
  return value || undefined
}

export const DESIGN_BFF_PATH = '/bff/water-network/design'
