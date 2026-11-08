import { z } from 'zod';

/**
 * Network-edit revisions (`/api/gis/editor/*` on the BFF → design-be `/api/design/revisions/{id}/network-edits`).
 *
 * The operation shapes mirror design-be's `NetworkEditOperationV1` / `ReadyForGisAssetV1`, and
 * `inspectNetworkEdits` is a port of gis-be's `NetworkEditValidator`: the rules, issue codes and
 * order the server applies when a revision is saved and validated. The demo mock uses it so the
 * frontend meets the same rules offline; `network-edits.test.ts` holds the server's own cases.
 * Coordinates are always EPSG:4326 `[lon, lat]`.
 */

export const NODE_TYPES = ['Junction', 'Reservoir', 'Tank', 'Hydrant', 'Other'] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const GIS_PIPE_MATERIALS = ['HDPE', 'PVC', 'DuctileIron', 'Steel', 'CastIron', 'Concrete'] as const;
export const GIS_DEVICE_TYPES = ['Valve', 'FlowMeter', 'PressureSensor', 'Pump', 'Hydrant'] as const;
export type GisDeviceType = (typeof GIS_DEVICE_TYPES)[number];
/** Which host each gis-be device type takes (DeviceHost). */
export const DEVICE_HOST: Record<GisDeviceType, 'pipe' | 'node' | 'either'> = {
  Valve: 'pipe',
  FlowMeter: 'pipe',
  Pump: 'node',
  Hydrant: 'node',
  PressureSensor: 'either',
};
/** Max distance between a pipe end and its node (metres). */
export const ENDPOINT_TOLERANCE_M = 1;

const LonLat = z.tuple([z.number(), z.number()]);
export const EditAsset = z.object({
  draftAssetId: z.string(),
  kind: z.enum(['Node', 'Pipe', 'Device']),
  assetCode: z.string(),
  clientRef: z.string().nullable(),
  geometry: z.object({ type: z.enum(['Point', 'LineString']), coordinates: z.array(LonLat) }),
  attributes: z.record(z.string()),
  fromRef: z.string().nullable(),
  toRef: z.string().nullable(),
  hostRef: z.string().nullable(),
});
export type EditAsset = z.infer<typeof EditAsset>;

export const EditOperation = z.object({
  id: z.string(),
  action: z.enum(['Add', 'Update', 'Delete']),
  kind: z.enum(['Node', 'Pipe', 'Device']),
  targetId: z.string().nullable(),
  expectedVersion: z.number().int().nullable(),
  after: EditAsset.nullable(),
  before: EditAsset.nullable(),
});
export type EditOperation = z.infer<typeof EditOperation>;

export const EditIssue = z.object({
  code: z.string(),
  operationId: z.string().optional(),
  draftAssetId: z.string().optional(),
  field: z.string(),
  message: z.string(),
});
export type EditIssue = z.infer<typeof EditIssue>;

/** The published network as `/api/gis/editor/assets` returns it: assets by id, with their version. */
export type EditState = Record<string, { asset: EditAsset; version: number }>;

const ASSET_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const ciFind = <T extends string>(list: readonly T[], v: string | undefined): T | undefined =>
  list.find((x) => x.toLowerCase() === (v ?? '').trim().toLowerCase());

export function nearMetres(a: readonly number[], b: readonly number[], tolerance = ENDPOINT_TOLERANCE_M): boolean {
  if (a.length !== 2 || b.length !== 2) return false;
  const x = (a[0]! - b[0]!) * 111_320 * Math.cos((a[1]! * Math.PI) / 180);
  const y = (a[1]! - b[1]!) * 111_320;
  return x * x + y * y <= tolerance * tolerance;
}

