# @wn/map-runtime

OpenLayers map engine behind `MapEnginePort` for the water-network fleet. Only
`src/openlayers/*` may import `ol`/`proj4`; everything else depends on the port.
Published package (registry decision deferred — consumed via `file:` in Phase 0).
