from __future__ import annotations

import hashlib
import math
from collections import Counter, defaultdict
from copy import deepcopy
from itertools import pairwise

import numpy as np
from pyproj import CRS, Geod, Transformer
from pyproj.exceptions import CRSError, ProjError
from shapely import LineString, Point, STRtree, normalize
from shapely.ops import substring

from .cad import feature_bounds
from .models import ReviewConfig, issue
from .georeference import prepare_georeference

NEAR_OVERLAP_TOLERANCE_M = 2.0
NEAR_OVERLAP_MIN_FRACTION = 0.5
NEAR_OVERLAP_MIN_LENGTH_M = 5.0
MAX_SPATIAL_PAIR_CHECKS = 250_000
MAX_SPATIAL_FINDINGS = 1_000
PIPE_HOSTED_DEVICES = {"Valve", "FlowMeter"}
NODE_HOSTED_DEVICES = {"Pump", "Hydrant"}


def identity(prefix, value):
    return prefix + hashlib.sha256(value.encode()).hexdigest()[:20]


def source_record(feature):
    properties = feature["properties"]
    result = {
        "featureId": feature["id"],
        "fileId": properties["fileId"],
        "layer": properties["layer"],
        "handle": properties["handle"],
        "blockPath": properties["blockPath"],
    }
    if properties.get("manualEdit"):
        result["manualEdit"] = True
        result["sourceFeatureId"] = properties.get("sourceFeatureId")
    if properties.get("blockName"):
        result["blockName"] = properties["blockName"]
    if properties.get("parentId"):
        result["parentId"] = properties["parentId"]
    return result


def provenance_attributes(feature, generated_from):
    properties = feature["properties"]
    attributes = {
        "source": "cad-import",
        "generatedFrom": generated_from,
        "sourceFeatureId": feature["id"],
        "sourceFileId": properties["fileId"],
        "sourceLayer": properties["layer"],
        "sourceHandle": str(properties["handle"]),
        "sourceBlockPath": properties["blockPath"],
    }
    if properties.get("splitFrom"):
        attributes["sourceOriginalFeatureId"] = properties["splitFrom"]
    if properties.get("blockName"):
        attributes["sourceBlockName"] = properties["blockName"]
    if properties.get("parentId"):
        attributes["sourceParentId"] = properties["parentId"]
    sources = properties.get("sources", [])
    attributes["sourceCount"] = str(len(sources) or 1)
    return attributes


def metric_key(coordinates):
    return tuple(round(v, 7) for v in coordinates)


def clean_feature(feature):
    result = deepcopy(feature)
    result.pop("_line", None)
    result.pop("_point", None)
    return result


def remove_exact_duplicates(features, reviewed_by_id, issues, config):
    file_crs = {x.fileId: x.sourceCrs.strip() for x in config.fileCrs}

    def scope(feature):
        fid = feature["properties"]["fileId"]
        declared = file_crs.get(fid) or (config.sourceCrs or "").strip()
        # With no CRS evidence, equal numbers in different files are not proof of the
        # same position. Within-file exact equality is still safe to remove.
        return ("crs", declared.casefold()) if declared else ("file", fid)

    seen = {}
    geometry_attrs = {}
    aliases = {}
    keep = []
    for feature in sorted(features, key=lambda f: f["id"]):
        line = LineString(feature["geometry"]["coordinates"])
        if line.length == 0:
            mark(reviewed_by_id, feature["id"], "exclude", "Đường không có chiều dài")
            continue
        geometry_key = (scope(feature), normalize(line.simplify(0)).wkb)
        attrs = (
            feature["properties"].get("diameterMm"),
            feature["properties"].get("material"),
        )
        if geometry_key in geometry_attrs and geometry_attrs[geometry_key] != attrs:
            issues.append(
                issue(
                    "DUPLICATE_ATTRIBUTE_CONFLICT",
                    "error",
                    "Các tuyến trùng hình học có DN/vật liệu khác nhau.",
                    feature["id"],
                )
            )
        geometry_attrs[geometry_key] = attrs
        key = geometry_key, attrs
        if key not in seen:
            seen[key] = feature
            keep.append(feature)
            continue
        canonical = seen[key]
        canonical["properties"]["sources"].extend(feature["properties"]["sources"])
        aliases[feature["id"]] = canonical["id"]
        mark(
            reviewed_by_id,
            feature["id"],
            "duplicate",
            f"Trùng tuyến {canonical['id']}; giữ liên kết về cả hai nguồn",
        )
    return keep, aliases


def device_accepts_host(device_type, host_kind):
    if device_type in PIPE_HOSTED_DEVICES:
        return host_kind == "Pipe"
    if device_type in NODE_HOSTED_DEVICES:
        return host_kind == "Node"
    if device_type == "PressureSensor":
        return host_kind in {"Pipe", "Node"}
    return False


