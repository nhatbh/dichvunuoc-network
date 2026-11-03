# GIS-3 Remove + Relocate + GeometryVersion (catalog §5.1) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-gis-be`
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §4.2–4.5 (slice GIS-3)
**Pattern gốc:** mirror GIS-1 RegisterPipe + GIS-2 InstallDevice.

## Scope

Hoàn thiện vòng đời geometry của GIS core: **soft-delete (remove)** cho node/pipe/device,
**relocate** node, và **GeometryVersion** (audit append-only cho mỗi thay đổi geometry của node).

Luồng end-to-end mỗi command: command → aggregate (rule cục bộ) → handler (rule cần I/O qua
repository) → persistence + outbox → integration event → endpoint → 3 tầng test xanh.

Gộp vào slice (đóng follow-up backlog sau GIS-2):

1. **RegisterPipe backstop unique-violation** — pipe handler hiện thiếu nhánh bắt
   `DbUpdateException`/23505 → 409 (node + device đã có). Bổ sung cho đồng nhất.
2. **Update-path test cho device/pipe repo** — nhánh `else` (mutation) của `PersistAsync`
   chưa có round-trip lần-2; remove/relocate chính là mutation đầu tiên → thêm test ở đây.

**Ngoài scope (ghi follow-up):**

- Relocate/reroute cho **pipe** và relocate cho **device** → GeometryVersion cho pipe/device
  hoãn (slice này relocate chỉ có ở node, theo roadmap §4.4). Pipe/device chỉ có remove.
- `network.geometry.changed` v1 (event cross-cutting cho topology/hydraulic) — **defer** tới khi
  có consumer thật (topology-rs Phase 3). Slice này phát `network.node.relocated` là đủ; geometry
  history phục vụ nhu cầu audit/UI ngay.
- Bbox/search query (GIS-4); hard delete (không bao giờ — geometry version + event đã ra ngoài).

## Quyết định chốt (cần user gật)

| # | Quyết định | Chọn | Ghi chú |
|---|---|---|---|
| 1 | Tên event xóa | Giữ `NodeDeleted` → `network.node.deleted` (đã có sẵn domain event) thay vì "removed" như roadmap §4.4 | Tránh churn; cập nhật roadmap dùng "deleted" cho nhất quán |
| 2 | Rule chặn remove | Node: chặn nếu còn pipe **chưa xóa** nối tới (`NodeHasConnectedPipes`) **hoặc** còn device host trên node (`NodeHasAttachedDevices`). Pipe: chặn nếu còn device host trên pipe (`PipeHasAttachedDevices`). Device: không rule, xóa thẳng | Index `ix_network_devices_host_pipe/host_node` thêm ở GIS-2 chính để phục vụ rule này |
| 3 | GeometryVersion phạm vi | **Node-only** slice này: append v1 khi RegisterNode, v(n+1) khi RelocateNode | Pipe/device geometry version defer (chưa có reroute) |
| 4 | Lưu geometry trong version | Cột `geometry geometry(Geometry,4326)` generic + cột `geojson text` tiện đọc; **không GiST** (chỉ đọc theo asset, roadmap §4.3) | Domain giữ geometry dạng GeoJSON string → thuần, không kéo NTS vào Domain |
| 5 | `network.geometry.changed` | Defer (xem Ngoài scope) | |
| 6 | Tenant check trên host/endpoint refs | Vẫn KHÔNG (mirror GIS-1/2) | Follow-up chung |
| 7 | Route geometry-history | `GET /api/network/nodes/{id}/geometry-history` | Giữ resource-scoped, khớp `/api/network/...` (decision 0009) |

## Trạng thái hiện có (đã verify trong code)

- `NetworkNode` **đã có** `DeletedAt`, `SoftDelete()`, domain event `NodeDeleted`/`NodeDeletedData`;
  `NetworkNodeRepository.DeleteAsync` đã soft-delete. **Chưa** có: mapper entry, contract
  `NetworkNodeDeletedV1`, command/handler/endpoint, rule chặn.
