from __future__ import annotations

import os
import httpx
from fastapi import HTTPException
from .store import Conflict


class DesignGateway:
    def __init__(self, base_url=None, transport=None):
        self.base_url = (base_url or os.environ.get("IMPORT_DESIGN_URL", "")).rstrip(
            "/"
        )
        self.transport = transport

    def request(self, principal, method, path, body=None):
        if not self.base_url:
            raise HTTPException(503, "Chưa cấu hình dịch vụ Design để nhận dữ liệu.")
        headers = {
            "Authorization": "Bearer " + principal.token,
            "Accept": "application/json",
        }
        # Signed claims remain authoritative downstream; no caller-controlled tenant overrides.
        with httpx.Client(
            timeout=90, transport=self.transport, follow_redirects=False
        ) as client:
            try:
                response = client.request(
                    method, self.base_url + path, json=body, headers=headers
                )
            except httpx.HTTPError:
                raise HTTPException(
                    502,
                    "Không nhận được kết quả Design. Có thể thử lại theo khóa import để đối soát.",
                ) from None
        if response.status_code in (401, 403):
            raise HTTPException(
                response.status_code,
                "Design từ chối quyền truy cập; kiểm tra phiên đăng nhập và quyền.",
            )
        if response.status_code >= 400:
            raise HTTPException(
                502 if response.status_code >= 500 else response.status_code,
                "Design chưa chấp nhận thao tác. Kiểm tra trạng thái revision và dữ liệu.",
            )
        try:
            return response.json() if response.content else {}
        except ValueError:
            raise HTTPException(502, "Design trả kết quả không hợp lệ.") from None


def submit(service, gateway, principal, job_id, request):
    principal.require("network-design:write")
    principal.require("network-design:read")
    principal.require("network-gis:read")
    job = service.store.get(principal.tenant, job_id)
    result = service.result(principal.tenant, job)
    if not result or result["state"] != "ready":
        raise Conflict("Chỉ gửi dữ liệu đã được rà soát, xác nhận tọa độ và hết lỗi.")
    if len(result["drafts"]) > 20000:
        raise Conflict(
            "Lô vượt 20.000 tài sản. Chia lô theo vùng liên thông trước khi gửi Design."
        )
    previous = job.get("submission") or {}
    project_name = previous.get("projectName") or request.projectName or job["name"]
    import_key = previous.get("importKey") or f"{job_id}:{job['resultVersion']}"

    def begin(j):
        if j["state"] not in ("ready", "submitted"):
            raise Conflict("Lô đang xử lý hoặc chưa đủ điều kiện.")
        j.pop("error", None)
        j.update(
            state="submitting",
            submission={
                **(j.get("submission") or {}),
                "importKey": import_key,
                "projectName": project_name,
                "status": "Submitting",
            },
        )

    current = service.store.mutate(
        principal.tenant,
        principal.actor,
        job_id,
        request.expectedVersion,
        "submit-start",
        begin,
    )
    version = current["version"]
    try:
        receipt = gateway.request(
            principal,
            "POST",
            "/api/design/imports",
            {
                "importKey": import_key,
                "name": project_name,
                "assets": result["drafts"],
                "provenance": {
                    "files": job["files"],
                    "inventory": job["inventory"],
                    "review": job["reviewConfig"],
                    "summary": result["summary"],
                    "sources": [
                        {
                            "featureId": f["id"],
                            "sources": f["properties"].get("sources", []),
                        }
                        for f in result["clean"]
                    ],
                },
            },
        )
        if not all(
            isinstance(receipt.get(k), str) and receipt[k]
            for k in ("projectId", "revisionId")
        ):
            raise HTTPException(502, "Biên nhận Design thiếu ID.")

        def received(j):
            j["submission"].update(receipt, status="Draft")

        current = service.store.mutate(
            principal.tenant,
            principal.actor,
            job_id,
            version,
            "draft-created",
            received,
        )
        version = current["version"]
        revision_id = receipt["revisionId"]
        detail = gateway.request(
            principal, "GET", f"/api/design/revisions/{revision_id}"
        )
        status = detail.get("status", "Draft")
        if status == "Draft":
            validation = gateway.request(
                principal, "POST", f"/api/design/revisions/{revision_id}/validate"
            )
            if (
                validation.get("isValid") is False
                or validation.get("errors")
                or validation.get("hasErrors")
            ):

                def invalid(j):
                    j.update(
                        state="submitted",
                        submission={
                            **j["submission"],
                            "status": "Draft",
                            "validation": validation,
                            "message": "Design còn lỗi kiểm tra; xem báo cáo trước khi duyệt.",
                        },
                    )

                return service.store.mutate(
                    principal.tenant,
                    principal.actor,
                    job_id,
                    version,
                    "validation-errors",
                    invalid,
                )
            status = "Validated"
        if status == "Validated":
            detail = gateway.request(
                principal, "POST", f"/api/design/revisions/{revision_id}/submit"
            )
            status = detail.get("status", "Submitted")

        def done(j):
            j.update(
                state="submitted",
                submission={
                    **j["submission"],
                    "status": status,
                    "message": "Bản nháp đã gửi duyệt. Theo dõi kết quả trước khi coi là dữ liệu GIS.",
                },
            )

        return service.store.mutate(
            principal.tenant, principal.actor, job_id, version, "submitted", done
        )
    except Exception as exc:
        error_message = (
            exc.detail
            if isinstance(exc, HTTPException)
            else "Thao tác gián đoạn; thử lại để đối soát theo khóa import."
        )

        def failed(j):
            j["state"] = (
                "submitted" if j.get("submission", {}).get("revisionId") else "ready"
            )
            j["error"] = error_message
            j["submission"]["status"] = "RetryRequired"

        service.store.mutate(
            principal.tenant,
            principal.actor,
            job_id,
            version,
            "submit-interrupted",
            failed,
        )
        raise


