# Network Editor Geometry and Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox tracking. Execution chosen by user: subagent per task with task reviews; completed, final review approved.

**Goal:** Add visible vertex editing and segment dragging to the canonical editor while preserving network connections and atomic undo.

**Architecture:** Keep pointer interaction and projection behind MapEnginePort. Pure geometry helpers are shared by the adapter and editor; the editor owns topology, revision guards, and one commit per gesture. Extend the port through opt-in methods while preserving legacy Modify consumers.

**Tech Stack:** SolidJS, TypeScript, OpenLayers, GeoJSON, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-network-editor-geometry-topology-design.md` (approved in chat on 2026-10-13).

## Global Constraints

- Implement in `apps/gis/src/pages/gis/network-editor`, not the simulated editor or old editor route.
- ZERO `ol` types cross MapEnginePort. No new product dependencies.
- Preserve revision API, expectedVersion, permissions, backup scope, and server validation/publication.
- Both external endpoints remain fixed during segment dragging, including endpoints without refs.
- Vertex edits lock endpoints with valid Node refs; unresolved or invalid refs block Pipe geometry edits.
- A gesture commits once; Esc, pointercancel, selection/tool/scope change, and loss of edit permission cancel without history.
- Split projection uses EPSG:3857; duplicate/endpoint/degenerate tolerance is 0.01 m. Display lengths use ground metres.
- Preserve Device-host split rejection. No auto-junction at geometric crossings.
- Keep all existing uncommitted work. At execution start use using-git-worktrees to determine isolation; canonical editor is currently untracked and must be included in any isolated snapshot before execution.
- Paths below are relative to `water-network-fe`. Run commands from that directory unless a workdir is stated. Stage explicit task paths only.

## Review Focus

- Layer replacement during a drag: cancel against the original snapshot; do not commit stale geometry (Task 3).
- Malformed refs and coincident nodes: do not choose a different Node merely by coordinate proximity (Task 2).
- Editing controls while typing coordinates: Delete/Esc must respect input focus and IME composition (Task 4).
- Save/revision transitions while a gesture is active: discard old completions, preserve the revision payload (Task 4).
- Snap to the active pipe itself or handle overlay: avoid self-snap and keep the translated segment rigid (Tasks 3 and 5).

## File Structure

- Create `packages/map-runtime/src/geometry/line-edit.ts` and `.test.ts`: framework-free projection, line normalization, splitting, handles, segment translation.
- Create `apps/gis/src/pages/gis/network-editor/geometry.ts` and `.test.ts`: editor facade over those exported helpers; no duplicate algorithms.
- Modify `network-editor/model.ts` and `.test.ts`: topology policy and atomic Edit lists.
- Modify `packages/map-runtime/src/port/types.ts`, `port/map-engine-port.ts`, `index.ts`, `testing/fake-port.ts`, `port/map-engine-port.test.ts`: plain edit contracts and deterministic fake emissions.
- Create `packages/map-runtime/src/openlayers/geometry-edit-interaction.ts` and `.test.ts`: target-scoped gestures and handle rendering, isolated from legacy Modify.
- Modify `packages/map-runtime/src/openlayers/ol-map-adapter.ts` and `.test.ts`: wiring, lifecycle, snap/hit-test exclusion.
- Modify `network-editor/workspace.tsx`, `workspace.test.tsx`, `editor.css`: edit tools, selected vertex, transaction guards.
- Create `apps/gis/e2e/network-editor-geometry.spec.ts`: browser verification with mocked session and revision APIs.
- Create `docs/decisions/0014-network-editor-geometry-topology.md`: accepted opt-in port and endpoint policy; record rationale from the approved spec.

## Task 1: Pure geometry and precise splitting

**Interfaces:** Export `LinePoint = [number, number]`, `LINE_TOLERANCE_M = 0.01`, `toMapPoint(p: LinePoint): LinePoint`, `toGeoPoint(p: LinePoint): LinePoint`, `normalizeLine(points: LinePoint[]): LinePoint[]`, `splitLine(points: LinePoint[], click: LinePoint): { point: LinePoint; first: LinePoint[]; second: LinePoint[] }`, `translateSegment(points: LinePoint[], index: number, deltaMap: LinePoint): LinePoint[]`, `lineHandles(points: LinePoint[]): { kind: 'vertex' | 'mid'; index: number; point: LinePoint }[]`. All public line coordinates are EPSG:4326; only map points and deltaMap use EPSG:3857. Inputs remain immutable. Throw descriptive errors for invalid line/index/coordinates. Export from package index and re-export through editor geometry facade.

- [x] Write geometry tests, including these exact assertions:
  ```ts
  expect(LINE_TOLERANCE_M).toBe(0.01)
  const pts: LinePoint[] = [[105,21],[105.001,21]]
  const moved = translateSegment(pts, 0, [0,10])
  expect(moved).toHaveLength(4)
  expect(moved[0]).toEqual(pts[0])
  expect(moved.at(-1)).toEqual(pts.at(-1))
  expect(translateSegment(pts,0,[0,0])).toEqual(pts)
  expect(() => splitLine(pts,pts[0]!)).toThrow()
  expect(splitLine(pts,[105.0005,21.0001]).point[1]).toBeCloseTo(21,10)
  ```
  Add tests for first/middle/last segments, internal-vertex splitting without duplication, non-finite input, invalid indices, coincident points, and projection roundtrip. Normalization uses the defined map-metre tolerance; retain original endpoint tuples when unchanged.
- [x] Run `npm --prefix packages/map-runtime test -- src/geometry/line-edit.test.ts`; verify missing exports fail.
- [x] Implement helpers using spherical Mercator formulas with Earth radius 6378137; reject coordinates outside valid Mercator latitude range. Project the closest point on each nondegenerate segment, resolve ties by lowest index, and splice at an existing internal vertex when within tolerance.
- [x] Update `splitPipe` to consume `splitLine`; retain existing identity/ref/host checks and attribute inheritance. Add model tests for off-line pick, internal vertex, near-endpoint rejection and Device-host rejection.
- [x] Run geometry tests above, then `npm --prefix packages/map-runtime run build`, then `npm --prefix apps/gis run test:run -- src/pages/gis/network-editor/geometry.test.ts src/pages/gis/network-editor/model.test.ts`; expect all pass. Package imports resolve dist, so build precedes app tests.
- [x] Commit only Task 1 paths with message `feat: add precise pipe geometry operations`.

## Task 2: Topology-safe model transactions

**Interfaces:** In model export `pipeEndpointLocks(state: State, edits: Edit[], key: string): number[]` and `modifyAssetGeometry(state: State, edits: Edit[], key: string, geometry: Asset['geometry']): Edit[]`. Locks are endpoint indices, derived from refs resolved against visibleAssets. Missing/wrong-kind refs throw. Node moves update all incident Pipe endpoints in the returned list. Pipe edits reject moved locked endpoints, then canonicalize endpoints within tolerance to exact Node coordinates. No-op returns the input edits by identity. Device edits retain current behavior.

- [x] Write tests: `locked_pipe_endpoint_cannot_move`, `unreferenced_endpoint_can_move`, `missing_ref_blocks_geometry_edit`, `ref_to_device_is_invalid`, `coincident_node_does_not_rebind_ref`, `node_move_updates_incident_pipes_atomically`, `no_op_returns_original_edits`, `preserves_attributes_refs_and_expected_version`. Assert failed operations leave input state/edits unchanged, and updates preserve base versions and before snapshots.
- [x] Run `npm --prefix apps/gis run test:run -- src/pages/gis/network-editor/model.test.ts`; expect new tests fail on missing exports.
- [x] Implement both model functions using Task 1 facade and existing editAsset/visibleAssets. Validate LineString has at least two distinct points and Point exactly one valid coordinate; reject geometry kind mismatches. Preserve point precision and do not infer connections from proximity.
- [x] Run the model suite; expect pass. Ensure Node propagation still emits one list for one workspace commit.
- [x] Commit explicit model paths with message `feat: preserve topology during geometry edits`.

## Task 3: Opt-in geometry edit interaction

**Interfaces:** Add plain port types `GeometryEditTarget { featureId: string; mode: 'vertex' | 'segment'; lockedEndpointIndices: number[]; gestureKey: string }`, `GeometryEditComplete { featureId: string; geometry: Geometry; gestureKey: string }`, `GeometryVertexSelection { featureId: string; vertexIndex: number }`. Port methods: `setGeometryEditTarget(target: GeometryEditTarget | null): void`, `onGeometryEditComplete(cb: (event: GeometryEditComplete) => void): () => void`, `onGeometryVertexSelect(cb: (selection: GeometryVertexSelection | null) => void): () => void`, `deleteSelectedGeometryVertex(): void`. The key identifies scope at gesture start and is echoed unchanged.

- [x] Write fake-port tests for target storage, one complete event, null vertex selection and unsubscribe. Write interaction tests for locked vertices, midpoint insertion, interior deletion, minimum two points, rigid segment drag, completion once, zero delta, Esc/pointercancel and destroy cancellation.
- [x] Run `npm --prefix packages/map-runtime test`; expect new contract/interaction tests fail.
- [x] Add types, exports and fake implementation. Implement `createGeometryEditInteraction(options: GeometryEditInteractionOptions): GeometryEditController` in the new OL file. Options hold map, target feature, target, snap configuration and completion/selection callbacks; controller exposes `cancel(): void`, `deleteSelectedVertex(): void`, `destroy(): void`. Keep OL types internal. Handle hit tolerance is 10 CSS pixels at every zoom; vertex hits precede midpoint hits. Segment mode uses square midpoint handles; vertex mode uses circles. Capture original geometry at gesture start and work from that snapshot throughout.
- [x] Integrate controller lifecycle in adapter. Draw, legacy Modify and opt-in geometry interaction are mutually exclusive. Keep normal legacy methods working for consumers that do not opt in. Target missing from draft disables the controller until that feature is available. Replacing target geometry/layer during a gesture cancels; equal-data rerenders must not create completion events. Snap excludes edited feature and handle layer. Feature click, context-menu and box-select ignore handles. Returning target null restores geometry and clears selected vertex.
- [x] Add tests for draft-source replacement, legacy Modify regression, snap excluding self/handles, mounting after configuration, failed deletion, listener cleanup and selection clearing after insertion/deletion. Implement an interaction test seam using real OL features/map events, not methods that merely mirror implementation.
- [x] Run `npm --prefix packages/map-runtime test`, `npm --prefix packages/map-runtime run typecheck`, `npm --prefix packages/map-runtime run build`; expect pass.
- [x] Write ADR 0014 with port contract, locked endpoints, gesture transactions and compatibility rationale. Commit Task 3 paths with message `feat: add target scoped map geometry editing`.

## Task 4: Canonical workspace tools and atomic undo

**Interfaces:** Consume Tasks 2 and 3. Existing `modify` becomes the vertex tool; add `segment` tool. Node/Device legacy modification delegates to modifyAssetGeometry. Pipe modification uses the new target API only. Completion handler checks gestureKey, featureId, current selection and editable state before one `commit(next)`.

- [x] Extend workspace mocks to capture complete and vertex-select callbacks with a stable fake port. Add tests named `one_drag_one_undo`, `redo_restores_geometry`, `invalid_edit_keeps_history`, `submitted_revision_disables_edit`, `scope_change_rejects_old_completion`, `revision_switch_cancels_drag`, `busy_save_cancels_drag`, `delete_in_input_does_not_edit`, `ime_composition_does_not_delete`, `save_keeps_revision_payload`, `node_move_one_undo_restores_all_pipes`.
- [x] Run `npm --prefix apps/gis run test:run -- src/pages/gis/network-editor/workspace.test.tsx`; expect new tests fail.
- [x] Add buttons `Sửa đỉnh`, `Kéo đoạn`, `Xóa đỉnh`; enable segment only for selected editable Pipe. Disable vertex deletion when no valid interior/unlocked vertex is selected. Add Vietnamese hints explaining endpoints, midpoint insertion, segment movement and Esc. Delete only dispatches to selected vertex; ignore focused edit inputs and composition. Maintain existing asset-delete button behavior.
- [x] Build gestureKey from scope/revision/selection/tool generation. Set target null before switching generation, busy state or permissions. Complete events with stale key are ignored. Model validation errors set error and force geometry rerender from authoritative editor state; no-op skips commit. Preview never calls remember/history/save. Cleanup listeners on unmount.
- [x] Run workspace/model tests and legacy editor regressions via `npm --prefix apps/gis run test:run -- src/pages/gis/network-editor src/pages/gis/editor`; expect pass. Run app typecheck/build and separate any pre-existing failures from introduced failures.
- [x] Commit explicit workspace/style/test paths with message `feat: expose topology safe vertex and segment tools`.

## Task 5: Browser verification and completion review

**Interfaces:** Public canonical editor controls and revision API remain the only entry points. Mock APIs using fixtures matching `network-editor/api.ts`; never use a live tenant for writes.

- [x] Create Playwright fixtures (use intercepted backend-session auth because local mock login lacks tenant context; preserve the existing mock-login auth suite) and a three-node/two-pipe revision with known map coordinates. Write assertions for visible handles, vertex drag, midpoint insertion, interior vertex deletion, two-point segment drag creating four vertices with fixed endpoints, middle segment drag, one undo/redo, Esc, snap on/off, pan/zoom and save/reopen persisted geometry. Assert snapping preserves equal endpoint deltas in map space and no new Node is created by a crossing.
- [x] Run `npm --prefix apps/gis run test:e2e:geometry`; expect new behavior tests fail before integration fixes or pass if fully implemented. Resolve defects using the established debugging workflow; re-run affected tests.
- [x] Run final package tests/typecheck/build, app targeted tests/typecheck/build, and the browser suite once after the last change. Record actual commands and outcomes, including unrelated baseline failures.
- [x] Review scope against the approved spec, inspect diff for unrelated changes, verify no generated files or workspace data are staged. Capture a browser screenshot of handles and changed geometry using mocked revision data.
- [x] Commit the browser tests with message `test: verify canonical network geometry editing`. Mark plan checkboxes accurately. Report implementation, validation and remaining limitations with file links; integrate the branch only according to the user's instructions.
