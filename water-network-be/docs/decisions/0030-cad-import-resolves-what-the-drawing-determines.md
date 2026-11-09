# 0030 — The CAD import fills in what the drawing determines, and nothing else

Date: 2026-11-09. Status: Accepted (user, 2026-11-09).

## Context

Importing a real design drawing ("1.MB-PP-Vinh Thinh - Dot 3") left most of the network
unnamed. Every node the drawing has no symbol for became a plain Junction, though the pipes
meeting there make it a tee, a cross, a reducer or a bend. Fittings and valves carried no size,
though the pipe they sit on has one. Every valve needed the reviewer to pick its pipe by
feature id (decision 0027, "a device host is never guessed"), even when the symbol is drawn on
exactly one pipe. A first attempt completed the network for the local stack with invented assets
(source, meter, caps, washouts, hydrants every 150 m, DMA/year/condition values). The user
rejected that: use the file, fill in only what is unknown, and let the importer do it.

## Decision

The import service (`water-network-import`, engine) resolves, from the drawing alone:

1. **Fittings.** A node generated at pipe ends gets its component from the pipes meeting there:
   3 → Tee, or ReducingTee when the diameters differ; 4 → Cross; 2 of different diameter →
   Reducer; 2 turning by at least `bendMinAngleDeg` (default 11.25°) → Bend. Dead ends, straight
   joints and nodes where more than 4 pipes meet stay Junction. These nodes carry
   `componentFrom = geometry` among their draft attributes (provenance, not a catalog property).
2. **Values.** Every node and every pipe-hosted device gets `dn`, `dn2` (Reducer/ReducingTee),
   `material` (only when all pipes there agree) and `angle` (Bend, only when it turns by at least
   the threshold) from those pipes, when the drawing (block attributes) gave none and the catalog
   accepts the value. A value outside the catalog's range is left out.
3. **Drawn symbols are not overruled.** A block's component stays; a Bend/Reducer/Cap/Junction
   symbol where 3+ pipes meet raises the warning `FITTING_BRANCH_MISMATCH`.
4. **Device hosts.** A device with no host selection goes on the one accepted pipe or node within
   `hostToleranceM` of its symbol (in drawing units, scaled for `sourceUnits = mm`); info
   `DEVICE_HOST_RESOLVED` reports how many. With none or several in reach the device still needs
   the reviewer (`DEVICE_HOST_REQUIRED`). An explicit selection always wins. This narrows decision
   0027's "never guessed" to "never guessed when the drawing is ambiguous".

Nothing the drawing does not show is added (no caps at dead ends, sources, meters, hydrants,
washouts, valve states, DMA or year). Both behaviours are on by default and can be switched off
per review (`inferFittings`, `resolveDeviceHosts`).

The local stack seeds the importer's draft output for the Dot 3 drawing unchanged
(`scripts/local-stack/networks/vinh-thinh-dot3.drafts.json`, regenerated from
`vinh-thinh-dot3.review.json`; the review has no device-host selections).

## Consequences

- Dot 3 imports with no host selections: 43 pipes, 44 nodes (13 ReducingTee, 1 Tee, 1 Cross,
  6 Bend, 4 Reducer, 19 Junction), 27 GateValves on the same pipes a reviewer chose by hand.
- The network has no source node, so upstream traces find none until one is added in the editor.
- All 4 drawn Reducers sit between pipes of one diameter (the layers do not change there), so
  their `dn2` stays unknown; 3 of the 5 drawn Bends sit on straight runs and keep `angle` unknown.
