# Design

Solid UI and existing map runtime remain. CAD point picking inverts the displayed geometry transform; pointer movement pans rather than placing points. Selected objects and layer controls share one selection. The worker remains authoritative for coordinate conversion and review quality.

ReviewConfig adds optional controlPointTargetCrs=EPSG:4326. In this explicit mode CAD sourceCrs remains null; GIS targets are longitude/latitude. The server derives a local metric plane, fits CAD pairs and validates independent checkpoints before producing geographic output. Incomplete point sets remain saved review drafts. Legacy projected-target control points retain their semantics. Authentication, tenant scoping, version conflicts, material/host/approval gates remain.

The geographic overlay displays verified server geometry; pending inputs are marked pending. No approximate preview is presented as surveyed geometry. Selecting points alone never publishes.