- `NetworkPipe`, `NetworkDevice` có `DeletedAt` + `Reconstitute(deletedAt)` nhưng **chưa** có
  `SoftDelete()` / `PipeDeleted` / `DeviceDeleted`; repo `DeleteAsync` ném
  `NotSupportedException("…until GIS-3")`.
- 3 persistence model đã có cột `deleted_at` + `HasQueryFilter(DeletedAt == null)` → **không cần
  migration thêm cột delete**; migration M4 chỉ cho `geometry_versions`.
- Mapper đã là registry (`Dictionary<string, Func<…>>`) sau GIS-2 — chỉ thêm key mới.

## Domain

- **`AssetKind`** VO/enum `{Node, Pipe, Device}` (parse-first, mirror `NodeType`).
- **`GeometryVersion`** entity append-only: `{Id, AssetId, AssetKind, Version (int), GeoJson (string),
  ChangedBy (string?), Reason (string?), ChangedAt}`. Không update/delete. Factory
  `GeometryVersion.Create(assetId, kind, version, geoJson, changedBy, reason)`.
- **`IGeometryVersionStore`** (Domain repo port): `AppendAsync(GeometryVersion)`,
  `GetNextVersionAsync(assetId)`, `ListByAssetAsync(assetId)`.
- **NetworkNode.Relocate(newLocation, changedBy?, reason?)** — đổi `Location`, `MarkAsModified()`,
  raise `NodeRelocated {TenantId, AssetCode, OldLat, OldLng, NewLat, NewLng, Reason}`. Vị trí trùng
  vị trí cũ → `DomainException("NetworkNode.NoLocationChange")` (chặn no-op version rác).
- **NetworkPipe.SoftDelete()** / **NetworkDevice.SoftDelete()** — mirror `NetworkNode.SoftDelete`,
  raise `PipeDeleted` / `DeviceDeleted` (data: TenantId + AssetCode + đặc trưng tối thiểu).

## Application

- **RelocateNodeCommand(NodeId, Latitude, Longitude, Reason?) : ICommand** — handler: load node
  (404 → `NotFoundException`), `Relocate(...)`, append `GeometryVersion` (version kế tiếp từ store,
  geoJson từ điểm mới) **trong cùng transaction** với save aggregate, save. `changedBy` lấy từ
  request context (actor claim — đã có `IRequestContext`).
- **RemoveNodeCommand(NodeId)** — handler: load (404); `INetworkPipeRepository.ExistsByEndpointNodeAsync(nodeId)`
  → true ⇒ `BusinessRuleException("NetworkNode.HasConnectedPipes")` (422);
  `INetworkDeviceRepository.ExistsByHostNodeAsync(nodeId)` → true ⇒ `NetworkNode.HasAttachedDevices` (422);
  else `node.SoftDelete()` + save.
- **RemovePipeCommand(PipeId)** — load (404); `ExistsByHostPipeAsync(pipeId)` → `NetworkPipe.HasAttachedDevices`
  (422); else soft delete.
- **RemoveDeviceCommand(DeviceId)** — load (404); soft delete (không rule).
- **GetNodeGeometryHistoryQuery(NodeId)** → `IReadOnlyList<GeometryVersionDto>` qua Dapper read DAO
  (`IGeometryVersionReadDao`), sắp version giảm dần.

## Infrastructure

- **Migration M4 `geometry_versions`**: `id text pk, asset_id text not null, asset_kind text not null,
  version int not null, geometry geometry(Geometry,4326) null, geojson text not null,
  changed_by text null, reason text null, changed_at timestamptz not null,
  unique (asset_id, version)`; index btree `(asset_id, version desc)`; **không GiST**.
- `GeometryVersionStore` (EF append + `GetNextVersion` qua `MAX(version)+1` theo asset, lock nhẹ bằng
  unique constraint làm chốt cuối — race → retry/Conflict).
