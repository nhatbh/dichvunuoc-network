# Execution plan

Lane: high-risk. The repair affects a tenant data-source boundary, existing behavior and an authenticated flow whose earlier proof was incomplete. The user's SHW import request and reported error provide a concrete direction.

## Completed evidence

1. Reproduced the authenticated landing failure and inspected runtime and legacy seed. The initial `/gis#import` view rendered SHW with zero jobs; this was diagnostic evidence, not proof of the repaired flow.
2. Added legacy boundary parsing, absent-collection compatibility and recovery after refreshed data arrives.
3. Declared canonical/rich in the isolated SHW runtime and added one import entry.
4. Ran component, contract, route and rollout-helper regressions; app typecheck and the additional reviewer-requested retry case passed.
5. Built clean FE source `76962e9eef6c3ac7c0616a34fb46c0422f076694` and deployed its immutable image to SHW only. Public delivery and structural preservation checks passed with two Ready replicas.
6. Added, tested and deployed the separate app-access contract after investigation exposed the catalog dependency problem. The coordinating agent's real SHW browser then passed import capabilities/jobs and canonical bootstrap; the dashboard rendered the empty state with one Import CAD link and no global map error.

## Final authenticated and upload evidence

The coordinating agent verified fresh direct `/gis` navigation in the actual SHW session: the canonical empty state rendered with one Import CAD link and no global map error. Import capabilities/jobs and canonical bootstrap succeeded through the deployed entitlement path.

The two original DWGs were uploaded once into job `8aa0a8c0-a4d8-4d8a-a217-790534afa232`. Storage checks matched both original hashes. The UI persisted 28 layer rules and 16 block rules as version 4 at `2026-09-14T11:11:34Z`; the cleaned preview loaded 813/813 features and was visually checked. Result: 786 retained pipes, 9,007 excluded features, 815 blocking issues and six warnings.

The repair and initial import review are complete. The job deliberately remains in review, with missing CRS/material evidence, 27 device-host assignments and 60 unresolved features. No GIS draft or publication was created. Those data-quality gates require source evidence and review rather than another runtime bypass.

Final proof is recorded in `validation.md` and the main-workspace sanitized receipts. The local Harness closeout records this bounded repair and upload/review outcome; it does not mark asset publication complete.

No authentication bypass, broad role grant, migration or sample-data fallback is authorized as a shortcut. CRS and publication-review gates still apply to the provided drawings.
