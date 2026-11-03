# DSN-5 CAD Import Ingestion (DWG/DXF → Draft Assets) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-design-be` (Phase 2+, slice DSN-5) — BE-only
**Phụ thuộc:** DSN-1 (`DesignDocument` upload + `IFileStoragePort`/MinIO + `DesignDocumentUploaded` event đã ship); DSN-2 (`DraftNetworkAsset` + `CreateDraftAssetsBatch` command đã ship); DSN-3 (`DesignRevision` state machine đã ship); DSN-4 (publish→GIS qua event `DesignAssetReadyForGis`, gis-be consume, ledger idempotent đã ship).
**Follow-up ngoài scope (không code ở slice này):** FE review màn hình nhét vào `apps/gis` (`import.tsx`) + routing `/api/design/*` cho gis FE (qua APISIX hoặc gis-bff proxy).

## Bản chất

Pipeline "upload bản vẽ → duyệt → vào GIS" **đã có đủ đường ống** từ DSN-1..4. Mắt xích **duy nhất
còn thiếu** là bước **đọc nội dung file CAD** (DWG/DXF) và chuyển thành `DraftNetworkAsset`. Hiện
upload CAD **chỉ lưu blob**, còn draft asset phải **tạo tay qua API** `CreateDraftAssetsBatch`. Toàn
BE **không có** parser/converter CAD nào (đã grep IxMilia/netDxf/ODA/Teigha/Aspose → 0).

DSN-5 lắp "máy bơm ở giữa": bắt event `DesignDocumentUploaded` với `docType ∈ {Dwg, Dxf}`, đọc
geometry theo **layer**, resolve **CRS**, reproject về **EPSG:4326**, và sinh một **bản xem trước có
thể sửa** (`CadImportPreview`) — **chưa** đẩy vào draft. User review (chỉnh mapping layer→loại tài
sản + xác nhận/nhập CRS) rồi **confirm** → tái dùng `CreateDraftAssetsBatch` sẵn có → hoà thẳng vào
workflow duyệt→publish→GIS.

```text
1. Upload CAD (DSN-1, đã có)   POST /documents  → MinIO + event DesignDocumentUploaded
2. Auto-parse (DSN-5, async)   DesignDocumentUploadedConsumer (chỉ Dwg/Dxf):
      DWG? → ICadDocumentConverter.ToDxf (ODA File Converter sidecar)
      DXF  → ICadGeometryExtractor (IxMilia.Dxf): entity theo layer →
             LINE/LWPOLYLINE/POLYLINE→polyline(ống); INSERT/POINT/CIRCLE→point(van/trụ/nút)
      → CadLayerMappingResolver (rule VN mặc định + config)
      → CadCrsResolver (GEODATA → heuristic → chờ user) + reproject-thử ProjNET
      → ghi CadImportPreview (staging: status/detectedCrs/layerStats/features/unmapped/skipped/warnings)
                                                            ❗ CHƯA vào draft
3. Review (DSN-5)              GET  /documents/{id}/cad-preview        (poll khi processing)
      (tuỳ chọn) POST …/cad-preview/reproject  → xem lại theo CRS user chọn, KHÔNG commit
4. Confirm (DSN-5)             POST /documents/{id}/cad-import
      body: mapping layer→loại + CRS chốt (epsg | ktt+múi | controlPoints) + revisionId
      → reproject cuối → CreateDraftAssetsBatch (DSN-2) → { revisionId, createdAssetIds[] }
5. Duyệt→publish→GIS (DSN-4)   DesignAssetReadyForGis → gis-be → NetworkNode/Pipe/Device thật (4326)
```

Lý do async qua event/consumer (không parse đồng bộ trong request upload): parse CAD nặng và có thể
gọi process ngoài (ODA) — tách khỏi request giữ upload nhanh, retry tự nhiên qua outbox/inbox, và
khớp kiến trúc event sẵn có. Lý do parse ra **preview rồi mới commit**: mapping layer + CRS là chỗ
dễ sai nhất; cho user kiểm soát trước khi dữ liệu lọt vào mạng lưới = "mượt" và an toàn.

## Components (theo hexagonal của design-be: Port ở Application, Adapter ở Infrastructure)

### A. `ICadDocumentConverter` (Application/Ports) — chuẩn hoá về DXF
- `Task<Stream> ToDxfAsync(Stream input, string ext, CancellationToken ct)` — DXF pass-through; DWG→convert.
- Adapter mặc định **`OdaFileConverterAdapter`** (Infrastructure): gọi **ODA File Converter** (binary free
  của Open Design Alliance) chạy như **sidecar/process** trong pod, DWG→DXF temp. Cô lập sau port →
  sau này thay **Aspose.CAD** (commercial, đọc DWG trực tiếp) chỉ là adapter khác, không đụng logic.
