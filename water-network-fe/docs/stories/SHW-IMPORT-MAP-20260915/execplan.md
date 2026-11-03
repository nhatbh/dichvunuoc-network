# Execution plan

High-risk change request: existing data workflow, public review contract, projection/geometry and live DEV release. Direction was confirmed by the user: point correspondences, not matching existing GIS assets.

1. Preserve current source/auth/publication boundaries; record existing backend control-point behavior.
2. Reorganize import into map, inspector and paired-point alignment workspace.
3. Add explicit geographic-target control-point mode, persist incomplete pairs, validate fit with independent checks and evidence.
4. Verify interaction, geometry/contract and existing import regression behavior; build clean snapshots.
5. Release only required worker and SHW FE changes with guarded immutable digests; inspect real authenticated UI without inventing/saving SHW coordinate pairs.
6. Record live evidence and Harness trace.

Pause only for concrete missing evidence to define real control points or an incompatible external-state change. The interface can be completed without guessing those data.

Completed 2026-09-15: map workbench, geographic-target backend, local/installed-image regression gates, guarded DEV rollout and authenticated readonly smoke. User is left on the new paired-map screen. Real point selection remains a reviewer task rather than fabricated import data.
