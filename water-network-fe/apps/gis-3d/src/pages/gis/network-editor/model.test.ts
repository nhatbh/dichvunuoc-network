import { expect, it } from 'vitest'
import {
  editAsset,
  visibleAssets,
  splitPipe,
  pipeEndpointLocks,
  modifyAssetGeometry,
  type Asset,
  type Edit,
  type State,
} from './model'
const node = (id: string, x: number): Asset => ({
  draftAssetId: id,
  kind: 'Node',
  assetCode: id,
  clientRef: id,
  geometry: { type: 'Point', coordinates: [[x, 21]] },
  attributes: { nodeType: 'Junction' },
  fromRef: null,
  toRef: null,
  hostRef: null,
})
const pipe: Asset = {
  ...node('p', 105),
  kind: 'Pipe',
  geometry: {
    type: 'LineString',
    coordinates: [
      [105, 21],
      [105.001, 21],
    ],
  },
  attributes: { diameterMm: '100', material: 'HDPE' },
  fromRef: 'n1',
  toRef: 'n2',
}
const state: State = {
  n1: { asset: node('n1', 105), version: 2 },
  n2: { asset: node('n2', 105.001), version: 0 },
  p: { asset: pipe, version: 4 },
}
it('coalesces repeated edits and preserves base version', () => {
  let edits: Edit[] = []
  edits = editAsset(state, edits, 'p', {
    ...pipe,
    attributes: { ...pipe.attributes, diameterMm: '150' },
  })
  edits = editAsset(state, edits, 'p', {
    ...pipe,
    attributes: { ...pipe.attributes, diameterMm: '200' },
  })
  expect(edits).toHaveLength(1)
  expect(edits[0]!.expectedVersion).toBe(4)
  expect(edits[0]!.before).toEqual(pipe)
  expect(visibleAssets(state, edits).p!.asset.attributes.diameterMm).toBe('200')
})
it('deleting a new asset removes the add operation', () => {
  let edits = editAsset(state, [], 'new', node('new', 106))
  edits = editAsset(state, edits, 'new', null)
  expect(edits).toEqual([])
})
it('split retains the original pipe id and inserts a shared endpoint', () => {
  const edits = splitPipe(state, [], 'p', [105.0005, 21])
  const visible = visibleAssets(state, edits)
  const original = visible.p!.asset
  const second = edits.find(e => e.action === 'Add' && e.kind === 'Pipe')!.after!
  expect(original.toRef).toBe(second.fromRef)
  expect(original.geometry.coordinates.at(-1)).toEqual(second.geometry.coordinates[0])
  expect(edits.find(e => e.action === 'Update')?.targetId).toBe('p')
})
it('projects an off-line split and inherits refs attributes and version', () => {
  const edits = splitPipe(state, [], 'p', [105.0005, 21.0001])
  const original = visibleAssets(state, edits).p!.asset
  const second = edits.find(e => e.action === 'Add' && e.kind === 'Pipe')!.after!
  const junction = edits.find(e => e.kind === 'Node')!.after!
  expect(junction.geometry.coordinates[0]![1]).toBeCloseTo(21, 10)
  expect(original.fromRef).toBe('n1')
  expect(second.toRef).toBe('n2')
  expect(second.attributes).toEqual(pipe.attributes)
  expect(edits.find(e => e.targetId === 'p')!.expectedVersion).toBe(4)
})
it('splits an internal vertex without repeated coordinates', () => {
  const middle: [number, number] = [105.0005, 21]
  const extended = {
    ...state,
    p: {
      ...state.p!,
      asset: {
        ...pipe,
        geometry: {
          type: 'LineString' as const,
          coordinates: [pipe.geometry.coordinates[0]!, middle, pipe.geometry.coordinates[1]!],
        },
      },
    },
  }
  const edits = splitPipe(extended, [], 'p', middle)
  expect(visibleAssets(extended, edits).p!.asset.geometry.coordinates).toHaveLength(2)
  expect(
    edits.find(e => e.action === 'Add' && e.kind === 'Pipe')!.after!.geometry.coordinates
  ).toHaveLength(2)
})
it('rejects picks whose projection is within 0.01 metres of endpoint', () => {
  expect(() => splitPipe(state, [], 'p', [105.00000004, 21.001])).toThrow()
})
it('rejects splitting a pipe with a Device host', () => {
  const device: Asset = { ...node('d', 105), kind: 'Device', hostRef: 'p' }
  expect(() =>
    splitPipe({ ...state, d: { asset: device, version: 0 } }, [], 'p', [105.0005, 21])
  ).toThrow(/thiết bị/)
})

