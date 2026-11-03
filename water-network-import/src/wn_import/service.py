from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
import threading

from .cad import read_document
from .engine import analyze
from .models import ReviewConfig
from .store import Store, Conflict

logger = logging.getLogger(__name__)


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".writing")
    temp.write_text(
        json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    )
    os.replace(temp, path)


class ImportService:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.store = Store(self.root / "imports.sqlite3")
        self.stop = threading.Event()
        self.thread = None

    def directory(self, tenant, job_id):
        # Tenant and job are resolved from authenticated, persisted objects; hashes avoid path interpretation.
        return self.root / "jobs" / hashlib.sha256(tenant.encode()).hexdigest() / job_id

    def source_paths(self, tenant, job):
        directory = self.directory(tenant, job["id"])
        suffix = "-" + job["sourceSetId"] if job.get("sourceSetId") else ""
        return directory / f"source-features{suffix}.json", directory / f"inventory{suffix}.json"

    def start(self):
        self.store.recover()
        self.thread = threading.Thread(
            target=self.loop, daemon=True, name="cad-import-worker"
        )
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=3)

    def loop(self):
        while not self.stop.is_set():
            entry = self.store.work()
            if entry:
                self.process(*entry)
            else:
                self.stop.wait(0.5)

    def process(self, tenant, job):
        directory = self.directory(tenant, job["id"])
        try:
            raw_path, inventory_path = self.source_paths(tenant, job)
            if raw_path.exists():
                raw = read_json(raw_path)
                inventory = read_json(inventory_path)
            else:
                raw = []
                inventory = {"layers": [], "blocks": [], "files": [], "issues": []}
                for f in job["files"]:
                    document = read_document(
                        f,
                        directory / (f["id"] + "." + f["format"]),
                        directory / "converted" / f["id"],
                    )
                    raw.extend(document["features"])
                    inventory["layers"].extend(document["layers"])
                    inventory["blocks"].extend(document.get("blocks", []))
                    inventory["files"].append(document["file"])
                    inventory["issues"].extend({**item, "fileId": f["id"]} for item in document["issues"])
                    if len(raw) > 100000:
                        raise ValueError(
                            "Tổng số đối tượng vượt 100.000; tách thành các lô theo vùng."
                        )
                write_json(inventory_path, inventory)
                write_json(raw_path, raw)
            config = ReviewConfig.model_validate(
                job.get("reviewConfig") or {"expectedVersion": job["version"]}
            )
            result = analyze(raw, inventory, config)
            revision_dir = directory / "reviews" / str(job["version"])
            write_json(revision_dir / "result.json", result)

            def done(current):
                current.update(
                    state=result["state"],
                    inventory=inventory,
                    summary=result["summary"],
                    issues=result["issues"],
                    resultVersion=job["version"],
                    georeference=result.get("georeference"),
                )
                current.pop("error", None)

            self.store.mutate(
                tenant, "worker", job["id"], job["version"], "analyze", done
            )
        except Conflict:
            logger.info("Discarded stale review job %s", job["id"])
        except Exception as exc:
            logger.exception("CAD analysis failed: %s", job["id"])
            message = (
                str(exc)
                if isinstance(exc, (ValueError, TimeoutError))
                else "Không xử lý được bản vẽ; kiểm tra định dạng và log bộ chuyển đổi."
            )
            try:
                self.store.mutate(
                    tenant,
                    "worker",
                    job["id"],
                    job["version"],
                    "failed",
                    lambda j: j.update(state="failed", error=message),
                )
            except Conflict:
                pass

    def result(self, tenant, job):
        version = job.get("resultVersion")
        if version is None:
            return None
        return read_json(
            self.directory(tenant, job["id"]) / "reviews" / str(version) / "result.json"
        )

    def review(self, principal, job_id, config):
        job = self.store.get(principal.tenant, job_id)
        if job.get("submission") or job["state"] not in (
            "needs_review",
            "ready",
            "failed",
        ):
            raise Conflict(
                "Lô đã gửi hoặc đang đối soát Design; dữ liệu đã chuẩn bị được giữ cố định."
            )
        inventory = job.get("inventory")
        if not inventory:
            raise Conflict("Chờ đọc bản vẽ trước khi ánh xạ layer.")
        allowed = {(r["fileId"], r["name"]) for r in inventory["layers"]}
        if any((r.fileId, r.layer) not in allowed for r in config.layerRules):
            raise ValueError("Quy tắc tham chiếu layer không có trong lô.")
        raw = read_json(self.source_paths(principal.tenant, job)[0])
        by_id = {f["id"]: f for f in raw}
        files_in_job = {f["id"] for f in job["files"]}
        if not set(config.excludedFileIds).issubset(files_in_job):
            raise ValueError("Tệp cần gỡ không thuộc hồ sơ.")
        for edit in config.lineEdits:
            if edit.fileId not in files_in_job:
                raise ValueError("Tuyến chỉnh sửa phải thuộc tệp trong hồ sơ.")
            original = by_id.get(edit.id)
            if original:
                properties = original["properties"]
                if (original["geometry"]["type"] != "LineString" or properties.get("isBlockGeometry")
                    or properties.get("isXref") or properties["fileId"] != edit.fileId
                    or properties["layer"] != edit.layer):
                    raise ValueError("Chỉ sửa tuyến trong đúng tệp/lớp; không sửa hình học ký hiệu hoặc XREF.")
            elif not edit.id.startswith("draft-"):
                raise ValueError("Tuyến mới cần mã draft- riêng.")
            if edit.sourceFeatureId:
                source = by_id.get(edit.sourceFeatureId)
                if not source or source["properties"]["fileId"] != edit.fileId:
                    raise ValueError("Nguồn tuyến chỉnh sửa không thuộc tệp.")
        ids = set(by_id) | {edit.id for edit in config.lineEdits}
        if not set(config.excludeFeatureIds).issubset(ids) or not set(
            config.connectEndpointFeatureIds
        ).issubset(ids):
            raise ValueError("Đối tượng được chọn không thuộc lô nhập.")
        allowed_blocks = {(r["fileId"], r["name"]) for r in inventory.get("blocks", [])}
        if any(
            (r.fileId, r.blockName) not in allowed_blocks for r in config.blockRules
        ):
            raise ValueError("Quy tắc block không thuộc lô nhập.")
        if any(
            h.featureId not in ids or h.hostFeatureId not in ids
            for h in config.deviceHosts
        ):
            raise ValueError("Thiết bị hoặc host không thuộc lô nhập.")
        files = {f["id"] for f in job["files"]}
        if any(c.fileId not in files for c in config.fileCrs):
            raise ValueError("Hệ tọa độ tham chiếu tệp không thuộc lô.")

        def update(j):
            if j.get("submission") or j["state"] not in (
                "needs_review",
                "ready",
                "failed",
            ):
                raise Conflict("Lô đang xử lý hoặc đã gửi sang Design.")
            j.update(state="queued", reviewConfig=config.model_dump())
            j.pop("error", None)

        return self.store.mutate(
            principal.tenant,
            principal.actor,
            job_id,
            config.expectedVersion,
            "review",
            update,
        )
