/* Editor branches on the live network (plan EDT-2). The tenant's design revisions are the
   branches: nothing is kept in the browser, so every user of the tenant sees the same list.
   The published network is the locked "official" branch the editor clones from. */
import type { Branch } from '../lib/branch-store'

/** A row of GET /api/gis/editor/revisions (design-be). */
export interface RevisionRow {
  id: string
  projectId?: string
  name?: string | null
  status: string
  version: number
  createdAt?: string
  updatedAt?: string
  /** Why a reviewer sent the revision back to Draft, when that was the last step. */
  returnedReason?: string | null
}

export interface PublishedNetwork {
  pipeKm: number
  assets: number
  today: string
}

export const OFFICIAL_BRANCH_ID = 'official'

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : ''

function fromRevision(row: RevisionRow, network: PublishedNetwork): Branch {
  const done = ['Approved', 'Published', 'PartiallyPublished'].includes(row.status)
  const state: Branch['state'] = done ? 'archived' : row.status === 'Submitted' ? 'review' : 'draft'
  const touched = Date.parse(row.updatedAt ?? row.createdAt ?? '')
  return {
    id: row.id,
    name: row.name?.trim() || 'Bản nháp ' + row.id.slice(0, 8),
    lane: done ? 'past' : 'future',
    state,
    ver: 'v' + row.version,
    base: OFFICIAL_BRANCH_ID,
    at: when(row.updatedAt ?? row.createdAt),
    by: '',
    cards: [],
    x: 0,
    y: 0,
    // a revision edits the published network; its figures are the network's until it publishes
    pipeKm: network.pipeKm,
    assets: network.assets,
    note: row.returnedReason ? 'Bị trả lại: ' + row.returnedReason : '',
    revisionId: row.id,
    ...(Number.isFinite(touched) ? { touched } : {}),
  }
}

/**
 * The gate's branches: the published network, the branches started in this session (until the
 * server lists their revision under them), then one per design revision.
 */
export function liveBranches(rows: RevisionRow[], session: Branch[], network: PublishedNetwork): Branch[] {
  const official: Branch = {
    id: OFFICIAL_BRANCH_ID,
    name: 'Mạng lưới chính thức',
    lane: 'current',
    state: 'official',
    ver: network.today,
    base: null,
    at: network.today,
    by: '',
    cards: [],
    x: 0,
    y: 0,
    pipeKm: network.pipeKm,
    assets: network.assets,
    note: 'Mạng lưới đang vận hành. Nhân bản để chỉnh sửa; thay đổi được duyệt rồi mới xuất bản.',
  }
  const claimed = new Set(session.map(b => b.revisionId).filter(Boolean))
  return [official, ...session, ...rows.filter(r => !claimed.has(r.id)).map(r => fromRevision(r, network))]
}