it('locked_pipe_endpoint_cannot_move', () => {
  const edits: Edit[] = []
  const snapshot = structuredClone(state)
  expect(pipeEndpointLocks(state, edits, 'p')).toEqual([0, 1])
  expect(() =>
    modifyAssetGeometry(state, edits, 'p', {
      type: 'LineString',
      coordinates: [
        [105.0001, 21],
        [105.001, 21],
      ],
    })
  ).toThrow()
  expect(state).toEqual(snapshot)
  expect(edits).toEqual([])
})
it('unreferenced_endpoint_can_move', () => {
  const free = { ...state, p: { ...state.p!, asset: { ...pipe, fromRef: null } } }
  expect(pipeEndpointLocks(free, [], 'p')).toEqual([1])
  const result = modifyAssetGeometry(free, [], 'p', {
    type: 'LineString',
    coordinates: [
      [105.0001, 21],
      [105.001, 21],
    ],
  })
  expect(visibleAssets(free, result).p!.asset.fromRef).toBeNull()
  expect(visibleAssets(free, result).p!.asset.geometry.coordinates[0]).toEqual([105.0001, 21])
})
it('missing_ref_blocks_geometry_edit', () => {
  const broken = { ...state, p: { ...state.p!, asset: { ...pipe, fromRef: 'missing' } } }
  expect(() => pipeEndpointLocks(broken, [], 'p')).toThrow()
  expect(() => modifyAssetGeometry(broken, [], 'p', pipe.geometry)).toThrow()
  const deleted = editAsset(state, [], 'n1', null)
  expect(() => modifyAssetGeometry(state, deleted, 'p', pipe.geometry)).toThrow()
  expect(deleted).toHaveLength(1)
})
it('ref_to_device_is_invalid', () => {
  const broken = {
    ...state,
    n1: { asset: { ...node('n1', 105), kind: 'Device' as const }, version: 2 },
  }
  expect(() => modifyAssetGeometry(broken, [], 'p', pipe.geometry)).toThrow()
})
it('coincident_node_does_not_rebind_ref', () => {
  const broken = {
    ...state,
    p: { ...state.p!, asset: { ...pipe, fromRef: 'missing' } },
    other: { asset: node('other', 105), version: 0 },
  }
  expect(() => modifyAssetGeometry(broken, [], 'p', pipe.geometry)).toThrow()
})
it('node_move_updates_incident_pipes_atomically', () => {
  const connected = {
    ...state,
    q: {
      asset: {
        ...pipe,
        draftAssetId: 'q',
        fromRef: null,
        toRef: 'n1',
        geometry: {
          type: 'LineString' as const,
          coordinates: [[104.999, 21] as [number, number], [105, 21] as [number, number]],
        },
      },
      version: 7,
    },
  }
  const edits: Edit[] = []
  const snapshot = structuredClone(connected)
  const next = modifyAssetGeometry(connected, edits, 'n1', {
    type: 'Point',
    coordinates: [[105.0002, 21.0003]],
  })
  expect(next).toHaveLength(3)
  const visible = visibleAssets(connected, next)
  expect(visible.p!.asset.geometry.coordinates[0]).toEqual([105.0002, 21.0003])
  expect(visible.q!.asset.geometry.coordinates[1]).toEqual([105.0002, 21.0003])
  expect(connected).toEqual(snapshot)
  expect(edits).toEqual([])
})
it('no_op_returns_original_edits', () => {
  const edits = editAsset(state, [], 'p', { ...pipe, attributes: { diameterMm: '150' } })
  expect(modifyAssetGeometry(state, edits, 'p', structuredClone(pipe.geometry))).toBe(edits)
  expect(modifyAssetGeometry(state, edits, 'n1', node('n1', 105).geometry)).toBe(edits)
})
it('preserves_attributes_refs_and_expected_version', () => {
  const edits = editAsset(state, [], 'p', { ...pipe, attributes: { diameterMm: '150' } })
  const next = modifyAssetGeometry(state, edits, 'p', {
    type: 'LineString',
    coordinates: [
      [105, 21],
      [105.0005, 21.0001],
      [105.001, 21],
    ],
  })
  const update = next[0]!
  expect(update.expectedVersion).toBe(4)
  expect(update.before).toBe(pipe)
  expect(update.id).toBe(edits[0]!.id)
  expect(update.after!.attributes).toEqual({ diameterMm: '150' })
  expect(update.after!.fromRef).toBe('n1')
  expect(update.after!.toRef).toBe('n2')
  expect(update.after!.hostRef).toBeNull()
})
it('canonicalizes sub-tolerance locked endpoints to exact node precision', () => {
  const edits: Edit[] = []
  expect(
    modifyAssetGeometry(state, edits, 'p', {
      type: 'LineString',
      coordinates: [
        [105.00000004, 21],
        [105.001, 21],
      ],
    })
  ).toBe(edits)
})
it('rejects mismatched or invalid geometries without mutations', () => {
  for (const geometry of [
    { type: 'Point' as const, coordinates: [[105, 21] as [number, number]] },
    {
      type: 'LineString' as const,
      coordinates: [[105, 21] as [number, number], [105, 21] as [number, number]],
    },
    {
      type: 'LineString' as const,
      coordinates: [[NaN, 21] as [number, number], [105.001, 21] as [number, number]],
    },
  ]) {
    expect(() => modifyAssetGeometry(state, [], 'p', geometry)).toThrow()
  }
  expect(() => modifyAssetGeometry(state, [], 'n1', { type: 'Point', coordinates: [] })).toThrow()
  expect(() =>
    modifyAssetGeometry(state, [], 'n1', {
      type: 'Point',
      coordinates: [
        [105, 21],
        [106, 21],
      ],
    })
  ).toThrow()
})

