# Event Catalog Registry (US-X-03)

Registry trung tâm của mọi integration event trong Water Network Platform.
Mỗi event mới phải được thêm vào đây cùng slice tạo ra nó (quy tắc §15.1 roadmap).

> **Lưu ý:** Bảng này mới được khởi tạo ở AST-1. Backfill toàn bộ GIS-produced events
> (deleted/relocated và các event tương lai) là follow-up US-X-03 — thêm khi từng slice ship.

| eventType | version | producer | consumers | payload record | status |
|---|---|---|---|---|---|
| `asset.registered` | v1 | water-network-asset-be | water-network-gis-be (GIS-5 projection), BFF [planned] | `AssetRegisteredV1` | shipped (AST-1) |
| `network.node.registered` | v1 | water-network-gis-be | water-network-asset-be | `NetworkNodeRegisteredV1` | shipped |
| `network.pipe.registered` | v1 | water-network-gis-be | water-network-asset-be | `NetworkPipeRegisteredV1` | shipped |
| `network.device.installed` | v1 | water-network-gis-be | water-network-asset-be | `NetworkDeviceInstalledV1` | shipped |
| `asset.status.changed` | v1 | water-network-asset-be | water-network-gis-be (GIS-5 projection), maintenance/observation [future] | `AssetStatusChangedV1` | shipped (AST-2) |
| `asset.decommissioned` | v1 | water-network-asset-be | none yet (GIS-5 reads `asset.status.changed` instead; maintenance/audit [future]) | `AssetDecommissionedV1` | shipped (AST-2) |
| `asset.technical-profile.updated` | v1 | water-network-asset-be | (none yet) | `AssetTechnicalProfileUpdatedV1` | shipped (AST-2) |
| `design.revision.submitted` | v1 | water-network-design-be | (none yet) | `DesignRevisionSubmittedV1` | shipped (DSN-3) |
| `design.revision.approved` | v1 | water-network-design-be | water-network-design-be (`RevisionApprovedPublishConsumer` — DSN-4) | `DesignRevisionApprovedV1` | shipped (DSN-3) |
| `design.revision.rejected` | v1 | water-network-design-be | (none yet) | `DesignRevisionRejectedV1` | shipped (DSN-3) |
| `design.asset.ready-for-gis` | v1 | water-network-design-be (`RevisionApprovedPublishConsumer` on revision approval) | water-network-gis-be (`DesignAssetImportConsumer`) | `DesignAssetReadyForGisV1` (revision batch of draft assets) | shipped (DSN-4) |
| `network.gis-import.completed` | v1 | water-network-gis-be (`DesignAssetImportConsumer` after batch import) | water-network-design-be (`GisImportCompletedConsumer`) | `NetworkGisImportCompletedV1` (imported[], failed[]) | shipped (DSN-4) |
| `design.revision.published` | v1 | water-network-design-be (`DesignRevision.MarkPublished` → outbox) | (none yet) | `DesignRevisionPublishedV1` | shipped (DSN-4) |
| `incident.reported` | v1 | water-network-incident-be | (none yet; INC-2 isolation, Phase 4 maintenance [future]) | `IncidentReportedV1` | shipped (INC-1) |
| `incident.classified` | v1 | water-network-incident-be | (none yet) | `IncidentClassifiedV1` | shipped (INC-1) |
| `incident.cancelled` | v1 | water-network-incident-be | (none yet) | `IncidentCancelledV1` | shipped (INC-1) |
| `incident.isolation-plan-created` | v1 | water-network-incident-be | (none yet; customer-impact CIM-1 [future]) | `IncidentIsolationPlanCreatedV1` | shipped (INC-2) |
| `incident.isolation-plan-confirmed` | v1 | water-network-incident-be | (none yet; customer-impact CIM-1 [future]) | `IncidentIsolationPlanConfirmedV1` | shipped (INC-3) |
| `maintenance.work-order-requested` | v1 | water-network-incident-be | (none yet; maintenance-be MNT-1 [future]) | `WorkOrderRequestedV1` (FROZEN Phase 3→4 contract) | shipped (INC-3) |
| `incident.resolved` | v1 | water-network-incident-be | (none yet) | `IncidentResolvedV1` | shipped (INC-3) |
