# Scoped map geometry editing

Status: accepted. Design: `docs/superpowers/specs/2026-10-13-network-editor-geometry-topology-design.md`.

## Decision

Add opt-in plain-data methods to MapEnginePort: `setGeometryEditTarget`,
`onGeometryEditComplete`, `onGeometryVertexSelect`, and
`deleteSelectedGeometryVertex`. A target contains featureId, vertex/segment mode,
lockedEndpointIndices, and gestureKey. Completion contains one featureId,
EPSG:4326 GeoJSON geometry, and the unchanged gestureKey captured for the scope.
Vertex selection contains featureId/vertexIndex or null. No OpenLayers type
crosses this boundary.

The adapter binds a separate controller to the target feature in draft. Vertex
mode supports LineString vertices/midpoint insertion/interior deletion and Point
dragging. Point has no insertion, deletion, or segment mode. Legacy Modify and
Draw are mutually exclusive with scoped editing; their existing APIs remain for
older consumers. Canonical Node/Device editing uses the scoped Point interaction,
so one completion can never represent modifications to multiple draft assets.

## Gesture transaction and endpoint policy

Capture a geometry snapshot at pointer-down and calculate every preview from it.
Emit one completion on release only when validated geometry changes. A midpoint
insertion or successful deletion produces one completion. Reject endpoint
deletion, fewer than two line coordinates, non-finite coordinates, and
degenerate lines. Locked endpoint handles cannot drag; after insertion/deletion,
the end lock still follows the actual final coordinate. Model validation remains
authoritative for referenced Node endpoints and invalid/unresolved refs.

Segment handles are squares; vertex mode handles are circles. Hit tolerance is
10 CSS pixels, with vertex hits preceding midpoint hits. Segment translation uses
EPSG:3857 and the shared framework-free geometry helper. Preserve both exact
outside map coordinates; add connecting segments when translating an outside
segment, including a four-coordinate result for a two-coordinate line. Snap the
handle anchor and apply its delta rigidly to the segment. Snap considers asset
features only, excludes the edited id/feature, and never includes handle layers.

Esc, pointercancel, target/scope/tool/selection changes, and destroy restore the
snapshot without completion. Authoritative target geometry replacement cancels
before replacement, preserving the new data. Equal target geometry rerenders
retain the real target feature, controller, preview, and vertex selection even
when other assets or properties change. Missing draft targets wait until supplied.
Null target clears selection. Controllers remove their overlay, interaction, and
DOM/feature listeners on destroy. Consumed handle release prevents synthesized
asset clicks; handle layers are excluded from feature/context-menu hit tests and
never enter box-selection sources or serialization.

## Consequences and verification boundary

The controller owns preview only. The canonical editor checks gestureKey,
permission, revision, and topology before committing one model transaction and
history entry. Failed validation rerenders authoritative geometry. Existing
revision APIs, server validation, expectedVersion, and publication are unchanged.

Runtime tests use real OL maps, features, geometries and MapBrowserEvent objects,
with only absent jsdom pixel transforms supplied by the test utility. Integration
and browser tests in later tasks validate the canonical editor's transaction,
permission, persistence, and native pointer behavior.
