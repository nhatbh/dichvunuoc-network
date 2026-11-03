from io import StringIO
import json
from pathlib import Path
import threading

import ezdxf
import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from wn_import.api import create_app
from wn_import.auth import Principal, tenant_from_claims
from wn_import.design import DesignGateway
from wn_import.service import ImportService
from wn_import.store import Conflict


def dxf_bytes():
    doc = ezdxf.new()
    doc.modelspace().add_line(
        (500000, 2320000), (500100, 2320000), dxfattribs={"layer": "PIPE"}
    )
    stream = StringIO()
    doc.write(stream)
    return stream.getvalue().encode()


def auth(request: Request):
    tenant = request.headers.get("test-tenant", "tenant-a")
    permissions = frozenset(
        request.headers.get(
            "test-permissions",
            "network-design:read,network-design:write,network-design:approve,network-gis:read",
        ).split(",")
    )
    return Principal(tenant, "actor", "test-token", permissions)


@pytest.fixture
def api(tmp_path):
    service = ImportService(tmp_path)
    with TestClient(create_app(service, auth=auth, run_worker=False)) as client:
        yield client, service


def upload(client):
    r = client.post(
        "/api/gis/imports",
        files=[("files", ("network.dxf", dxf_bytes(), "application/dxf"))],
        data={"name": "Pilot network"},
    )
    assert r.status_code == 202, r.text
    return r.json()


def review(client, service, job):
    entry = service.store.work()
    assert entry
    service.process(*entry)
    job = client.get("/api/gis/imports/" + job["id"]).json()
    body = {
        "expectedVersion": job["version"],
        "sourceCrs": "EPSG:32648",
        "crsEvidence": "Known survey control coordinates",
        "lifecycleEvidence": "Approved as-built fixture",
        "layerRules": [
            {
                "fileId": job["files"][0]["id"],
                "layer": "PIPE",
                "action": "pipe",
                "diameterMm": 100,
                "material": "HDPE",
            }
        ],
        "acceptWarningCodes": ["DANGLING_ENDPOINTS"],
    }
    r = client.put("/api/gis/imports/" + job["id"] + "/review", json=body)
    assert r.status_code == 200, r.text
    service.process(*service.store.work())
    return client.get("/api/gis/imports/" + job["id"]).json()


def test_upload_persists_original_and_deduplicates_within_tenant(api):
    client, service = api
    job = upload(client)
    # Reuse identical bytes; ezdxf creates random document metadata on each call.
    path = service.directory("tenant-a", job["id"]) / (job["files"][0]["id"] + ".dxf")
    data = path.read_bytes()
    again = client.post(
        "/api/gis/imports",
        files={"files": ("renamed.dxf", data)},
        data={"name": "Renamed"},
    )
    assert again.status_code == 202 and again.json()["id"] == job["id"]
    other = client.post(
        "/api/gis/imports",
        files={"files": ("network.dxf", data)},
        headers={"test-tenant": "tenant-b"},
    )
    assert other.json()["id"] != job["id"]
    assert len(client.get("/api/gis/imports").json()["items"]) == 1
    assert (
        client.get(
            "/api/gis/imports/" + job["id"], headers={"test-tenant": "tenant-b"}
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/api/gis/imports/" + job["id"] + "/report",
            headers={"test-tenant": "tenant-b"},
        ).status_code
        == 404
    )


