/**
 * Modal manager — Solid edition.
 *
 * Global singleton backed by `createStore`; the Solid store tracks reads at
 * the level of object keys, so subscribers only re-evaluate when *their*
 * modal id changes.
 *
 * The legacy Zustand contract (`useModalStore()` / `useModal(id)`) is kept
 * — `useModalStore()` returns a plain object of accessors + setters.
 */

import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'

export type ModalId = string

interface ModalEntry {
  isOpen: boolean
  data?: unknown
}

interface ModalState {
  modals: Record<ModalId, ModalEntry>
}

const [state, setState] = createStore<ModalState>({ modals: {} })

function open(id: ModalId, data?: unknown) {
  setState('modals', id, { isOpen: true, data })
}

function close(id: ModalId) {
  setState('modals', id, { isOpen: false, data: undefined })
}

function closeAll() {
  for (const key of Object.keys(state.modals)) {
    setState('modals', key, { isOpen: false, data: undefined })
  }
}

function isOpen(id: ModalId): boolean {
  return state.modals[id]?.isOpen ?? false
}

function getData<T = unknown>(id: ModalId): T | undefined {
  return state.modals[id]?.data as T | undefined
}

function setData(id: ModalId, data: unknown) {
  const current = state.modals[id]
  if (current) setState('modals', id, { ...current, data })
}

export function useModalStore() {
  return { open, close, closeAll, isOpen, getData, setData, state }
}

export function useModal<T = unknown>(id: ModalId) {
  const isOpenAccessor = createMemo(() => isOpen(id))
  const dataAccessor = createMemo(() => getData<T>(id))
  return {
    get isOpen() {
      return isOpenAccessor()
    },
    get data() {
      return dataAccessor()
    },
    open: (data?: T) => open(id, data),
    close: () => close(id),
    setData: (data: T) => setData(id, data),
  }
}

export const MODAL_IDS = {
  CONFIRM_DELETE: 'confirmDelete',
  CONFIRM_ACTION: 'confirmAction',
  USER_PROFILE: 'userProfile',
  SETTINGS: 'settings',
  CREATE_POST: 'createPost',
  EDIT_POST: 'editPost',
} as const

export type CommonModalId = (typeof MODAL_IDS)[keyof typeof MODAL_IDS]
