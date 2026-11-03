from __future__ import annotations

import hashlib
import math
import os
import re
import shutil
import subprocess
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import ezdxf
from ezdxf.path import make_path

from .models import issue

MAX_FEATURES = 100_000
MAX_VERTICES = 2_000_000
LINE_TYPES = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "SPLINE", "ELLIPSE", "CIRCLE"}
TEXT_TYPES = {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}
ANCILLARY = {
    "HATCH",
    "DIMENSION",
    "LEADER",
    "MLEADER",
    "VIEWPORT",
    "WIPEOUT",
    "IMAGE",
    "SOLID",
    "TRACE",
    "3DFACE",
}


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def folded(s):
    return "".join(
        c
        for c in unicodedata.normalize("NFKD", s.upper().replace("Đ", "D"))
        if not unicodedata.combining(c)
    )


def suggest(layer):
    label = folded(layer)
    dn = re.search(r"(?:DN|D|Ø|%%C|⌀)\s*[-=]?\s*(\d{2,4})(?!\d)", label)
    material = next(
        (
            m
            for m in ("HDPE", "UPVC", "PVC", "PPR", "DI", "STEEL")
            if re.search(rf"(?<![A-Z]){m}(?![A-Z])", label)
        ),
        None,
    )
    auxiliary = any(
        s in label
        for s in (
            "DIM",
            "TEXT",
            "CHU",
            "KHUNG",
            "HATCH",
            "DEFPOINTS",
            "DUONG",
            "NHA",
            "RANH",
            "TIM DUONG",
        )
    )
    pipe = bool(dn or re.search(r"\b(ONG|PIPE|CAP NUOC)\b", label))
    result = {
        "suggestedAction": "reference" if auxiliary else "pipe" if pipe else "review"
    }
    if dn:
        result["suggestedDiameterMm"] = int(dn.group(1))
    if material:
        result["suggestedMaterial"] = material
    return result


def converter_path():
    configured = os.environ.get("DWG_CONVERTER", "dwg2dxf")
    return shutil.which(configured)


