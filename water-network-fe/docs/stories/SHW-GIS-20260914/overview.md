# SHW authenticated GIS landing repair

Status: completed for the reported GIS crash, authenticated import access, upload and initial review of both original DWGs. Fresh direct `/gis` navigation passed. Asset publication remains gated by missing source evidence and unresolved review items.

The authenticated `/gis` landing previously failed in `NetworkMapOL` at `sourceDevices.map` because the older legacy seed omitted that collection. SHW also omitted `gisDataSource`, selecting the legacy `/full` boundary by default. The observed response contained 1,186 global sample pipes and did not represent the newly provisioned SHW network.

The isolated SHW runtime now explicitly selects canonical data and the rich viewer. A canonical tenant with no published network has an honest empty state and an `Import CAD` entry. The legacy parser supplies an empty collection only for its historically absent `sourceDevices` field; malformed required data is rejected. A later render error has a retry path that waits for refreshed data before resetting the boundary.

Authenticated investigation additionally exposed an unavailable catalog dependency and the use of a role-filtered menu as an entitlement decision. The additive app-access endpoint and BFF integration are deployed. The existing SHW session received catalog access 204 and canonical/bootstrap, import capabilities and job-list responses 200. The dashboard showed the expected empty network and one import link, with no global map error or 403. This establishes access; it does not establish completed upload or publication.

Affected contract: `../../product/water-network-fe.md`. Decisions: `../../decisions/0011-shw-canonical-runtime.md` and repository-root `platform-core/docs/decisions/0010-selected-organization-app-access.md`. Related catalog story: `platform-core/docs/stories/SHW-APP-ACCESS-20260914/`.

Both originals were uploaded once into SHW job `8aa0a8c0-a4d8-4d8a-a217-790534afa232`. The coordinating agent saved 28 layer rules and 16 block rules through the real UI, reaching persisted version 4 at `2026-09-14T11:11:34Z`. The cleaned preview loaded all 813 features and was visually checked. The review retains 786 pipes and excludes 9,007 features; 815 blocking issues and six warnings remain visible.

Existing selected-Organization authentication, application permissions, CRS and publication controls remain authoritative. No GIS draft or asset publication was created. Missing CRS/material evidence, 27 device-host assignments and 60 intentionally unresolved features remain review gates; source lifecycle evidence must also be confirmed before publication.
