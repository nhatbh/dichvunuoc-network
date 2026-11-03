from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .auth import Authentication, Principal
from .cad import converter_path, feature_bounds
from .design import DesignGateway, submit, publish, refresh
from .models import ReviewConfig, SubmitRequest, PublishRequest
from .service import ImportService
from .engine import drawing_position
from .store import Missing, Conflict

MAX_FILE = 50 * 1024 * 1024
MAX_BODY = 100 * 1024 * 1024
MAX_FILES = 10


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = MAX_BODY + 1
        if length > MAX_BODY:
            return await JSONResponse(
                {"detail": "Lô tải lên vượt 100 MiB."}, status_code=413
            )(scope, receive, send)
        used = 0

        async def bounded():
            nonlocal used
            message = await receive()
            used += len(message.get("body", b""))
            if used > MAX_BODY:
                raise HTTPException(413, "Lô tải lên vượt 100 MiB.")
            return message

        await self.app(scope, bounded, send)


def create_app(service=None, auth=None, gateway=None, run_worker=True):
    service = service or ImportService(Path(os.environ.get("IMPORT_DATA_DIR", "data")))
    auth = auth or Authentication()
    gateway = gateway or DesignGateway()

    @asynccontextmanager
    async def lifespan(app):
        if run_worker:
            service.start()
        yield
        if run_worker:
            service.close()

    app = FastAPI(title="Water Network CAD Import", version="0.1.0", lifespan=lifespan)
    app.add_middleware(BodyLimit)
    app.state.service = service
    base = "/api/gis/imports"

    @app.exception_handler(Missing)
    async def missing(request, exc):
        return JSONResponse({"detail": "Không tìm thấy lô nhập."}, status_code=404)

    @app.exception_handler(Conflict)
    async def conflict(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.get("/health")
    def health():
        running = bool(service.thread and service.thread.is_alive())
        healthy = running or not run_worker
        return JSONResponse(
            {"status": "ok" if healthy else "unavailable", "workerRunning": running},
            status_code=200 if healthy else 503,
        )

    @app.get(base + "/capabilities")
    def capabilities(principal: Principal = Depends(auth)):
        principal.require("network-design:read")
        return {
            "formats": ["dwg", "dxf"],
            "dwgAvailable": bool(converter_path()),
            "maxFileBytes": MAX_FILE,
            "maxFiles": MAX_FILES,
            "maxDraftAssets": 20000,
        }

    @app.get(base + "/", include_in_schema=False)
    @app.get(base)
    def jobs(principal: Principal = Depends(auth)):
        principal.require("network-design:read")
        return {"items": service.store.list(principal.tenant)}

    @app.post(base + "/", status_code=202, include_in_schema=False)
    @app.post(base, status_code=202)
    async def upload(request: Request, principal: Principal = Depends(auth)):
        principal.require("network-design:write")
        form = await request.form(
            max_files=MAX_FILES, max_fields=5, max_part_size=MAX_FILE
        )
        uploads = form.getlist("files")
        if (
            not uploads
            or len(uploads) > MAX_FILES
            or any(not hasattr(f, "read") for f in uploads)
        ):
            raise HTTPException(400, "Chọn từ 1 đến 10 tệp DWG/DXF.")
        name = str(form.get("name", "Nhập bản vẽ CAD")).strip()
        if not 1 <= len(name) <= 160:
            raise HTTPException(400, "Tên lô cần từ 1 đến 160 ký tự.")
        job_id = str(uuid.uuid4())
        directory = service.directory(principal.tenant, job_id)
        directory.mkdir(parents=True)
        files = []
        created = False
        try:
            for i, file in enumerate(uploads):
                original = Path(file.filename.replace("\\", "/")).name
                ext = Path(original).suffix.lower().lstrip(".")
                if ext not in ("dwg", "dxf"):
                    raise HTTPException(415, "Chỉ hỗ trợ tệp DWG hoặc DXF.")
                target = directory / f"upload-{i}.{ext}"
                digest = hashlib.sha256()
                size = 0
                with target.open("wb") as out:
                    while chunk := await file.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_FILE:
                            raise HTTPException(413, "Một tệp vượt 50 MiB.")
                        digest.update(chunk)
                        out.write(chunk)
                await file.close()
                if not size:
                    raise HTTPException(400, "Tệp rỗng.")
                sha = digest.hexdigest()
                fid = sha[:24]
                if any(f["sha256"] == sha for f in files):
                    raise HTTPException(400, "Lô chứa hai bản sao của cùng một tệp.")
                target.rename(directory / (fid + "." + ext))
                files.append(
                    {
                        "id": fid,
                        "name": original,
                        "sha256": sha,
                        "format": ext,
                        "bytes": size,
                    }
                )
            fingerprint = hashlib.sha256(
                json.dumps(sorted(f["sha256"] for f in files)).encode()
            ).hexdigest()
            job, created = service.store.create(
                principal.tenant, principal.actor, name, files, fingerprint, job_id
            )
            return job
        finally:
            await form.close()
            if not created:
                shutil.rmtree(directory, ignore_errors=True)

    @app.post(base + "/{job_id}/files", status_code=202)
    async def append_files(job_id: str, request: Request, principal: Principal = Depends(auth)):
        principal.require("network-design:write")
        job = service.store.get(principal.tenant, job_id)
        if job.get("submission") or job["state"] not in ("needs_review", "ready", "failed"):
            raise Conflict("Chờ xử lý xong; hồ sơ đã gửi duyệt không thể thêm tệp.")
        form = await request.form(max_files=MAX_FILES, max_fields=5, max_part_size=MAX_FILE)
        directory = service.directory(principal.tenant, job_id)
        staging = directory / ("incoming-" + str(uuid.uuid4()))
        staging.mkdir()
        try:
            expected = int(str(form.get("expectedVersion", "0")))
            if expected != job["version"]:
                raise Conflict("Hồ sơ đã thay đổi; tải lại trước khi thêm tệp.")
            uploads = form.getlist("files")
            if not uploads or len(uploads) + len(job["files"]) > MAX_FILES or any(not hasattr(f, "read") for f in uploads):
                raise ValueError("Hồ sơ nhận tối đa 10 tệp, kể cả tệp đã gỡ có thể khôi phục.")
            added = []
            known = {f["sha256"] for f in job["files"]}
            for i, file in enumerate(uploads):
                original = Path((file.filename or "").replace("\\", "/")).name
                ext = Path(original).suffix.lower().lstrip(".")
                if ext not in ("dwg", "dxf"):
                    raise HTTPException(415, "Chỉ hỗ trợ tệp DWG hoặc DXF.")
                target = staging / str(i)
                digest = hashlib.sha256()
                size = 0
                with target.open("wb") as out:
                    while chunk := await file.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_FILE:
                            raise HTTPException(413, "Một tệp vượt 50 MiB.")
                        digest.update(chunk)
                        out.write(chunk)
                sha = digest.hexdigest()
                if not size or sha in known:
                    raise ValueError("Tệp rỗng hoặc đã có trong hồ sơ; dùng Khôi phục nếu đã gỡ.")
                known.add(sha)
                fid = sha[:24]
                target.rename(staging / (fid + "." + ext))
                added.append({"id": fid, "name": original, "sha256": sha, "format": ext, "bytes": size})
            # Content-addressed originals are installed before the atomic job mutation.
            # A failed CAS may leave harmless orphan bytes, never a partially changed job.
            for f in added:
                target = directory / (f["id"] + "." + f["format"])
                if not target.exists():
                    os.link(staging / target.name, target)
            def update(current):
                if current.get("submission") or current["state"] not in ("needs_review", "ready", "failed"):
                    raise Conflict("Hồ sơ đang xử lý hoặc đã gửi duyệt.")
                current.update(files=current["files"] + added, sourceSetId=str(uuid.uuid4()), state="queued")
                config = current.get("reviewConfig")
                if config:
                    config["acceptWarningCodes"] = []
                for key in ("inventory", "summary", "issues", "resultVersion", "georeference", "error"):
                    current.pop(key, None)
            return service.store.mutate(principal.tenant, principal.actor, job_id, expected, "append-files", update)
        finally:
            await form.close()
            shutil.rmtree(staging, ignore_errors=True)

    @app.get(base + "/{job_id}")
    def detail(job_id: str, principal: Principal = Depends(auth)):
        principal.require("network-design:read")
        return service.store.get(principal.tenant, job_id)

    @app.put(base + "/{job_id}/review")
    def review(job_id: str, config: ReviewConfig, principal: Principal = Depends(auth)):
        principal.require("network-design:write")
        return service.review(principal, job_id, config)

    @app.get(base + "/{job_id}/features")
    def features(
        job_id: str,
        view: str = "raw",
        offset: int = 0,
        limit: int = 2000,
        principal: Principal = Depends(auth),
    ):
        principal.require("network-design:read")
        if view not in ("raw", "clean") or offset < 0 or not 1 <= limit <= 5000:
            raise HTTPException(400, "Tham số phân trang không hợp lệ.")
        job = service.store.get(principal.tenant, job_id)
        result = service.result(principal.tenant, job)
        data = result[view] if result else []
        return {
            **({"drawing": drawing_position(result["raw"], ReviewConfig.model_validate(job.get("reviewConfig") or {"expectedVersion": job["version"]}))} if view == "clean" and offset == 0 and result else {}),
            "type": "FeatureCollection",
            "features": data[offset : offset + limit],
            "total": len(data),
            "hasMore": offset + limit < len(data),
            "offset": offset,
            "coordinateSpace": "cad"
            if view == "raw"
            else (result or {}).get("coordinateSpace", "cad"),
            "version": job["version"],
            "bbox": feature_bounds(
                [f for f in data if not f["properties"].get("isXref")]
            ),
        }

    @app.get(base + "/{job_id}/report")
    def report(job_id: str, principal: Principal = Depends(auth)):
        principal.require("network-design:read")
        job = service.store.get(principal.tenant, job_id)
        return JSONResponse(
            {
                "job": job,
                "audit": service.store.audit(principal.tenant, job_id),
                "result": service.result(principal.tenant, job),
            },
            headers={
                "Content-Disposition": f'attachment; filename="cad-import-{job_id}.json"'
            },
        )

    @app.post(base + "/{job_id}/submit")
    def submit_job(
        job_id: str, body: SubmitRequest, principal: Principal = Depends(auth)
    ):
        return submit(service, gateway, principal, job_id, body)

    @app.post(base + "/{job_id}/publish")
    def publish_job(
        job_id: str, body: PublishRequest, principal: Principal = Depends(auth)
    ):
        return publish(service, gateway, principal, job_id, body)

    @app.get(base + "/{job_id}/publish-result")
    def result(job_id: str, principal: Principal = Depends(auth)):
        principal.require("network-design:read")
        return refresh(service, gateway, principal, job_id)

    return app