def validate_device_host_selection(points, pipes, aliases, selections, issues):
    assets = {feature["id"]: feature for feature in pipes + points}
    invalid = set()
    resolved = {}
    for device in (f for f in points if f["properties"].get("kind") == "Device"):
        feature_id = device["id"]
        requested = selections.get(feature_id)
        if not requested:
            issues.append(
                issue(
                    "DEVICE_HOST_REQUIRED",
                    "error",
                    "Device cần host pipe/node được người rà soát chọn rõ ràng.",
                    feature_id,
                )
            )
            invalid.add(feature_id)
            continue
        host_id = aliases.get(requested, requested)
        host = assets.get(host_id)
        if host is None:
            issues.append(
                issue(
                    "DEVICE_HOST_INVALID",
                    "error",
                    "Host được chọn không phải pipe/node đang giữ trong lô.",
                    feature_id,
                )
            )
            invalid.add(feature_id)
            continue
        host_kind = host["properties"].get("kind")
        if not device_accepts_host(device["properties"].get("deviceType"), host_kind):
            issues.append(
                issue(
                    "INVALID_DEVICE_HOST",
                    "error",
                    f"{device['properties'].get('deviceType')} không hỗ trợ host {host_kind or 'chưa phân loại'}.",
                    feature_id,
                )
            )
            invalid.add(feature_id)
            continue
        resolved[feature_id] = host_id
    return invalid, resolved


def spatial_pair_allowed(budget, issues):
    budget["pairChecks"] += 1
    if budget["pairChecks"] <= MAX_SPATIAL_PAIR_CHECKS:
        return True
    if not budget["exhausted"]:
        issues.append(
            issue(
                "SPATIAL_REVIEW_TOO_COMPLEX",
                "error",
                f"Đối soát không gian vượt {MAX_SPATIAL_PAIR_CHECKS} cặp ứng viên; tách lô theo khu vực trước khi tiếp tục.",
            )
        )
        budget["exhausted"] = True
    return False


def add_spatial_finding(budget, issues, finding):
    if budget["findings"] >= MAX_SPATIAL_FINDINGS:
        if not budget["exhausted"]:
            issues.append(
                issue(
                    "SPATIAL_REVIEW_TOO_COMPLEX",
                    "error",
                    f"Đối soát không gian vượt {MAX_SPATIAL_FINDINGS} phát hiện; tách lô theo khu vực trước khi tiếp tục.",
                )
            )
            budget["exhausted"] = True
        return False
    issues.append(finding)
    budget["findings"] += 1
    return True


def detect_near_overlaps(features, issues, budget):
    if len(features) < 2:
        return True
    lines = [feature["_line"] for feature in features]
    tree = STRtree(lines)
    for i, line in enumerate(lines):
        search = line.buffer(NEAR_OVERLAP_TOLERANCE_M)
        for raw_j in tree.query(search, predicate="intersects"):
            j = int(raw_j)
            if j <= i:
                continue
            if not spatial_pair_allowed(budget, issues):
                return False
            other = lines[j]
            shorter = min(line.length, other.length)
            if shorter <= 1e-8:
                continue
            overlap_a = line.intersection(other.buffer(NEAR_OVERLAP_TOLERANCE_M)).length
            overlap_b = other.intersection(line.buffer(NEAR_OVERLAP_TOLERANCE_M)).length
            overlap = min(overlap_a, overlap_b)
            if (
                overlap < NEAR_OVERLAP_MIN_LENGTH_M
                or overlap / shorter < NEAR_OVERLAP_MIN_FRACTION
            ):
                continue
            first, second = features[i], features[j]
            finding = issue(
                "NEAR_OVERLAPPING_ROUTES",
                "warning",
                f"Hai tuyến gần trùng trên {overlap:.3f} m ({overlap / shorter:.1%} tuyến ngắn hơn); giữ cả hai cho đến khi chọn phiên bản.",
                first["id"],
            )
            finding.update(
                relatedFeatureId=second["id"],
                overlapLengthM=overlap,
                overlapFraction=overlap / shorter,
                toleranceM=NEAR_OVERLAP_TOLERANCE_M,
            )
            if not add_spatial_finding(budget, issues, finding):
                return False
            if second["id"] not in first["properties"].setdefault(
                "nearOverlapFeatureIds", []
            ):
                first["properties"]["nearOverlapFeatureIds"].append(second["id"])
            if first["id"] not in second["properties"].setdefault(
                "nearOverlapFeatureIds", []
            ):
                second["properties"]["nearOverlapFeatureIds"].append(first["id"])
    return True