it('resolves draft nodes by exact visible key and preserves draft operations', () => {
  const addedNode = node('draft', 105.002)
  let edits = editAsset(state, [], 'draft', addedNode)
  edits = editAsset(state, edits, 'p', {
    ...pipe,
    toRef: 'draft',
    geometry: {
      type: 'LineString',
      coordinates: [
        [105, 21],
        [105.002, 21],
      ],
    },
  })
  const next = modifyAssetGeometry(state, edits, 'draft', {
    type: 'Point',
    coordinates: [[105.003, 21]],
  })
  expect(next).toHaveLength(2)
  expect(next.find(e => e.id === 'draft')!.action).toBe('Add')
  expect(visibleAssets(state, next).p!.asset.geometry.coordinates[1]).toEqual([105.003, 21])
  expect(next.find(e => e.targetId === 'p')!.before).toBe(pipe)
  expect(next.find(e => e.targetId === 'p')!.expectedVersion).toBe(4)
})
it('invalid referenced node coordinates block pipe edit', () => {
  const broken = {
    ...state,
    n1: {
      ...state.n1!,
      asset: { ...node('n1', 105), geometry: { type: 'Point' as const, coordinates: [] } },
    },
  }
  expect(() => pipeEndpointLocks(broken, [], 'p')).toThrow(/tọa độ/)
})
it('device movement preserves host reference and input coordinate independence', () => {
  const device = { ...node('d', 105), kind: 'Device' as const, hostRef: 'p' }
  const deviceState = { ...state, d: { asset: device, version: 3 } }
  const geometry: Asset['geometry'] = { type: 'Point', coordinates: [[105.0003, 21.0002]] }
  const next = modifyAssetGeometry(deviceState, [], 'd', geometry)
  geometry.coordinates[0]![0] = 100
  expect(next).toHaveLength(1)
  expect(next[0]!.after!.hostRef).toBe('p')
  expect(next[0]!.after!.geometry.coordinates).toEqual([[105.0003, 21.0002]])
})
it('failed node propagation leaves existing edits and snapshots unchanged', () => {
  const edits = editAsset(state, [], 'p', { ...pipe, attributes: { diameterMm: '150' } })
  const snapshot = structuredClone(edits)
  expect(() =>
    modifyAssetGeometry(state, edits, 'n1', { type: 'Point', coordinates: [[105.001, 21]] })
  ).toThrow(/degenerate/)
  expect(edits).toEqual(snapshot)
  expect(state.p!.asset).toBe(pipe)
})

it('rejects pipe with wrong stored geometry kind', () => {
  const broken = {
    ...state,
    p: {
      ...state.p!,
      asset: {
        ...pipe,
        geometry: { type: 'Point' as const, coordinates: pipe.geometry.coordinates },
      },
    },
  }
  expect(() => pipeEndpointLocks(broken, [], 'p')).toThrow(/tuyến/)
  expect(() => modifyAssetGeometry(broken, [], 'p', pipe.geometry)).toThrow(/tuyến/)
})
it('malformed connected pipe blocks node propagation atomically', () => {
  const malformed: State = {
    ...state,
    p: {
      ...state.p!,
      asset: {
        ...pipe,
        geometry: { type: 'Point' as const, coordinates: pipe.geometry.coordinates },
      },
    },
  }
  const edits: Edit[] = []
  expect(() =>
    modifyAssetGeometry(malformed, edits, 'n1', { type: 'Point', coordinates: [[105.0002, 21]] })
  ).toThrow(/tuyến/)
  expect(edits).toEqual([])
  expect(malformed.n1!.asset.geometry.coordinates).toEqual([[105, 21]])
})