def refresh(service, gateway, principal, job_id):
    job = service.store.get(principal.tenant, job_id)
    # A status poll must not advance the CAS version owned by an in-flight write.
    if job["state"] == "submitting":
        return job
    submission = job.get("submission") or {}
    rid = submission.get("revisionId")
    if not rid:
        return job
    detail = gateway.request(principal, "GET", f"/api/design/revisions/{rid}")
    rows = gateway.request(
        principal, "GET", f"/api/design/revisions/{rid}/publish-result"
    )
    if (
        submission.get("status") == detail.get("status", "Unknown")
        and submission.get("results") == rows
    ):
        return job

    def update(j):
        j["submission"].update(status=detail.get("status", "Unknown"), results=rows)

    return service.store.mutate(
        principal.tenant,
        principal.actor,
        job_id,
        job["version"],
        "publish-result",
        update,
    )


def publish(service, gateway, principal, job_id, request):
    principal.require("network-design:approve")
    principal.require("network-design:read")
    job = service.store.get(principal.tenant, job_id)
    evidence = (
        request.lifecycleEvidence
        or job.get("reviewConfig", {}).get("lifecycleEvidence", "")
    ).strip()
    if not evidence:
        raise Conflict("Cần ghi căn cứ tình trạng hồ sơ trước khi xuất bản.")
    rid = (job.get("submission") or {}).get("revisionId")
    if not rid or job["state"] != "submitted":
        raise Conflict("Cần gửi bản nháp sang Design trước khi duyệt.")

    def begin(j):
        if j["state"] != "submitted":
            raise Conflict("Lô đang được xử lý.")
        j["state"] = "submitting"
        j["reviewConfig"]["lifecycleEvidence"] = evidence

    current = service.store.mutate(
        principal.tenant,
        principal.actor,
        job_id,
        request.expectedVersion,
        "approve-start",
        begin,
    )
    try:
        detail = gateway.request(principal, "GET", f"/api/design/revisions/{rid}")
        if detail.get("status") == "Submitted":
            gateway.request(
                principal,
                "POST",
                f"/api/design/revisions/{rid}/approve",
                {"reason": request.reason or evidence},
            )
        elif detail.get("status") not in (
            "Approved",
            "Published",
            "PartiallyPublished",
        ):
            raise Conflict("Revision chưa ở trạng thái có thể duyệt.")
    finally:
        service.store.mutate(
            principal.tenant,
            principal.actor,
            job_id,
            current["version"],
            "approve-finished",
            lambda j: j.update(state="submitted"),
        )
    return refresh(service, gateway, principal, job_id)