def convert(path: Path, directory: Path):
    with path.open("rb") as source:
        head = source.read(6)
    warnings = []
    if path.suffix.lower() == ".dxf":
        if head.startswith(b"AC10"):
            raise ValueError("Tệp có nội dung DWG nhưng đuôi DXF.")
        return (
            path,
            warnings,
            {"name": "ezdxf", "version": ezdxf.__version__, "diagnostics": []},
        )
    if not re.fullmatch(rb"AC10\d\d", head):
        raise ValueError("Header DWG không hợp lệ.")
    executable = converter_path()
    if not executable:
        raise ValueError(
            "Chưa cài bộ chuyển DWG. Cấu hình DWG_CONVERTER trỏ đến dwg2dxf."
        )
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / "converted.dxf"
    log = directory / "converter.log"
    with log.open("wb") as stderr:
        completed = subprocess.run(
            [executable, "-y", "-o", str(output), str(path)],
            stdout=stderr,
            stderr=subprocess.STDOUT,
            timeout=180,
            check=False,
        )
    log_size = log.stat().st_size
    with log.open("rb") as stream:
        diagnostic_bytes = stream.read(1_000_001)
    diagnostic_truncated = len(diagnostic_bytes) > 1_000_000
    diagnostic = diagnostic_bytes[:1_000_000].decode("utf-8", "replace")
    diagnostic_lines = [
        line.strip()[:1000]
        for line in diagnostic.splitlines()
        if re.search(
            r"\b(ERROR|WARNING|WARN|unsupported|Unhandled|Invalid|Skip|TODO)\b",
            line,
            re.IGNORECASE,
        )
    ]
    if not output.exists() or output.stat().st_size < 100:
        raise ValueError(
            f"Bộ chuyển đổi không tạo được DXF (exit {completed.returncode})."
        )
    if completed.returncode != 0 or diagnostic_lines:
        warnings.append(
            issue(
                "CONVERTER_WARNINGS",
                "warning",
                f"Bộ chuyển DWG báo {len(diagnostic_lines)} chẩn đoán trong phần log đã đọc. Đối soát bản CAD và toàn bộ log chuyển đổi trước khi duyệt.",
            )
        )
    version = subprocess.run(
        [executable, "--version"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    ).stdout.splitlines()
    return (
        output,
        warnings,
        {
            "name": "LibreDWG dwg2dxf",
            "version": version[0] if version else "unknown",
            "exitCode": completed.returncode,
            "logBytes": log_size,
            "logSha256": file_sha256(log),
            "diagnostics": diagnostic_lines[:200],
            "diagnosticsTruncated": diagnostic_truncated or len(diagnostic_lines) > 200,
        },
    )


def read_document(file_info: dict, path: Path, directory: Path):
    dxf, issues, converter = convert(path, directory)
    try:
        doc = ezdxf.readfile(dxf)
    except ezdxf.DXFError as exc:
        raise ValueError(f"DXF không đọc được: {type(exc).__name__}.") from exc
    auditor = doc.audit()
    if auditor.errors or auditor.fixes:
        issues.append(
            issue(
                "CAD_AUDIT",
                "warning",
                f"Kiểm tra CAD: {len(auditor.errors)} lỗi, {len(auditor.fixes)} sửa cấu trúc trong bản đọc; bản gốc được giữ nguyên.",
            )
        )
    features, counts, layers = (
        [],
        Counter(),
        defaultdict(lambda: {"count": 0, "lineCount": 0, "textCount": 0}),
    )
    block_counts, block_samples = Counter(), defaultdict(list)
    vertices = 0
    unsupported = Counter()
    fid = file_info["id"]

    def feature_id(origin):
        return hashlib.sha256(f"{fid}:{origin}".encode()).hexdigest()[:24]

    def append_feature(origin, geometry, properties):
        coordinates = (
            [geometry["coordinates"]]
            if geometry["type"] == "Point"
            else geometry["coordinates"]
        )
        if not all(math.isfinite(v) for xy in coordinates for v in xy):
            raise ValueError("Tọa độ chứa NaN/Infinity.")
        identifier = feature_id(origin)
        features.append(
            {
                "type": "Feature",
                "id": identifier,
                "geometry": geometry,
                "properties": properties,
            }
        )
        if len(features) > MAX_FEATURES:
            raise ValueError("Bản vẽ vượt giới hạn số đối tượng.")
        return identifier

    def visit(
        entity,
        parent_layer=None,
        chain="",
        depth=0,
        parent_id=None,
        block_name=None,
        symbol_geometry=False,
    ):
        nonlocal vertices
        if depth > 16:
            raise ValueError("Block lồng quá 16 cấp.")
        kind = entity.dxftype()
        handle = str(entity.dxf.get("handle", "virtual"))
        origin = f"{chain}/{handle}" if chain else handle
        layer = entity.dxf.get("layer", "0")
        if layer == "0" and parent_layer:
            layer = parent_layer
        counts[kind] += 1
        layers[layer]["count"] += 1
        if kind == "INSERT":
            name = entity.dxf.name
            block = doc.blocks.get(name)
            # Empty XREF block layouts are falsey because ``BlockLayout`` exposes
            # ``__len__``.  Test identity explicitly so an unloaded XREF is not
            # mistaken for an ordinary empty block.
            is_xref = bool(
                block is not None
                and (block.block.is_xref or block.block.is_xref_overlay)
            )
            try:
                skipped = []
                insert_count = int(entity.mcount)
                if insert_count > MAX_FEATURES - len(features):
                    raise ValueError("Bản vẽ vượt giới hạn số đối tượng.")
                is_multi_insert = insert_count > 1
                inserts = entity.multi_insert() if is_multi_insert else (entity,)
                for ri, insert in enumerate(inserts):
                    placement_origin = f"{origin}/m{ri}" if is_multi_insert else origin
                    placement_id = feature_id(placement_origin)
                    nested = symbol_geometry or parent_id is not None
                    properties = {
                        "fileId": fid,
                        "layer": layer,
                        "entityType": "INSERT",
                        "handle": handle,
                        "blockName": name,
                        "blockPath": placement_origin,
                        "parentId": parent_id,
                        "isBlockGeometry": nested,
                        "isXref": is_xref,
                        "disposition": "reference" if nested or is_xref else "review",
                        "reason": "Hình học con của block"
                        if nested
                        else "Tham chiếu ngoài XREF"
                        if is_xref
                        else "Cần ánh xạ block rõ ràng",
                    }
                    point = insert.dxf.insert
                    append_feature(
                        placement_origin,
                        {
                            "type": "Point",
                            "coordinates": [float(point.x), float(point.y)],
                        },
                        properties,
                    )
                    if not nested:
                        block_counts[name] += 1
                        if len(block_samples[name]) < 10:
                            block_samples[name].append(placement_id)
                    if block is None or is_xref:
                        issues.append(
                            issue(
                                "MISSING_XREF",
                                "warning",
                                f"Block/XREF {name} cần bổ sung hoặc đối soát; không tự tải tham chiếu ngoài.",
                                placement_id,
                            )
                        )
                        continue
                    for ai, attr in enumerate(insert.attribs):
                        visit(
                            attr,
                            layer,
                            f"{placement_origin}/{name}:attr{ai}",
                            depth + 1,
                            placement_id,
                            name,
                            True,
                        )
                    for i, child in enumerate(
                        insert.virtual_entities(
                            skipped_entity_callback=lambda e, reason: skipped.append(
                                reason
                            )
                        )
                    ):
                        visit(
                            child,
                            layer,
                            f"{placement_origin}/{name}:{i}",
                            depth + 1,
                            placement_id,
                            name,
                            True,
                        )
                if skipped:
                    issues.append(
                        issue(
                            "BLOCK_TRANSFORM",
                            "warning",
                            f"Block {name}: {len(skipped)} đối tượng không biến đổi được.",
                        )
                    )
            except (ezdxf.DXFError, TypeError, NotImplementedError):
                issues.append(
                    issue(
                        "BLOCK_TRANSFORM", "warning", f"Không đọc đầy đủ block {name}."
                    )
                )
            return
        geometry = None
        text = None
        disposition = "review"
        reason = "Cần phân loại layer"
        if kind in TEXT_TYPES:
            text = (
                entity.plain_text() if kind == "MTEXT" else entity.dxf.get("text", "")
            )
            p = entity.dxf.get("insert", (0, 0, 0))
            geometry = {"type": "Point", "coordinates": [float(p[0]), float(p[1])]}
            layers[layer]["textCount"] += 1
            disposition, reason = "reference", "Chú dẫn CAD"
        elif kind == "POINT":
            p = entity.dxf.location
            geometry = {"type": "Point", "coordinates": [float(p.x), float(p.y)]}
        elif kind in LINE_TYPES:
            try:
                coords = []
                has_elevation = False
                if kind == "LINE":
                    points = iter((entity.dxf.start, entity.dxf.end))
                else:
                    # Accuracy in drawing units; preserved in manifest and never used as a metric snap tolerance.
                    points = iter(
                        make_path(entity).flattening(distance=0.01, segments=8)
                    )
                for point in points:
                    vertices += 1
                    if vertices > MAX_VERTICES:
                        raise ValueError("Bản vẽ vượt giới hạn số đỉnh.")
                    coords.append([float(point[0]), float(point[1])])
                    has_elevation = has_elevation or (
                        len(point) > 2 and abs(point[2]) > 1e-9
                    )
                if len(coords) >= 2:
                    geometry = {"type": "LineString", "coordinates": coords}
                layers[layer]["lineCount"] += 1
                if has_elevation:
                    issues.append(
                        issue(
                            "ELEVATION_PRESENT",
                            "warning",
                            "Bản vẽ có cao độ; hình học GIS 2D cần kiểm tra giao cắt khác mức.",
                        )
                    )
            except (ezdxf.DXFError, NotImplementedError, TypeError):
                unsupported[kind] += 1
        elif kind in ANCILLARY:
            # Counts remain in inventory even though these objects do not enter network geometry.
            disposition, reason = "exclude", "Đối tượng trình bày/phụ trợ CAD"
        else:
            unsupported[kind] += 1
        if geometry:
            props = {
                "fileId": fid,
                "layer": layer,
                "entityType": kind,
                "handle": handle,
                "blockPath": origin,
                "disposition": disposition,
                "reason": reason,
            }
            if parent_id is not None:
                props.update(
                    parentId=parent_id,
                    blockName=block_name,
                    isBlockGeometry=True,
                    disposition="reference",
                    reason="Hình học con của block",
                )
            if text is not None:
                props["text"] = text
            append_feature(origin, geometry, props)

    for entity in doc.modelspace():
        visit(entity)
    if unsupported:
        issues.append(
            issue(
                "UNSUPPORTED_ENTITIES",
                "warning",
                "Loại CAD chưa chuyển được: "
                + ", ".join(f"{k}: {v}" for k, v in sorted(unsupported.items())),
            )
        )
    paper_count = sum(len(layout) for layout in doc.layouts if layout.name != "Model")
    if paper_count:
        issues.append(
            issue(
                "PAPERSPACE_EXCLUDED",
                "info",
                f"Giữ {paper_count} đối tượng layout/khung in trong hồ sơ gốc; không nhập thành mạng.",
            )
        )
    # Extents use actual extracted geometry, not potentially stale CAD header EXTMIN/EXTMAX.
    bounds = feature_bounds([f for f in features if not f["properties"].get("isXref")])
    header = {
        k: list(doc.header.get(k))
        for k in ("$EXTMIN", "$EXTMAX", "$INSBASE")
        if doc.header.get(k) is not None
    }
    geodata = []
    for obj in doc.objects:
        if obj.dxftype() == "GEODATA":
            geodata.append(
                {
                    "coordinateSystemDefinition": getattr(
                        obj, "coordinate_system_definition", ""
                    )
                }
            )
    blocks = []
    for name, count in sorted(block_counts.items()):
        block = doc.blocks.get(name)
        is_xref = bool(
            block is not None and (block.block.is_xref or block.block.is_xref_overlay)
        )
        blocks.append(
            {
                "fileId": fid,
                "name": name,
                "count": count,
                "isXref": is_xref,
                "sampleFeatureIds": block_samples[name],
                "suggestedAction": "reference" if is_xref else "review",
            }
        )
    return {
        "features": features,
        "file": {
            **file_info,
            "units": int(doc.header.get("$INSUNITS", 0)),
            "bounds": bounds,
            "entityCount": sum(counts.values()),
            "entityTypes": dict(counts),
            "paperSpaceCount": paper_count,
            "header": header,
            "geoData": geodata,
            "converter": converter,
        },
        "layers": [
            {"fileId": fid, "name": name, **stats, **suggest(name)}
            for name, stats in sorted(layers.items())
        ],
        "blocks": blocks,
        "issues": list(
            {(x["code"], x.get("featureId"), x["message"]): x for x in issues}.values()
        ),
    }


def feature_bounds(features):
    xmin = ymin = math.inf
    xmax = ymax = -math.inf
    for feature in features:
        geometry = feature["geometry"]
        pts = (
            [geometry["coordinates"]]
            if geometry["type"] == "Point"
            else geometry["coordinates"]
        )
        for x, y, *_ in pts:
            xmin, ymin, xmax, ymax = (
                min(xmin, x),
                min(ymin, y),
                max(xmax, x),
                max(ymax, y),
            )
    return [xmin, ymin, xmax, ymax] if math.isfinite(xmin) else None