def analyze(raw: list[dict], inventory: dict, config: ReviewConfig):
    """Pure, deterministic review. It never changes originals or assumes a CRS."""
    if config.excludedFileIds:
        excluded_files = set(config.excludedFileIds)
        excluded_features = {f["id"] for f in raw if f["properties"]["fileId"] in excluded_files}
        raw = [f for f in raw if f["properties"]["fileId"] not in excluded_files]
        inventory = deepcopy(inventory)
        for key in ("layers", "blocks", "issues"):
            inventory[key] = [r for r in inventory.get(key, []) if r.get("fileId") not in excluded_files and r.get("featureId") not in excluded_features]
        inventory["files"] = [f for f in inventory.get("files", []) if f.get("id", f.get("fileId")) not in excluded_files]
        config = config.model_copy(update={
            "lineEdits": [e for e in config.lineEdits if e.fileId not in excluded_files],
            "fileCrs": [e for e in config.fileCrs if e.fileId not in excluded_files],
        })
    registration = (
        prepare_georeference(config)
        if config.controlPoints or config.controlPointTargetCrs else None
    )
    result = _analyze(raw, inventory, config, registration)
    if registration is not None:
        result["georeference"] = registration.diagnostics
    return result


def _analyze(raw, inventory, config, registration):
    reviewed = deepcopy(raw)
    edits = {edit.id: edit for edit in config.lineEdits}
    original_ids = {f["id"] for f in reviewed}
    for edit in config.lineEdits:
        if edit.id not in original_ids:
            reviewed.append({"type": "Feature", "id": edit.id, "geometry": {"type": "LineString", "coordinates": []},
                             "properties": {"fileId": edit.fileId, "layer": edit.layer, "entityType": "LINE",
                                            "handle": "manual:" + edit.id, "blockPath": []}})
    for feature in reviewed:
        edit = edits.get(feature["id"])
        if edit:
            feature["geometry"] = {"type": "LineString", "coordinates": [list(point) for point in edit.coordinates]}
            feature["properties"].update(manualEdit=True, sourceFeatureId=edit.sourceFeatureId)
    reviewed_by_id = {f["id"]: f for f in reviewed}
    rules = {(r.fileId, r.layer): r for r in config.layerRules}
    block_rules = {(r.fileId, r.blockName): r for r in config.blockRules}
    device_hosts = {h.featureId: h.hostFeatureId for h in config.deviceHosts}
    excluded = set(config.excludeFeatureIds)
    issues = list(inventory.get("issues", []))
    pipe_candidates = []
    point_candidates = []
    for f in reviewed:
        p = f["properties"]
        r = edits.get(f["id"]) or rules.get((p["fileId"], p["layer"]))
        if f["id"] in excluded:
            p.update(disposition="exclude", reason="Người rà soát loại khỏi lô nhập")
        elif p.get("isBlockGeometry"):
            p.update(
                disposition="reference",
                reason="Hình học con của block chỉ dùng hiển thị ký hiệu",
            )
        elif p["entityType"] in {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}:
            p.update(disposition="reference", reason="Giữ làm tham chiếu")
        elif p.get("isXref"):
            p.update(disposition="reference", reason="Giữ XREF làm tham chiếu ngoài")
        elif p["entityType"] == "INSERT":
            br = block_rules.get((p["fileId"], p.get("blockName", "")))
            action = br.action if br else "review"
            if action == "exclude":
                p.update(disposition="exclude", reason="Loại theo quy tắc block")
            elif action == "reference":
                p.update(disposition="reference", reason="Giữ block làm tham chiếu")
            elif action == "node" and f["geometry"]["type"] == "Point":
                p.update(disposition="keep", kind="Node", nodeType=br.nodeType)
                p["sources"] = [source_record(f)]
                point_candidates.append(f)
            elif action == "device" and f["geometry"]["type"] == "Point":
                p.update(disposition="keep", kind="Device", deviceType=br.deviceType)
                p["sources"] = [source_record(f)]
                point_candidates.append(f)
            else:
                p.update(
                    disposition="review", reason="Chưa có ánh xạ block được xác nhận"
                )
        elif r and r.action == "exclude":
            p.update(disposition="exclude", reason="Loại theo quy tắc layer")
        elif r and r.action == "reference":
            p.update(disposition="reference", reason="Giữ làm tham chiếu")
        elif r and r.action == "pipe" and f["geometry"]["type"] == "LineString":
            p.update(
                disposition="keep",
                kind="Pipe",
                diameterMm=r.diameterMm,
                material=(r.material or "").strip(),
            )
            p["sources"] = [source_record(f)]
            pipe_candidates.append(f)
        else:
            p.update(
                disposition="review", reason="Chưa có ánh xạ tài sản được xác nhận"
            )

    # Exact equality is safe to check in raw coordinates and keeps preview useful before
    # CRS confirmation. Unknown coordinate spaces are de-duplicated only within a file.
    pipes, duplicate_aliases = remove_exact_duplicates(
        pipe_candidates, reviewed_by_id, issues, config
    )
    chosen = pipes + point_candidates
    unresolved = sum(f["properties"]["disposition"] == "review" for f in reviewed)
    if unresolved:
        issues.append(
            issue(
                "UNMAPPED_FEATURES",
                "error",
                f"Còn {unresolved} đối tượng chưa phân loại; chọn ống, tham chiếu hoặc loại bỏ.",
            )
        )
    if not pipes:
        issues.append(issue("NO_PIPES", "error", "Chưa chọn được tuyến ống để nhập."))
    invalid_devices, resolved_host_ids = validate_device_host_selection(
        point_candidates, pipes, duplicate_aliases, device_hosts, issues
    )
    mapped_devices = {
        f["id"] for f in point_candidates if f["properties"].get("kind") == "Device"
    }
    for feature_id in device_hosts.keys() - mapped_devices:
        issues.append(
            issue(
                "DEVICE_HOST_TARGET_INVALID",
                "error",
                "Cấu hình host không trỏ đến một block đã ánh xạ thành device.",
                feature_id,
            )
        )
    if registration is not None and registration.error:
        issues.append(issue(registration.error_code, "error", registration.error))
        return finish(reviewed, chosen, [], [], issues, "cad", config)
    if registration is None and not config.sourceCrs and not config.fileCrs:
        issues.append(issue("CRS_REQUIRED", "error",
                            "Cần xác nhận hệ tọa độ nguồn trước khi xuất bản GIS."))
        return finish(reviewed, chosen, [], [], issues, "cad", config)
    if not config.crsEvidence.strip():
        issues.append(issue("CRS_EVIDENCE_REQUIRED", "error",
                            "Ghi căn cứ hệ tọa độ và đối chiếu vị trí thực địa."))
    file_crs = {x.fileId: x.sourceCrs for x in config.fileCrs}
    transformers = {}
    affine = registration.affine if registration is not None else None
    try:
        for fid in {f["properties"]["fileId"] for f in chosen}:
            crs = registration.crs if registration is not None else CRS.from_user_input(
                file_crs.get(fid) or config.sourceCrs)
            if registration is None and config.sourceUnits == "mm" and (
                not crs.is_projected or len(crs.axis_info) != 2
                or any(axis.unit_conversion_factor != 1 for axis in crs.axis_info)
            ):
                issues.append(issue("SOURCE_UNITS_REQUIRE_METRIC_CRS", "error",
                                    "Đơn vị mm chỉ áp dụng với hệ tọa độ phẳng có hai trục tính bằng mét."))
                return finish(reviewed, chosen, [], [], issues, "cad", config)
            transformers[fid] = Transformer.from_crs(
                crs, "EPSG:4326", always_xy=True, allow_ballpark=False)
    except (CRSError, ProjError, TypeError, ValueError):
        issues.append(issue("INVALID_CRS", "error",
                            "Hệ tọa độ không hợp lệ hoặc thiếu phép chuyển đổi được hỗ trợ."))
        return finish(reviewed, chosen, [], [], issues, "cad", config)
    transformed = []
    for f in chosen:
        point_geometry = f["geometry"]["type"] == "Point"
        pts = (
            [f["geometry"]["coordinates"]]
            if point_geometry
            else f["geometry"]["coordinates"]
        )
        tx = transformers[f["properties"]["fileId"]]
        try:
            if affine is not None:
                pts = registration.transform(pts).tolist()
            elif registration is None:
                if config.sourceAxisOrder == "yx":
                    pts = [(y, x) for x, y in pts]
                if config.sourceUnits == "mm":
                    pts = [(x / 1000, y / 1000) for x, y in pts]
            lnglat = [list(tx.transform(x, y, errcheck=True)) for x, y in pts]
            if not all(
                -180 <= x <= 180 and -90 <= y <= 90 and math.isfinite(x + y)
                for x, y in lnglat
            ):
                raise ValueError()
        except (ProjError, TypeError, ValueError, OverflowError):
            issues.append(
                issue(
                    "COORDINATE_OUT_OF_BOUNDS",
                    "error",
                    "Tọa độ sau chuyển đổi nằm ngoài kinh/vĩ độ hợp lệ.",
                    f["id"],
                )
            )
            continue
        copy = deepcopy(f)
        copy["geometry"]["coordinates"] = lnglat[0] if point_geometry else lnglat
        transformed.append(copy)
    if len(transformed) != len(chosen) or not transformed:
        return finish(reviewed, chosen, [], [], issues, "cad", config)
    bounds = feature_bounds(transformed)
    # Restrict one operational import to a local network so the metric working projection is well conditioned.
    if bounds[2] - bounds[0] > 5 or bounds[3] - bounds[1] > 5:
        issues.append(
            issue(
                "EXTENT_TOO_LARGE",
                "error",
                "Phạm vi bản vẽ vượt 5 độ; kiểm tra tọa độ và tách lô theo vùng.",
            )
        )
        return finish(reviewed, transformed, [], [], issues, "EPSG:4326", config)
    if not config.crsEvidence.strip():
        # A mathematically valid overlay is reviewable; missing survey evidence never creates drafts.
        return finish(reviewed, transformed, [], [], issues, "EPSG:4326", config)
    lon, lat = (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2
    metric = CRS.from_proj4(
        f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs"
    )
    to_metric = Transformer.from_crs(4326, metric, always_xy=True)
    to_geo = Transformer.from_crs(metric, 4326, always_xy=True)
    transformed_points = []
    transformed_pipes = []
    for f in transformed:
        if f["geometry"]["type"] == "LineString":
            f["_line"] = LineString(
                [to_metric.transform(x, y) for x, y in f["geometry"]["coordinates"]]
            )
            transformed_pipes.append(f)
        else:
            f["_point"] = Point(to_metric.transform(*f["geometry"]["coordinates"]))
            transformed_points.append(f)
    keep = []
    for f in sorted(transformed_pipes, key=lambda f: f["id"]):
        line = f["_line"]
        if line.length <= 1e-8 or line.length < config.minLengthM:
            mark(
                reviewed_by_id,
                f["id"],
                "exclude",
                "Đường rỗng hoặc ngắn hơn ngưỡng đã chọn",
            )
            continue
        if not line.is_simple:
            issues.append(
                issue(
                    "SELF_INTERSECTION",
                    "error",
                    "Tuyến tự giao; cần tách hoặc sửa trước khi nhập.",
                    f["id"],
                )
            )
        if line.is_closed:
            issues.append(
                issue(
                    "CLOSED_PIPE",
                    "error",
                    "Tuyến khép kín cần xác định nút và tách thành các đoạn ống.",
                    f["id"],
                )
            )
        keep.append(f)
    spatial_budget = {"pairChecks": 0, "findings": 0, "exhausted": False}
    if not detect_near_overlaps(keep, issues, spatial_budget):
        return finish(
            reviewed,
            [clean_feature(f) for f in transformed],
            [],
            [],
            issues,
            "EPSG:4326",
            config,
        )
    # Snap endpoints to existing endpoint representatives, never an arbitrary grid and never a chain of accumulating drift.
    if config.snapToleranceM and keep:
        snap_endpoints(keep, config.snapToleranceM, issues)
    keep, spatial_complete = connect_tees(keep, config, issues, spatial_budget)
    if not spatial_complete:
        return finish(
            reviewed,
            [clean_feature(f) for f in transformed],
            [],
            [],
            issues,
            "EPSG:4326",
            config,
        )
    geod = Geod(ellps="WGS84")
    nodes, drafts, clean, degrees = {}, [], [], Counter()
    pipe_draft_records = []
    explicit_node_refs = {}
    explicit_node_points = {}
    nodes_at_coordinate = defaultdict(list)
    for f in transformed_points:
        if f["properties"].get("kind") != "Node":
            continue
        point = f["_point"]
        ref = identity("N-", f["id"])
        properties = f["properties"]
        properties.update(clientRef=ref)
        attributes = provenance_attributes(f, "explicit-block-node")
        attributes["nodeType"] = properties["nodeType"]
        draft = {
            "kind": "Node",
            "assetCode": ref,
            "clientRef": ref,
            "geometry": {
                "type": "Point",
                "coordinates": [f["geometry"]["coordinates"]],
            },
            "attributes": attributes,
            "fromRef": None,
            "toRef": None,
            "hostRef": None,
        }
        nodes[ref] = draft
        explicit_node_refs[f["id"]] = ref
        explicit_node_points[f["id"]] = point
        nodes_at_coordinate[metric_key(point.coords[0])].append(ref)
        clean.append(clean_feature(f))
    for f in keep:
        line = f["_line"]
        if config.simplifyToleranceM:
            original_count = len(line.coords)
            line = line.simplify(config.simplifyToleranceM, preserve_topology=True)
            if len(line.coords) < original_count:
                f["properties"]["simplifiedVertices"] = original_count - len(
                    line.coords
                )
        if line.length <= 1e-8:
            issues.append(
                issue(
                    "COLLAPSED_PIPE",
                    "error",
                    "Snap làm tuyến co về một điểm; giảm ngưỡng snap.",
                    f["id"],
                )
            )
            continue
        if not line.is_simple:
            issues.append(
                issue(
                    "SELF_INTERSECTION",
                    "error",
                    "Tuyến tự giao; cần tách hoặc sửa trước khi nhập.",
                    f["id"],
                )
            )
        if line.is_closed:
            issues.append(
                issue(
                    "CLOSED_PIPE",
                    "error",
                    "Tuyến khép kín cần xác định nút và tách thành các đoạn ống.",
                    f["id"],
                )
            )
        f["_line"] = line
        coords = [list(to_geo.transform(x, y)) for x, y in line.coords]
        refs = []
        for endpoint_index, xy in enumerate((line.coords[0], line.coords[-1])):
            k = metric_key(xy)
            explicit = nodes_at_coordinate.get(k, [])
            if len(explicit) == 1:
                node_ref = explicit[0]
            else:
                if len(explicit) > 1:
                    issues.append(
                        issue(
                            "AMBIGUOUS_EXPLICIT_NODE",
                            "error",
                            "Nhiều block node cùng vị trí đầu ống; cần chọn một node.",
                            f["id"],
                        )
                    )
                node_ref = identity("N-", f"{k[0]:.7f},{k[1]:.7f}")
            if node_ref not in nodes:
                point = list(to_geo.transform(*xy))
                attributes = provenance_attributes(f, f"pipe-endpoint-{endpoint_index}")
                attributes["nodeType"] = "Junction"
                nodes[node_ref] = {
                    "kind": "Node",
                    "assetCode": node_ref,
                    "clientRef": node_ref,
                    "geometry": {"type": "Point", "coordinates": [point]},
                    "attributes": attributes,
                    "fromRef": None,
                    "toRef": None,
                    "hostRef": None,
                }
            refs.append(node_ref)
            degrees[node_ref] += 1
        if refs[0] == refs[1]:
            issues.append(
                issue(
                    "SELF_LOOP", "error", "Hai đầu ống cùng một nút sau xử lý.", f["id"]
                )
            )
        length = abs(geod.line_length([p[0] for p in coords], [p[1] for p in coords]))
        props = f["properties"]
        props.update(lengthM=length, fromRef=refs[0], toRef=refs[1])
        attrs = provenance_attributes(f, "pipe")
        attrs.update(
            diameterMm=str(props.get("diameterMm") or ""),
            material=props.get("material") or "",
            lengthM=format(length, ".6f"),
        )
        ref = identity("P-", f["id"])
        draft = {
            "kind": "Pipe",
            "assetCode": ref,
            "clientRef": ref,
            "geometry": {"type": "LineString", "coordinates": coords},
            "attributes": attrs,
            "fromRef": refs[0],
            "toRef": refs[1],
            "hostRef": None,
        }
        drafts.append(draft)
        pipe_draft_records.append((f, draft))
        props["clientRef"] = ref
        clean.append(
            {
                "type": "Feature",
                "id": f["id"],
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": props,
            }
        )
    pipe_hosts = defaultdict(list)
    for f, draft in pipe_draft_records:
        source_id = f["properties"].get("splitFrom", f["id"])
        pipe_hosts[source_id].append((f["_line"], draft["clientRef"]))
        pipe_hosts[f["id"]].append((f["_line"], draft["clientRef"]))
    for duplicate, canonical in duplicate_aliases.items():
        if canonical in pipe_hosts:
            pipe_hosts[duplicate] = pipe_hosts[canonical]

    valid_devices = []
    for f in transformed_points:
        if f["properties"].get("kind") != "Device":
            continue
        properties = f["properties"]
        requested_host = device_hosts.get(f["id"])
        canonical_host = resolved_host_ids.get(f["id"])
        properties["hostFeatureId"] = requested_host
        if f["id"] in invalid_devices or canonical_host is None:
            properties["hostStatus"] = "invalid"
            clean.append(clean_feature(f))
            continue
        host_kind = (
            reviewed_by_id.get(canonical_host, {}).get("properties", {}).get("kind")
        )
        candidates = []
        if host_kind == "Pipe":
            candidates = [
                (f["_point"].distance(line), ref)
                for line, ref in pipe_hosts.get(canonical_host, [])
            ]
        elif host_kind == "Node" and canonical_host in explicit_node_refs:
            candidates = [
                (
                    f["_point"].distance(explicit_node_points[canonical_host]),
                    explicit_node_refs[canonical_host],
                )
            ]
        if not candidates:
            issues.append(
                issue(
                    "DEVICE_HOST_UNAVAILABLE",
                    "error",
                    "Host đã chọn không còn trong tập tài sản sau làm sạch/tách tuyến.",
                    f["id"],
                )
            )
            properties["hostStatus"] = "invalid"
            clean.append(clean_feature(f))
            continue
        within = [
            (distance, ref)
            for distance, ref in candidates
            if distance <= config.hostToleranceM + 1e-9
        ]
        if not within:
            nearest = min(distance for distance, _ in candidates)
            issues.append(
                issue(
                    "DEVICE_HOST_TOO_FAR",
                    "error",
                    f"Device cách host đã chọn {nearest:.3f} m, vượt ngưỡng {config.hostToleranceM:.3f} m.",
                    f["id"],
                )
            )
            properties.update(hostStatus="too_far", hostDistanceM=nearest)
            clean.append(clean_feature(f))
            continue
        nearest = min(distance for distance, _ in within)
        nearest_refs = sorted(
            {ref for distance, ref in within if abs(distance - nearest) <= 1e-7}
        )
        if len(nearest_refs) != 1:
            issues.append(
                issue(
                    "AMBIGUOUS_DEVICE_HOST",
                    "error",
                    "Host đã chọn tách thành nhiều tài sản cùng khoảng cách; cần chọn host cụ thể.",
                    f["id"],
                )
            )
            properties.update(hostStatus="ambiguous", hostDistanceM=nearest)
            clean.append(clean_feature(f))
            continue
        host_ref = nearest_refs[0]
        ref = identity("D-", f["id"])
        properties.update(
            clientRef=ref, hostRef=host_ref, hostStatus="valid", hostDistanceM=nearest
        )
        attributes = provenance_attributes(f, "explicit-block-device")
        attributes["deviceType"] = properties["deviceType"]
        draft = {
            "kind": "Device",
            "assetCode": ref,
            "clientRef": ref,
            "geometry": {
                "type": "Point",
                "coordinates": [f["geometry"]["coordinates"]],
            },
            "attributes": attributes,
            "fromRef": None,
            "toRef": None,
            "hostRef": host_ref,
        }
        drafts.append(draft)
        valid_devices.append(draft)
        clean.append(clean_feature(f))
    dangling = sum(n == 1 for n in degrees.values())
    if dangling:
        issues.append(
            issue(
                "DANGLING_ENDPOINTS",
                "warning",
                f"Có {dangling} đầu tuyến/đầu chờ. Xác nhận phạm vi hồ sơ và điểm đấu nối trước khi duyệt.",
            )
        )
    if config.snapToleranceM and clean:
        issues.append(
            issue(
                "SNAP_REVIEW",
                "warning",
                "Đã bật snap đầu ống. Kiểm tra các vị trí điều chỉnh theo ngưỡng đã chọn.",
            )
        )
    drafts = list(nodes.values()) + drafts
    return finish(
        reviewed, clean, drafts, list(nodes.values()), issues, "EPSG:4326", config
    )


def mark(raw_by_id, fid, disposition, reason):
    # Constant-time update; source IDs never change.
    feature = raw_by_id.get(fid)
    if feature is not None:
        feature["properties"].update(disposition=disposition, reason=reason)


def snap_endpoints(features, tolerance, issues):
    cells = defaultdict(list)
    for f in features:
        pts = list(f["_line"].coords)
        for index in (0, -1):
            point = pts[index]
            gx, gy = (math.floor(v / tolerance) for v in point)
            candidates = [
                p
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
                for p in cells[(gx + dx, gy + dy)]
                if math.dist(p, point) <= tolerance
            ]
            if candidates:
                target = min(candidates, key=lambda p: (math.dist(p, point), p))
                if target != point:
                    f["properties"].setdefault("snaps", []).append(
                        {"endpoint": index, "distanceM": math.dist(target, point)}
                    )
                    pts[index] = target
            else:
                cells[(gx, gy)].append(point)
        f["_line"] = LineString(pts)


def connect_tees(features, config, issues, budget):
    if not features:
        return features, True
    lines = [f["_line"] for f in features]
    tree = STRtree(lines)
    splits = defaultdict(list)
    approved = set(config.connectEndpointFeatureIds)
    tolerance = max(config.snapToleranceM, 1e-6)
    for i, f in enumerate(features):
        coords = list(f["_line"].coords)
        for end in (0, -1):
            point = Point(coords[end])
            candidates = []
            for raw_j in tree.query(point, predicate="dwithin", distance=tolerance):
                j = int(raw_j)
                if j == i:
                    continue
                if not spatial_pair_allowed(budget, issues):
                    return features, False
                distance = lines[j].project(point)
                if 1e-6 < distance < lines[j].length - 1e-6:
                    candidates.append((j, distance))
            if not candidates:
                continue
            if len(candidates) != 1 or f["id"] not in approved:
                if not add_spatial_finding(
                    budget,
                    issues,
                    issue(
                        "POSSIBLE_TEE",
                        "warning",
                        "Đầu tuyến chạm/gần thân ống. Xác nhận đấu nối để tách ống chủ; không tự nối giao cắt.",
                        f["id"],
                    ),
                ):
                    return features, False
                continue
            j, distance = candidates[0]
            p = lines[j].interpolate(distance)
            coords[end] = (p.x, p.y)
            splits[j].append(distance)
        f["_line"] = LineString(coords)
    # Interior crossings are flagged for review but never noded automatically.
    for i, line in enumerate(lines):
        for raw_j in tree.query(line, predicate="crosses"):
            j = int(raw_j)
            if j <= i:
                continue
            if not spatial_pair_allowed(budget, issues):
                return features, False
            if not add_spatial_finding(
                budget,
                issues,
                issue(
                    "UNCONNECTED_CROSSING",
                    "warning",
                    "Các tuyến giao nhau trong mặt bằng; chưa coi là điểm đấu nối.",
                    features[i]["id"],
                ),
            ):
                return features, False
    output = []
    for i, f in enumerate(features):
        if i not in splits:
            output.append(f)
            continue
        # Split distances derived from the original line; simultaneous moves would make them stale.
        if not f["_line"].equals_exact(lines[i], 1e-8):
            issues.append(
                issue(
                    "TEE_REVIEW_REQUIRED",
                    "error",
                    "Ống chủ cũng có đầu bị di chuyển; xử lý riêng trước khi tách.",
                    f["id"],
                )
            )
            output.append(f)
            continue
        positions = [0] + sorted(set(splits[i])) + [lines[i].length]
        for idx, (a, b) in enumerate(pairwise(positions)):
            if b - a <= 1e-8:
                continue
            part = deepcopy(f)
            part["id"] = identity("S-", f"{f['id']}:{idx}:{a:.7f}:{b:.7f}")
            part["_line"] = substring(lines[i], a, b)
            part["properties"]["splitFrom"] = f["id"]
            output.append(part)
    return output, True


def finish(raw, clean, drafts, nodes, issues, space, config):
    # Validate required metadata only for retained assets. A removed zero/short line
    # must not keep blocking an otherwise valid candidate after cleanup.
    for feature in clean:
        properties = feature["properties"]
        if properties.get("kind") == "Pipe" and (
            not properties.get("diameterMm")
            or not properties.get("material", "").strip()
        ):
            issues.append(
                issue(
                    "MISSING_PIPE_ATTRIBUTES",
                    "error",
                    "Ống cần đường kính và vật liệu được xác nhận.",
                    feature["id"],
                )
            )
    # Warnings require a recorded review; errors cannot be accepted away.
    unique = list(
        {(x["code"], x.get("featureId"), x["message"]): x for x in issues}.values()
    )
    accepted = set(config.acceptWarningCodes)
    for x in unique:
        x["accepted"] = x["severity"] == "warning" and x["code"] in accepted
    errors = sum(x["severity"] == "error" for x in unique)
    warnings = sum(x["severity"] == "warning" for x in unique)
    ready = (
        bool(drafts)
        and not errors
        and all(x["severity"] != "warning" or x["accepted"] for x in unique)
    )
    dispositions = Counter(f["properties"].get("disposition") for f in raw)
    summary = {
        "rawFeatures": len(raw),
        "keptPipes": sum(f["properties"].get("kind") == "Pipe" for f in clean),
        "excluded": dispositions["exclude"] + dispositions["reference"],
        "duplicates": dispositions["duplicate"],
        "nodes": len(nodes),
        "devices": sum(d["kind"] == "Device" for d in drafts),
        "totalLengthM": sum(
            f["properties"].get("lengthM", 0)
            for f in clean
            if f["properties"].get("kind") == "Pipe"
        ),
        "errors": errors,
        "warnings": warnings,
    }
    return {
        "raw": raw,
        "clean": clean,
        "drafts": drafts,
        "issues": unique,
        "summary": summary,
        "coordinateSpace": space,
        "state": "ready" if ready else "needs_review",
    }


def drawing_position(raw, config):
    """Read-only CAD overlay; never supplies drafts or changes quality decisions."""
    empty = {"features": [], "coordinateSpace": "cad", "total": 0, "hasMore": False}
    if not config.sourceCrs and not config.fileCrs and not config.controlPoints:
        return {**empty, "error": "Cần khai báo hệ tọa độ hoặc ghép điểm để xem vị trí CAD."}
    registration = prepare_georeference(config) if config.controlPoints or config.controlPointTargetCrs else None
    if registration is not None and registration.error:
        return {**empty, "error": registration.error}
    file_crs = {x.fileId: x.sourceCrs for x in config.fileCrs}
    transforms = {}
    projected = []
    try:
        for f in raw:
            props = f['properties']
            if props.get('isXref') or props.get('fileId') in config.excludedFileIds or f['id'] in config.excludeFeatureIds:
                continue
            fid = props['fileId']
            if fid not in transforms:
                crs = registration.crs if registration is not None else CRS.from_user_input(file_crs.get(fid) or config.sourceCrs)
                if registration is None and config.sourceUnits == 'mm' and (not crs.is_projected or len(crs.axis_info) != 2 or any(a.unit_conversion_factor != 1 for a in crs.axis_info)):
                    raise ValueError('Đơn vị mm cần hệ tọa độ phẳng tính bằng mét.')
                transforms[fid] = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True, allow_ballpark=False)
            geom = f['geometry']; pts = [geom['coordinates']] if geom['type'] == 'Point' else geom['coordinates']
            if not pts:
                continue
            if registration is not None:
                pts = registration.transform(pts).tolist()
            else:
                if config.sourceAxisOrder == 'yx': pts = [(y,x) for x,y in pts]
                if config.sourceUnits == 'mm': pts = [(x/1000,y/1000) for x,y in pts]
            coords = [list(transforms[fid].transform(x,y,errcheck=True)) for x,y in pts]
            if not all(math.isfinite(x+y) and -180 <= x <= 180 and -90 < y < 90 for x,y in coords):
                raise ValueError('Tọa độ CAD sau chuyển đổi không hợp lệ.')
            item = deepcopy(f); item['geometry']['coordinates'] = coords[0] if geom['type'] == 'Point' else coords
            projected.append(item)
        bounds = feature_bounds(projected)
        if bounds and (bounds[2]-bounds[0] > 5 or bounds[3]-bounds[1] > 5):
            raise ValueError('Phạm vi CAD vượt 5 độ; kiểm tra hệ tọa độ, trục và đơn vị.')
    except (CRSError, ProjError, TypeError, ValueError, OverflowError):
        return {**empty, 'error': 'Chưa định vị được CAD. Kiểm tra hệ tọa độ, trục, đơn vị và điểm ghép.'}
    return {'features': projected[:10000], 'coordinateSpace': 'EPSG:4326', 'total': len(projected), 'hasMore': len(projected)>10000, 'bbox': bounds}