def test_review_version_and_foreign_exclusion_are_rejected(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    path = "/api/gis/imports/" + job["id"] + "/review"
    job = client.get("/api/gis/imports/" + job["id"]).json()
    assert (
        client.put(path, json={"expectedVersion": job["version"] - 1}).status_code
        == 409
    )
    assert (
        client.put(
            path,
            json={"expectedVersion": job["version"], "excludeFeatureIds": ["foreign"]},
        ).status_code
        == 400
    )
    assert (
        client.put(
            path, json={"expectedVersion": job["version"], "tenantId": "tenant-b"}
        ).status_code
        == 422
    )


def test_raw_preview_survives_no_crs_but_submission_is_blocked(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    job = client.get("/api/gis/imports/" + job["id"]).json()
    assert job["state"] == "needs_review"
    r = client.get(
        "/api/gis/imports/" + job["id"] + "/features?view=raw&limit=1"
    ).json()
    assert r["total"] == 1 and r["coordinateSpace"] == "cad" and len(r["features"]) == 1
    assert (
        client.post(
            "/api/gis/imports/" + job["id"] + "/submit",
            json={"expectedVersion": job["version"]},
        ).status_code
        == 409
    )


def test_incomplete_draft_survives_restart_and_becomes_ready_only_after_correction(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    path = "/api/gis/imports/" + job["id"]
    job = client.get(path).json()
    config = {
        "expectedVersion": job["version"],
        "sourceCrs": "EPSG:32648",
        "crsEvidence": "Known survey control coordinates",
        "layerRules": [{"fileId": job["files"][0]["id"], "layer": "PIPE", "action": "pipe"}],
        "acceptWarningCodes": ["DANGLING_ENDPOINTS"],
    }
    assert client.put(path + "/review", json=config).status_code == 200
    service.process(*service.store.work())
    saved = client.get(path).json()
    assert saved["state"] == "needs_review"
    assert saved["summary"]["errors"] > 0

    restarted = ImportService(service.root)
    with TestClient(create_app(restarted, auth=auth, run_worker=False)) as reopened:
        restored = reopened.get(path).json()
        assert restored["reviewConfig"] == saved["reviewConfig"]
        assert restored["summary"] == saved["summary"]
        assert reopened.post(path + "/submit", json={"expectedVersion": restored["version"]}).status_code == 409
        config["expectedVersion"] = restored["version"]
        config["layerRules"][0].update(diameterMm=100, material="HDPE")
        assert reopened.put(path + "/review", json=config).status_code == 200
        restarted.process(*restarted.store.work())
        corrected = reopened.get(path).json()
        assert corrected["state"] == "ready"
        assert corrected["summary"]["errors"] == 0
        assert corrected.get("submission") is None


def test_restart_recovers_queued_analysis_and_revision_audit(api):
    client, service = api
    job = upload(client)
    entry = service.store.work()
    restarted = ImportService(service.root)
    restarted.store.recover()
    resumed = restarted.store.work()
    assert resumed[1]["id"] == job["id"]
    restarted.process(*resumed)
    final = restarted.store.get("tenant-a", job["id"])
    assert final["state"] == "needs_review"
    assert [x["action"] for x in restarted.store.audit("tenant-a", job["id"])] == [
        "upload",
        "analyze",
    ]


def test_ready_review_has_metric_geometry_and_report_audit(api):
    client, service = api
    job = review(client, service, upload(client))
    assert job["state"] == "ready", job
    result = client.get("/api/gis/imports/" + job["id"] + "/features?view=clean").json()
    assert result["coordinateSpace"] == "EPSG:4326"
    point = result["features"][0]["geometry"]["coordinates"][0]
    assert 104 < point[0] < 106 and 20 < point[1] < 22
    report = client.get("/api/gis/imports/" + job["id"] + "/report")
    assert report.headers["content-disposition"].startswith("attachment;")
    assert report.json()["audit"][-1]["action"] == "analyze"


def test_size_format_and_permissions(api):
    client, service = api
    assert (
        client.post(
            "/api/gis/imports", files={"files": ("x.exe", b"hello")}
        ).status_code
        == 415
    )
    assert (
        client.post("/api/gis/imports", files={"files": ("x.dxf", b"")}).status_code
        == 400
    )
    assert (
        client.post(
            "/api/gis/imports", headers={"content-length": str(101 * 1024 * 1024)}
        ).status_code
        == 413
    )
    assert (
        client.get("/api/gis/imports", headers={"test-permissions": ""}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/gis/imports",
            files={"files": ("x.dxf", b"hello")},
            headers={"test-permissions": "network-design:read"},
        ).status_code
        == 403
    )


def test_design_receipt_retry_does_not_recreate_with_different_key_and_publish_permission(
    tmp_path,
):
    service = ImportService(tmp_path)
    calls = []
    status = "Draft"

    def upstream(request):
        nonlocal status
        calls.append(
            (
                request.method,
                request.url.path,
                json.loads(request.content) if request.content else None,
            )
        )
        if request.url.path == "/api/design/imports":
            return httpx.Response(
                200,
                json={"projectId": "project1", "revisionId": "rev1", "assetCount": 3},
            )
        if request.url.path.endswith("/validate"):
            status = "Validated"
            return httpx.Response(200, json={"errors": []})
        if request.url.path.endswith("/submit"):
            status = "Submitted"
        if request.url.path.endswith("/approve"):
            status = "Approved"
        if request.url.path.endswith("/publish-result"):
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"status": status})

    gateway = DesignGateway("https://design.test", httpx.MockTransport(upstream))
    with TestClient(
        create_app(service, auth=auth, gateway=gateway, run_worker=False)
    ) as client:
        job = review(client, service, upload(client))
        url = "/api/gis/imports/" + job["id"]
        r = client.post(url + "/submit", json={"expectedVersion": job["version"]})
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["submission"]["status"] == "Submitted"
        r = client.post(url + "/submit", json={"expectedVersion": job["version"]})
        assert r.status_code == 200
        keys = [c[2]["importKey"] for c in calls if c[1] == "/api/design/imports"]
        assert len(set(keys)) == 1
        job = r.json()
        assert (
            client.post(
                url + "/publish",
                json={"expectedVersion": job["version"]},
                headers={
                    "test-permissions": "network-design:read,network-design:write"
                },
            ).status_code
            == 403
        )
        r = client.post(url + "/publish", json={"expectedVersion": job["version"]})
        assert r.status_code == 200, r.text
        assert r.json()["submission"]["status"] == "Approved"
        # Review is frozen once any downstream import attempt has started.
        assert (
            client.put(
                url + "/review", json={"expectedVersion": r.json()["version"]}
            ).status_code
            == 409
        )


def test_tenant_claim_validation_rejects_cross_org_header_override_and_ambiguous_org():
    claims = {
        "organization": {"shw": {"tenant_id": ["tnt_shw"]}},
        "scope": "openid organization:shw",
        "tenant_id": "tnt_shw",
    }
    assert tenant_from_claims(claims) == "tnt_shw"
    with pytest.raises(ValueError):
        tenant_from_claims({**claims, "tenant_id": "tnt_other"})
    with pytest.raises(ValueError):
        tenant_from_claims({**claims, "scope": "openid organization:*"})
    with pytest.raises(ValueError):
        tenant_from_claims({"tenant_id": "tnt_shw"})
    assert tenant_from_claims({"tenant_id": "tnt_shw"}, allow_flat=True) == "tnt_shw"


def test_status_poll_cannot_advance_version_during_publish(tmp_path):
    service = ImportService(tmp_path)
    job, _ = service.store.create("tenant-a", "actor", "Import", [], "fingerprint")
    job = service.store.mutate(
        "tenant-a",
        "actor",
        job["id"],
        job["version"],
        "fixture",
        lambda j: j.update(
            state="submitting", submission={"revisionId": "rev1", "status": "Submitted"}
        ),
    )

    def upstream(request):
        raise AssertionError(
            "Polling must not contact Design during an in-flight write"
        )

    with TestClient(
        create_app(
            service,
            auth=auth,
            gateway=DesignGateway("https://design.test", httpx.MockTransport(upstream)),
            run_worker=False,
        )
    ) as client:
        result = client.get("/api/gis/imports/" + job["id"] + "/publish-result")
        assert result.status_code == 200
        assert result.json()["version"] == job["version"]
        assert result.json()["state"] == "submitting"


def test_worker_liveness_controls_readiness(tmp_path):
    service = ImportService(tmp_path)
    with TestClient(create_app(service, auth=auth)) as client:
        assert client.get("/health").status_code == 200
        service.close()
        assert client.get("/health").status_code == 503


def test_uncertain_design_receipt_retries_identical_payload(tmp_path):
    service = ImportService(tmp_path)
    attempts = []

    def upstream(request):
        if request.url.path == "/api/design/imports":
            attempts.append(json.loads(request.content))
            if len(attempts) == 1:
                # Simulate a remote commit whose response was lost.
                raise httpx.ReadError("connection interrupted")
            return httpx.Response(200, json={"projectId": "p1", "revisionId": "r1"})
        if request.url.path.endswith("/validate"):
            return httpx.Response(
                200, json={"isValid": True, "errors": [], "warnings": []}
            )
        return httpx.Response(
            200,
            json={
                "status": "Submitted"
                if request.url.path.endswith("/submit")
                else "Draft"
            },
        )

    gateway = DesignGateway("https://design.test", httpx.MockTransport(upstream))
    with TestClient(
        create_app(service, auth=auth, gateway=gateway, run_worker=False)
    ) as client:
        job = review(client, service, upload(client))
        url = "/api/gis/imports/" + job["id"]
        response = client.post(
            url + "/submit",
            json={"expectedVersion": job["version"], "projectName": "First name"},
        )
        assert response.status_code == 502
        interrupted = client.get(url).json()
        assert interrupted["state"] == "ready"
        assert interrupted["submission"]["status"] == "RetryRequired"
        assert (
            client.put(
                url + "/review", json={"expectedVersion": interrupted["version"]}
            ).status_code
            == 409
        )
        response = client.post(
            url + "/submit",
            json={
                "expectedVersion": interrupted["version"],
                "projectName": "Must not change payload",
            },
        )
        assert response.status_code == 200, response.text
        assert len(attempts) == 2 and attempts[0] == attempts[1]
        assert response.json()["submission"]["revisionId"] == "r1"


def test_design_is_valid_false_stops_submission_even_without_error_rows(tmp_path):
    service = ImportService(tmp_path)
    paths = []

    def upstream(request):
        paths.append(request.url.path)
        if request.url.path == "/api/design/imports":
            return httpx.Response(200, json={"projectId": "p1", "revisionId": "r1"})
        if request.url.path.endswith("/validate"):
            return httpx.Response(
                200, json={"isValid": False, "errors": [], "warnings": []}
            )
        return httpx.Response(200, json={"status": "Draft"})

    gateway = DesignGateway("https://design.test", httpx.MockTransport(upstream))
    with TestClient(
        create_app(service, auth=auth, gateway=gateway, run_worker=False)
    ) as client:
        job = review(client, service, upload(client))
        response = client.post(
            "/api/gis/imports/" + job["id"] + "/submit",
            json={"expectedVersion": job["version"]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["submission"]["status"] == "Draft"
        assert not any(path.endswith("/submit") for path in paths)


def test_partial_gis_control_pair_round_trips_and_reanalysis_never_submits(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    path = '/api/gis/imports/' + job['id']
    current = client.get(path).json()
    payload = {
        'expectedVersion': current['version'], 'sourceCrs': None,
        'controlPointTargetCrs': 'EPSG:4326',
        'controlPoints': [{'source': [500000, 2320000], 'target': None, 'checkOnly': False}],
        'crsEvidence': '',
    }
    saved = client.put(path + '/review', json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()['reviewConfig']['controlPoints'] == payload['controlPoints']
    assert saved.json()['reviewConfig']['sourceCrs'] is None
    service.process(*service.store.work())
    final = client.get(path).json()
    assert final['state'] == 'needs_review' and final.get('submission') is None
    assert final['georeference']['status'] == 'incomplete'
    report = client.get(path + '/report').json()
    assert report['result']['drafts'] == []
    assert report['result']['coordinateSpace'] == 'cad'
    assert client.get(path, headers={'test-tenant': 'tenant-b'}).status_code == 404


def test_direct_source_metadata_round_trips_and_conflicting_pair_options_are_rejected(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    path = '/api/gis/imports/' + job['id']
    before = client.get(path).json()
    payload = {
        'expectedVersion': before['version'], 'sourceCrs': 'EPSG:9209',
        'sourceAxisOrder': 'yx', 'sourceUnits': 'mm',
        'sourceCrsPresetId': 'vn2000-tm3-105-30', 'crsEvidence': '',
    }
    rejected = client.put(path + '/review', json={
        **payload, 'controlPoints': [{'source': [1, 2], 'target': None}],
    })
    assert rejected.status_code == 422
    assert client.get(path).json()['version'] == before['version']
    saved = client.put(path + '/review', json=payload)
    assert saved.status_code == 200, saved.text
    for key in ('sourceCrs', 'sourceAxisOrder', 'sourceUnits', 'sourceCrsPresetId'):
        assert saved.json()['reviewConfig'][key] == payload[key]
    service.process(*service.store.work())
    final = client.get(path).json()
    assert final['state'] == 'needs_review' and final.get('submission') is None
    assert client.get(path + '/report').json()['result']['drafts'] == []


def test_line_edits_persist_reanalyze_and_preserve_source(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    path = '/api/gis/imports/' + job['id']
    job = client.get(path).json()
    source_path = service.directory('tenant-a', job['id']) / 'source-features.json'
    original = source_path.read_bytes()
    feature = json.loads(original)[0]
    config = {'expectedVersion': job['version'], 'sourceCrs': 'EPSG:32648',
        'crsEvidence': 'Survey fixture', 'acceptWarningCodes': ['DANGLING_ENDPOINTS'],
        'lineEdits': [
            {'id': feature['id'], 'fileId': job['files'][0]['id'], 'layer': 'PIPE',
             'coordinates': [[500000,2320000],[500050,2320000]], 'diameterMm':100, 'material':'HDPE'},
            {'id': 'draft-new', 'fileId': job['files'][0]['id'], 'layer': 'Biên tập bổ sung',
             'coordinates': [[500050,2320000],[500100,2320000]], 'diameterMm':100, 'material':'HDPE'},
        ]}
    assert client.put(path + '/review', json=config).status_code == 200
    service.process(*service.store.work())
    saved = client.get(path).json()
    assert saved['state'] == 'ready'
    assert saved['summary']['keptPipes'] == 2
    assert source_path.read_bytes() == original
    restarted = ImportService(service.root)
    restored = restarted.store.get('tenant-a', job['id'])
    assert restored['reviewConfig']['lineEdits'] == saved['reviewConfig']['lineEdits']
    result = restarted.result('tenant-a', restored)
    assert len(result['raw']) == 2
    assert any(source.get('manualEdit') for f in result['clean'] for source in f['properties'].get('sources', []))
    assert client.get(path, headers={'test-tenant':'other'}).status_code == 404
    config['expectedVersion'] = saved['version']
    config['lineEdits'][1].pop('material')
    assert client.put(path + '/review', json=config).status_code == 200
    service.process(*service.store.work())
    assert client.get(path).json()['state'] == 'needs_review'


def test_line_edits_reject_foreign_references_and_duplicate_ids(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    path = '/api/gis/imports/' + job['id']
    job = client.get(path).json()
    edit = {'id':'draft-new','fileId':job['files'][0]['id'],'layer':'Manual','coordinates':[[0,0],[1,1]]}
    body = {'expectedVersion':job['version'],'lineEdits':[edit]}
    assert client.put(path+'/review',json={**body,'lineEdits':[{**edit,'fileId':'foreign'}]}).status_code == 400
    assert client.put(path+'/review',json={**body,'lineEdits':[{**edit,'sourceFeatureId':'foreign'}]}).status_code == 400
    assert client.put(path+'/review',json={**body,'lineEdits':[edit,edit]}).status_code == 422
    assert client.put(path+'/review',json={**body,'lineEdits':[{**edit,'coordinates':[[0,0]]}]}).status_code == 422


def test_append_files_and_reversible_file_removal(api):
    client, service = api
    job = review(client, service, upload(client))
    base = '/api/gis/imports/' + job['id']
    fid = job['files'][0]['id']
    original = service.directory('tenant-a', job['id']) / (fid + '.dxf')
    source_bytes = original.read_bytes()
    before_config = job['reviewConfig']
    extra = dxf_bytes()
    response = client.post(base + '/files', data={'expectedVersion': job['version']}, files={'files': ('more.dxf', extra)})
    assert response.status_code == 202, response.text
    added = response.json()
    assert added['id'] == job['id'] and len(added['files']) == 2
    assert added['reviewConfig']['layerRules'] == before_config['layerRules']
    assert added['reviewConfig']['acceptWarningCodes'] == []
    assert client.post(base + '/files', data={'expectedVersion': job['version']}, files={'files': ('stale.dxf', extra)}).status_code == 409
    service.process(*service.store.work())
    current = client.get(base).json()
    assert current['state'] != 'failed', current
    assert len(current['inventory']['files']) == 2
    assert client.get(base + '/features').json()['total'] == 2
    config = {**current['reviewConfig'], 'expectedVersion': current['version'], 'excludedFileIds': [fid]}
    assert client.put(base + '/review', json=config).status_code == 200
    service.process(*service.store.work())
    page = client.get(base + '/features').json()
    assert page['total'] == 1 and page['features'][0]['properties']['fileId'] != fid
    current = client.get(base).json()
    # Removing the last active file is allowed as a draft, never Ready.
    config.update(expectedVersion=current['version'], excludedFileIds=[f['id'] for f in current['files']])
    assert client.put(base + '/review', json=config).status_code == 200
    service.process(*service.store.work())
    current = client.get(base).json()
    assert current['state'] == 'needs_review'
    assert client.get(base + '/features').json()['total'] == 0
    restored_service = ImportService(service.root)
    with TestClient(create_app(restored_service, auth=auth, run_worker=False)) as reopened:
        assert reopened.get(base).json()['reviewConfig']['excludedFileIds'] == config['excludedFileIds']
        config.update(expectedVersion=current['version'], excludedFileIds=[])
        assert reopened.put(base + '/review', json=config).status_code == 200
        restored_service.process(*restored_service.store.work())
        assert reopened.get(base + '/features').json()['total'] == 2
    assert original.read_bytes() == source_bytes


def test_append_files_checks_scope_duplicates_and_freeze(api):
    client, service = api
    job = review(client, service, upload(client))
    base = '/api/gis/imports/' + job['id']
    data = {'expectedVersion': job['version']}
    extra = dxf_bytes()
    assert client.post(base + '/files', data=data, files={'files': ('new.dxf', extra)}, headers={'test-tenant': 'other'}).status_code == 404
    assert client.post(base + '/files', data=data, files={'files': ('new.dxf', extra)}, headers={'test-permissions': 'network-design:read'}).status_code == 403
    original = service.directory('tenant-a', job['id']) / (job['files'][0]['id'] + '.dxf')
    assert client.post(base + '/files', data=data, files={'files': ('same.dxf', original.read_bytes())}).status_code == 400
    assert client.post(base + '/files', data=data, files={'files': ('bad.txt', b'bad')}).status_code == 415
    assert client.post(base + '/files', data=data, files={'files': ('empty.dxf', b'')}).status_code == 400
    assert client.get(base).json()['version'] == job['version']
    config = {**job['reviewConfig'], 'expectedVersion': job['version'], 'excludedFileIds': ['foreign-file']}
    assert client.put(base + '/review', json=config).status_code == 400
    frozen = service.store.mutate('tenant-a', 'tester', job['id'], job['version'], 'fixture-freeze', lambda j: j.update(submission={'revisionId': 'frozen'}, state='submitted'))
    assert client.post(base + '/files', data={'expectedVersion': frozen['version']}, files={'files': ('new.dxf', extra)}).status_code == 409


def test_position_preview_before_classifying_pipes_keeps_quality_gates(api):
    client, service = api
    job = upload(client)
    service.process(*service.store.work())
    base = '/api/gis/imports/' + job['id']
    current = client.get(base).json()
    config = {'expectedVersion': current['version'], 'sourceCrs': 'EPSG:32648'}
    assert client.put(base + '/review', json=config).status_code == 200
    service.process(*service.store.work())
    page = client.get(base + '/features?view=clean').json()
    assert page['features'] == []
    drawing = page['drawing']
    assert drawing['coordinateSpace'] == 'EPSG:4326' and drawing['total'] == 1
    assert 100 < drawing['bbox'][0] < 110 and 15 < drawing['bbox'][1] < 25
    current = client.get(base).json()
    assert current['state'] == 'needs_review'
    assert {'NO_PIPES', 'UNMAPPED_FEATURES', 'CRS_EVIDENCE_REQUIRED'} <= {x['code'] for x in current['issues']}
    config.update(expectedVersion=current['version'], sourceCrs='EPSG:99999999')
    assert client.put(base + '/review', json=config).status_code == 200
    service.process(*service.store.work())
    invalid = client.get(base + '/features?view=clean').json()['drawing']
    assert invalid['features'] == [] and invalid['error']
