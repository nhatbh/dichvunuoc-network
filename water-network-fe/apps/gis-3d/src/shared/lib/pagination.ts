/**
 * Pagination — Solid edition.
 *
 * Pure utility functions are kept identical; the React hooks are replaced
 * with Solid signals + memos so each accessor only invalidates the JSX
 * nodes that read it.
 */

import { createMemo, createSignal, type Accessor } from 'solid-js'

export interface PaginationState {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}

export function calculatePaginationMeta(
  total: number,
  page: number,
  pageSize: number
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize)
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  }
}

export function getPaginationRange(
  currentPage: number,
  totalPages: number,
  delta: number = 2
): (number | '...')[] {
  const range: (number | '...')[] = []
  if (totalPages <= 1) return [1]
  range.push(1)
  const start = Math.max(2, currentPage - delta)
  const end = Math.min(totalPages - 1, currentPage + delta)
  if (start > 2) range.push('...')
  for (let i = start; i <= end; i++) range.push(i)
  if (end < totalPages - 1) range.push('...')
  if (totalPages > 1) range.push(totalPages)
  return range
}

export function getOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize
}

export function paginateArray<T>(items: T[], page: number, pageSize: number): T[] {
  const offset = getOffset(page, pageSize)
  return items.slice(offset, offset + pageSize)
}

export function usePagination(initialPage = 1, initialPageSize = 10) {
  const [page, setPageRaw] = createSignal(initialPage)
  const [pageSize, setPageSizeRaw] = createSignal(initialPageSize)

  return {
    page,
    pageSize,
    setPage: (next: number) => setPageRaw(Math.max(1, next)),
    setPageSize: (next: number) => {
      setPageSizeRaw(next)
      setPageRaw(1)
    },
    nextPage: () => setPageRaw(p => p + 1),
    prevPage: () => setPageRaw(p => Math.max(1, p - 1)),
    reset: () => {
      setPageRaw(initialPage)
      setPageSizeRaw(initialPageSize)
    },
  }
}

export function usePaginationWithMeta(
  totalAccessor: Accessor<number> | number,
  initialPage = 1,
  initialPageSize = 10
) {
  const totalFn: Accessor<number> =
    typeof totalAccessor === 'function' ? totalAccessor : () => totalAccessor
  const base = usePagination(initialPage, initialPageSize)

  const meta = createMemo(() => calculatePaginationMeta(totalFn(), base.page(), base.pageSize()))
  const paginationRange = createMemo(() =>
    getPaginationRange(base.page(), meta().totalPages)
  )

  return {
    ...base,
    meta,
    paginationRange,
    page: base.page,
    pageSize: base.pageSize,
    hasNext: createMemo(() => meta().hasNext),
    hasPrevious: createMemo(() => meta().hasPrevious),
    totalPages: createMemo(() => meta().totalPages),
    nextPage: () => {
      if (meta().hasNext) base.nextPage()
    },
    prevPage: () => {
      if (meta().hasPrevious) base.prevPage()
    },
    goToFirstPage: () => base.setPage(1),
    goToLastPage: () => base.setPage(meta().totalPages),
  }
}

export function useClientPagination<T>(items: Accessor<T[]>, initialPageSize = 10) {
  const pagination = usePaginationWithMeta(() => items().length, 1, initialPageSize)
  const currentItems = createMemo(() =>
    paginateArray(items(), pagination.page(), pagination.pageSize())
  )
  return { ...pagination, currentItems }
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 10
export const DEFAULT_PAGE = 1