- Fallback khi convert lỗi/timeout: preview `failed` + message "yêu cầu export DXF từ AutoCAD".

### B. `ICadGeometryExtractor` (Application/Ports) — DXF → entity thô
- Adapter **`IxMiliaDxfExtractor`** (NuGet `IxMilia.Dxf`, MIT). Đọc entity, gom theo **layer**:
  - `LINE` / `LWPOLYLINE` / `POLYLINE` → **polyline** (ống)
  - `INSERT` (block ref) / `POINT` / `CIRCLE` → **point** (van/trụ/nút) — tên block gợi ý loại
  - `SPLINE`/`HATCH`/`TEXT`/… → bỏ qua, đếm vào `skippedStats`
- Trả `RawCadEntity[]` (layer, kiểu hình học, toạ độ **gốc theo đơn vị file**, thuộc tính block).

### C. `CadLayerMappingResolver` (Application) — layer → `DraftAssetKind`
- Rule mặc định theo quy ước tên VN (regex, config được): `ONG*`→pipe, `VAN*`→valve,
  `TRU*`/`PCC*`→hydrant, `NUT*`→node.
- Layer không khớp rule → `unmapped` (hiện ở preview để user gán tay) — chìa khoá "mượt" với bản vẽ lạ.

### D. `CadCrsResolver` (Application) — quyết định hệ toạ độ + reproject
- **Bậc 1 — GEODATA/`AcDbGeoData`** trong file → EPSG + reference point trực tiếp (confidence=high, không hỏi user).
- **Bậc 2 — `$INSUNITS` + biên độ toạ độ**: mét & X,Y ~10⁵–10⁶ → projected (nghi VN2000, **KHÔNG tự đoán
  múi/KTT**); |X|≤180 ∧ |Y|≤90 → đã là 4326, nạp thẳng.
- **Bậc 3 — không chắc** → `detectedCrs=null`, confidence=low → preview cờ "cần xác nhận CRS", **chặn confirm** tới khi user chọn.
- **User override** (khớp yêu cầu): (a) chọn **EPSG** từ bảng tỉnh→EPSG VN2000 (9205–9217); (b) nhập
  **KTT + múi** tự do; (c) **control points** ≥2 cặp CAD↔map → affine/Helmert (cho toạ độ cục bộ 0,0).
- **Reproject** bằng **ProjNET**: VN2000 = Transverse Mercator + 7-tham-số Bursa-Wolf theo **QĐ 05/2007**
  (hằng số hoá trong service, user KHÔNG nhập tham số dịch chuyển). Reproject từng vertex → lon/lat 4326.
- **Sanity check** sau reproject: bbox phải trong khung VN (~102–110°E, 8–24°N); ngoài → cờ `suspectCrs` + warning.
- Bảng **tỉnh→EPSG** seed sẵn (dropdown gợi ý) **kèm** ô nhập EPSG/KTT tự do.

### E. `CadImportPreview` (Domain, staging aggregate) + repo
- Trường: `documentId`, `tenantId`, `status` (`processing|ready|partial|failed`), `detectedCrs`
  (`epsg`, `source`, `confidence`), `layerStats[]`, `unmappedLayers[]`, `skippedStats[]`,
  `features` (GeoJSON reproject-thử), `warnings[]`, `errorMessage?`.
- "Biên bản" giữa parse (bước 2) và confirm (bước 4). Idempotent: parse lại cùng document → **ghi đè** preview cũ.

### F. `DesignDocumentUploadedConsumer` (Application, worker) — điều phối B0→2
- Bắt `DesignDocumentUploaded`, chỉ xử lý `docType ∈ {Dwg, Dxf}` (khác → bỏ qua).
- convert→extract→map→resolve-CRS → ghi `CadImportPreview`. Mọi lỗi → preview `failed`/`partial` +
  message rõ (KHÔNG treo pipeline). Dùng `IdempotentEnvelopeConsumer` building block sẵn có.

## API contract (design-be, nhóm dưới document đã có)

| Method | Path | Vai trò |
|---|---|---|
| `GET` | `/api/design/projects/{projectId}/documents/{documentId}/cad-preview` | Lấy `CadImportPreview`. Poll khi `processing`. |
| `POST` | `/api/design/projects/{projectId}/documents/{documentId}/cad-preview/reproject` | Reproject-thử theo CRS user chọn để xem lại (KHÔNG commit). |
| `POST` | `/api/design/projects/{projectId}/documents/{documentId}/cad-import` | Confirm: mapping + CRS chốt + revisionId → reproject cuối → `CreateDraftAssetsBatch`. |

