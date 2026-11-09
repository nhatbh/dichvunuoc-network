import { describe, expect, it } from 'vitest'
import type { Branch } from '../lib/branch-store'
import { OFFICIAL_BRANCH_ID, liveBranches, type RevisionRow } from './live-branches'

const network = { pipeKm: 14.8, assets: 114, today: '09/11/2026' }
const row = (over: Partial<RevisionRow>): RevisionRow => ({
  id: 'r1', projectId: 'p1', name: 'Van biên khu A', status: 'Draft', version: 3,
  createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T09:00:00Z', returnedReason: null, ...over,
})

describe('editor branches on the live network', () => {
  it('starts with the published network, locked, to clone', () => {
    const [official] = liveBranches([], [], network)
    expect(official).toMatchObject({ id: OFFICIAL_BRANCH_ID, state: 'official', lane: 'current', pipeKm: 14.8, assets: 114 })
    expect(official!.revisionId).toBeUndefined()
  })

  it('makes one branch per design revision, opened through its revision', () => {
    const branches = liveBranches(
      [
        row({ id: 'draft', status: 'Draft' }),
        row({ id: 'checked', status: 'Validated' }),
        row({ id: 'review', status: 'Submitted' }),
        row({ id: 'done', status: 'Published' }),
      ],
      [],
      network
    )
    const by = Object.fromEntries(branches.map(b => [b.id, b]))
    expect(by.draft).toMatchObject({ state: 'draft', lane: 'future', revisionId: 'draft', name: 'Van biên khu A', base: OFFICIAL_BRANCH_ID })
    expect(by.checked!.state).toBe('draft')
    expect(by.review!.state).toBe('review')
    expect(by.done).toMatchObject({ state: 'archived', lane: 'past' })
    expect(by.draft!.touched).toBe(Date.parse('2026-11-09T09:00:00Z'))
  })

  it('says why a reviewer sent a branch back', () => {
    const [, returned] = liveBranches([row({ returnedReason: 'Thiếu van' })], [], network)
    expect(returned!.note).toContain('Thiếu van')
  })

  it('keeps branches made in this session and does not list their revision twice', () => {
    const local: Branch = {
      id: 'B-NEW1', name: 'Bản sửa', lane: 'future', state: 'draft', ver: 'v1', base: OFFICIAL_BRANCH_ID,
      at: 'vừa xong', by: '', cards: [], x: 0, y: 0, pipeKm: 0, assets: 0, note: '', revisionId: 'r1',
    }
    const branches = liveBranches([row({ id: 'r1' }), row({ id: 'r2' })], [local], network)
    expect(branches.map(b => b.id)).toEqual([OFFICIAL_BRANCH_ID, 'B-NEW1', 'r2'])
  })
})