- **Pipe/Device repo**: bỏ `throw NotSupportedException` trong `DeleteAsync`, thay bằng load → `SoftDelete()`
  → `SaveAsync` (mirror node repo). Thêm query: `ExistsByEndpointNodeAsync(nodeId)` (pipe repo:
  `from_node_id = @id OR to_node_id = @id AND deleted_at IS NULL`), `ExistsByHostPipeAsync`/
  `ExistsByHostNodeAsync` (device repo). Update-path của `PersistAsync` đã gán `DeletedAt` — thêm test.
- **RegisterPipe backstop**: bọc save trong handler/repo bắt unique-violation 23505 → `ConflictException`
  (mirror node/device).

## Contracts & mapper

- Thêm contract: `NetworkNodeDeletedV1 {NodeId, TenantId, AssetCode, NodeType}`,
  `NetworkPipeDeletedV1 {PipeId, TenantId, AssetCode}`,
  `NetworkDeviceDeletedV1 {DeviceId, TenantId, AssetCode, DeviceType}`,
  `NetworkNodeRelocatedV1 {NodeId, TenantId, AssetCode, OldLatitude, OldLongitude, NewLatitude, NewLongitude, Reason?}`.
- `GisEventTypes`: `NodeDeleted="network.node.deleted"`, `PipeDeleted="network.pipe.deleted"`,
  `DeviceDeleted="network.device.deleted"`, `NodeRelocated="network.node.relocated"`.
- Mapper registry: thêm 4 key + integration event records + helper (mirror các Map* hiện có).

## API

- `DELETE /api/network/nodes/{id}` → 204 (idempotent: đã xóa/không tồn tại → 404 hay 204? **chốt 404**
  nếu không tồn tại, 422 nếu vướng rule); `network-gis:write`.
- `DELETE /api/network/pipes/{id}`, `DELETE /api/network/devices/{id}` → 204; `network-gis:write`.
- `PATCH /api/network/nodes/{id}/location` body `{latitude, longitude, reason?}` → 200/204;
  `RelocateNodeRequest` + validator (range lat/lng); `network-gis:write`.
- `GET /api/network/nodes/{id}/geometry-history` → `GeometryVersionDto[]`; `network-gis:read`.

## Testing

- **Unit**: `AssetKindTests`; `GeometryVersionTests` (append-only, equality); `NetworkNodeTests`
  (Relocate đổi vị trí + raise 1 event, relocate cùng vị trí → 400, SoftDelete raise NodeDeleted);
  `NetworkPipeTests`/`NetworkDeviceTests` (SoftDelete raise *Deleted); handler tests (relocate happy +
  append version; remove node 422 khi có pipe/device; remove pipe 422 khi có device; remove device happy;
  404 cho id lạ).
- **Integration** (PostgisFixture): geometry_versions append + list theo asset, unique (asset,version);
  pipe/device repo soft-delete round-trip (xóa rồi GetById → null do query filter); `ExistsByEndpointNode`/
  `ExistsByHost*` đúng; **update-path**: save→relocate→save lần 2 giữ field + version tăng (đóng follow-up).
- **E2E** (`GisApiFactory`): seed node+pipe+device; DELETE node có pipe → 422 `HasConnectedPipes`;
  DELETE node có device → 422 `HasAttachedDevices`; gỡ device rồi DELETE pipe → 204; PATCH relocate →
  200 + outbox `network.node.relocated` + geometry-history có 2 bản (v1 register, v2 relocate); DELETE
  device → 204 + outbox `network.device.deleted`; relocate lat=99 → 400.
- **Contract**: 4 event mới schema cố định; regression: 3 event cũ vẫn map qua registry; event lạ → null.

## Docs & chốt sổ

- Decision record nếu chốt khác roadmap (event "deleted" vs "removed") — `docs/decisions/00xx-*`.
- Update `template-mapping.md` §7: thêm pattern soft-delete (rule ở handler, không ở aggregate) +
  GeometryVersion append-in-transaction.
- `docs/stories/backlog.md`: đóng follow-up #3 (pipe backstop) + #5 (update-path test); GIS-3 → done.
- Kết thúc: `dotnet test` từng test project xanh, 0 warning; conventional commits.