/** Port of gis-be `NetworkEditValidator.Inspect`: validates the resulting graph, not operation order. */
export function inspectNetworkEdits(
  current: EditState,
  operations: readonly EditOperation[],
): { operations: EditOperation[]; errors: EditIssue[] } {
  const errors: EditIssue[] = [];
  const error = (code: string, operationId: string, field: string, message: string) =>
    errors.push({ code, operationId, field, message });
  if (operations.length > 2000)
    return { operations: [], errors: [{ code: 'INVALID_OPERATION', operationId: '', field: 'operations', message: 'Tối đa 2000 thay đổi.' }] };
  if (operations.length === 0) error('EMPTY_REVISION', '', 'operations', 'Chưa có thay đổi để gửi duyệt.');

  const ids = new Set<string>();
  const targets = new Set<string>();
  const edits: EditOperation[] = [];
  const final = new Map<string, EditAsset>(Object.entries(current).map(([k, v]) => [k, v.asset]));
  const affected = new Map<string, string>();

  for (const input of operations) {
    if (
      !input ||
      !input.id?.trim() ||
      input.id.length > 64 ||
      ids.has(input.id) ||
      current[input.id] !== undefined ||
      !['Add', 'Update', 'Delete'].includes(input.action) ||
      !['Node', 'Pipe', 'Device'].includes(input.kind)
    ) {
      error('INVALID_OPERATION', input?.id ?? '', 'operations', 'Thay đổi không hợp lệ hoặc bị trùng mã.');
      continue;
    }
    ids.add(input.id);
    let op: EditOperation = { ...input, before: null };
    if (op.action === 'Add') {
      if (op.targetId !== null || op.expectedVersion !== null) {
        error('INVALID_OPERATION', op.id, 'targetId', 'Đối tượng mới không được có mã đích.');
        continue;
      }
    } else {
      const before = op.targetId === null ? undefined : current[op.targetId];
      if (op.targetId === null || targets.has(op.targetId) || !before || before.asset.kind !== op.kind || before.version !== op.expectedVersion) {
        error('TARGET_CONFLICT', op.id, 'targetId', 'Đối tượng đã thay đổi, không còn tồn tại hoặc không thuộc mạng này. Tải lại trước khi sửa.');
        continue;
      }
      targets.add(op.targetId);
      op = { ...op, before: before.asset };
      if (op.action === 'Update' && op.after?.assetCode !== before.asset.assetCode)
        error('ASSET_CODE_IMMUTABLE', op.id, 'assetCode', 'Giữ nguyên mã tài sản đã công bố để đồng bộ hồ sơ quản lý tài sản.');
    }
    const key = op.targetId ?? op.id;
    affected.set(key, op.id);
    if (op.action === 'Delete') final.delete(key);
    else {
      const after = op.after;
      if (
        !after ||
        after.kind !== op.kind ||
        after.draftAssetId !== op.id ||
        !after.geometry?.coordinates ||
        !after.attributes ||
        after.geometry.coordinates.some((p) => !p) ||
        after.geometry.coordinates.length > 20000 ||
        Object.keys(after.attributes).length > 40
      ) {
        error('INVALID_OPERATION', op.id, 'after', 'Nội dung thay đổi thiếu hoặc quá lớn.');
        continue;
      }
      op = { ...op, after: { ...after, clientRef: op.id } };
      final.set(key, op.after!);
    }
    edits.push(op);
  }

  const aliases = new Map(edits.filter((x) => x.action !== 'Delete').map((x) => [x.id, x.targetId ?? x.id]));
  const resolve = (id: string | null) => (id === null ? null : aliases.get(id) ?? id);
  const exists = (id: string | null, kind: EditAsset['kind']) => id !== null && final.get(id)?.kind === kind;

  for (const [key, a] of final) {
    const from = resolve(a.fromRef);
    const to = resolve(a.toRef);
    const host = resolve(a.hostRef);
    const touched = affected.has(key);
    const related = [from, to, host].filter((x): x is string => x !== null && affected.has(x));
    if (!touched && related.length === 0) continue;
    const opId = affected.get(key) ?? (related.length > 0 ? affected.get(related[0]!)! : key);
    const coords = a.geometry.coordinates;
    if (!ASSET_CODE.test(a.assetCode)) {
      error('INVALID_PROPERTIES', opId, 'attributes', `${a.assetCode}: mã tài sản chỉ gồm A-Z, a-z, 0-9, _ và - (tối đa 64 ký tự).`);
      continue;
    }
    if (
      coords.some((p) => !p || p.length !== 2 || p.some((v) => !Number.isFinite(v)) || p[0]! < -180 || p[0]! > 180 || p[1]! < -90 || p[1]! > 90) ||
      (a.kind === 'Pipe' ? a.geometry.type !== 'LineString' || coords.length < 2 : a.geometry.type !== 'Point' || coords.length !== 1)
    ) {
      error('GEOMETRY', opId, 'geometry', `${a.assetCode}: hình học hoặc tọa độ chưa hợp lệ.`);
      continue;
    }
    if (a.kind === 'Node' && !(NODE_TYPES as readonly string[]).includes(a.attributes.nodeType ?? ''))
      error('NODE_TYPE', opId, 'nodeType', `${a.assetCode}: chọn loại nút.`);
    if (a.kind === 'Pipe') {
      const dn = a.attributes.diameterMm ?? '';
      if (!/^[+-]?\d+$/.test(dn.trim()) || Number(dn) <= 0)
        error('DIAMETER', opId, 'diameterMm', `${a.assetCode}: đường kính phải là số nguyên dương.`);
      if (!ciFind(GIS_PIPE_MATERIALS, a.attributes.material)) {
        error('INVALID_PROPERTIES', opId, 'attributes', `${a.assetCode}: vật liệu '${a.attributes.material ?? ''}' không có trong danh mục.`);
        continue;
      }
      if (!exists(from, 'Node') || !exists(to, 'Node') || from === to)
        error('DEPENDENCY', opId, 'endpoints', `Ống ${a.assetCode} cần hai nút khác nhau còn tồn tại. Sửa liên kết hoặc xóa ống này cùng bản nháp.`);
      else {
        const f = final.get(from!)!.geometry.coordinates;
        const t = final.get(to!)!.geometry.coordinates;
        if (f.length !== 1 || t.length !== 1 || !nearMetres(coords[0]!, f[0]!) || !nearMetres(coords[coords.length - 1]!, t[0]!))
          error('ENDPOINT_POSITION', opId, 'geometry', `Ống ${a.assetCode}: đưa hai đầu ống về vị trí nút nối (sai số tối đa 1 m).`);
      }
      if (coords.slice(1).every((p, i) => p[0] === coords[i]![0] && p[1] === coords[i]![1]))
        error('GEOMETRY', opId, 'geometry', `Ống ${a.assetCode} không có chiều dài.`);
    }
    if (a.kind === 'Device') {
      const type = ciFind(GIS_DEVICE_TYPES, a.attributes.deviceType);
      if (!type) {
        error('INVALID_PROPERTIES', opId, 'attributes', `${a.assetCode}: loại thiết bị '${a.attributes.deviceType ?? ''}' không hợp lệ.`);
        continue;
      }
      const onPipe = exists(host, 'Pipe');
      const onNode = exists(host, 'Node');
      if (!onPipe && !onNode)
        error('DEPENDENCY', opId, 'hostRef', `Thiết bị ${a.assetCode} cần ống hoặc nút gắn còn tồn tại. Chuyển thiết bị hoặc xóa cùng bản nháp.`);
      else if ((DEVICE_HOST[type] === 'pipe' && !onPipe) || (DEVICE_HOST[type] === 'node' && !onNode)) {
        error('INVALID_PROPERTIES', opId, 'attributes', `${a.assetCode}: ${type} phải gắn vào ${DEVICE_HOST[type] === 'pipe' ? 'ống' : 'nút'}.`);
        continue;
      }
    }
    if (touched && [...final].some(([k, v]) => k !== key && v.assetCode === a.assetCode))
      error('DUPLICATE_CODE', opId, 'assetCode', `Mã ${a.assetCode} đã được sử dụng.`);
  }
  return { operations: edits, errors };
}