- Bảo vệ permission sẵn có **`network-design:write`**; multi-tenant qua `ITenantContextAccessor` (như upload).
- `cad-import` **idempotent theo `(documentId, revisionId)`** qua **import ledger** (mẫu `GisImportLedger` bên gis-be) → gọi lại không nhân đôi asset.
- Confirm khi CRS `confidence=low` mà body không cung cấp CRS → **400** (chặn nạp mù).

### Response `cad-preview` (hình dạng)
```jsonc
{
  "documentId": "...", "status": "ready|processing|partial|failed",
  "detectedCrs": { "epsg": 9210, "source": "geodata|heuristic|null", "confidence": "high|low" },
  "layerStats": [{ "layer": "ONG_CAP1", "entityCount": 128, "mappedTo": "pipe", "source": "default-rule" }],
  "unmappedLayers": ["LAYER_LA"],
  "skippedStats": [{ "type": "SPLINE", "count": 12 }],
  "features": { "type": "FeatureCollection", "features": [ /* reproject-thử theo detectedCrs */ ] },
  "warnings": ["suspectCrs: bbox ngoài khung VN"],
  "errorMessage": null
}
```

## Xử lý lỗi (mỗi lỗi → preview status + message, KHÔNG treo pipeline)
- DWG convert lỗi/timeout → `failed: "Không đọc được DWG, thử export DXF từ AutoCAD"`.
- DXF hỏng/không parse → `failed` + dòng lỗi.
- Entity không hỗ trợ → bỏ qua + `skippedStats` (không chặn).
- Layer chưa map → `partial` + `unmappedLayers`.
- Polyline hở/1 điểm, point trùng, self-intersect → warning mức feature (validate ở revision như asset tay).
- Reproject ra ngoài khung VN → `suspectCrs` warning.

## Ngoài scope (slice/lần sau)
- **FE review**: nhét `apps/gis/import.tsx` (bảng layer→mapping chỉnh được, panel CRS dropdown tỉnh→EPSG +
  nhập tự do + control-point, map preview features, nút "Reproject lại"/"Xác nhận nạp") + routing `/api/design/*` cho gis FE. Endpoint BE của slice này đã sẵn sàng cho FE gọi.
- **Aspose.CAD adapter** (drop-in nếu bỏ ODA sidecar).
- **Định dạng khác** (Shapefile/GeoJSON native — enum đã có, để sau).
- **Re-import** sau khi sửa file (ghi đè preview đã hỗ trợ; nhưng re-publish draft failed vẫn theo giới hạn DSN-4).

## Test (TDD, khớp pattern gis-be/design-be)
- **Unit:** `IxMiliaDxfExtractor` với DXF fixture (LINE/LWPOLYLINE/INSERT theo layer) → assert số/loại feature;
  `CadLayerMappingResolver` rule; `CadCrsResolver` cả 3 bậc (fixture GEODATA / projected / lonlat / cục bộ);
  reproject 1 điểm VN2000 đã biết → lon/lat kỳ vọng (sai số < ~1m); sanity-bbox reject.
- **Integration** (`GisApiFactory`-style + Testcontainers/MinIO): upload DXF mẫu → consumer chạy → poll
  `cad-preview` ready → `POST cad-import` → assert `DraftNetworkAsset` đúng số/geom + event
  `DesignAssetReadyForGis` phát; confirm lần 2 → không nhân đôi (ledger); CRS low + thiếu body → 400.
- **Fixture:** vài `.dxf` nhỏ tự tạo (KHÔNG commit `.dwg` binary; DWG test = mock `ICadDocumentConverter`).
  Xin 1 file DXF/DWG thật (ẩn danh) để chỉnh mapping+CRS khớp thực tế — không có vẫn code được bằng fixture tổng hợp.

## Rủi ro đã lường
- ODA converter headless trong container (có thể cần xvfb) — cô lập sau port, fallback "yêu cầu DXF".
- Tham số VN2000→WGS84 phải chuẩn QĐ 05/2007 — hằng số hoá + test điểm mốc đã biết.
- Heuristic CRS chỉ phân biệt projected-vs-lonlat, KHÔNG đoán múi/KTT → luôn cho user xác nhận khi không có GEODATA.

## NuGet / hạ tầng mới
- `IxMilia.Dxf` (MIT) — parse DXF.
- `ProjNET` (`ProjNet4GeoAPI`) — reproject VN2000→4326.
- **ODA File Converter** sidecar/binary trong image + deploy manifest design-be.
- Tái dùng (không đụng): `IFileStoragePort`/MinIO, outbox/inbox + `IdempotentEnvelopeConsumer`,
  `CreateDraftAssetsBatch`, multi-tenancy, permission `network-design:write`.
