from copy import deepcopy

import pytest

from wn_import import engine
from wn_import.engine import analyze
from wn_import.models import ReviewConfig


def feature(fid, coordinates, layer="PIPE", file="file1", **props):
    return {
        "type": "Feature",
        "id": fid,
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": {
            "fileId": file,
            "layer": layer,
            "entityType": "LINE",
            "handle": fid,
            "blockPath": fid,
            **props,
        },
    }


def block_feature(fid, coordinates, name, layer="SYMBOL", file="file1", **props):
    return {
        "type": "Feature",
        "id": fid,
        "geometry": {"type": "Point", "coordinates": coordinates},
        "properties": {
            "fileId": file,
            "layer": layer,
            "entityType": "INSERT",
            "handle": fid,
            "blockName": name,
            "blockPath": fid,
            "parentId": None,
            "isBlockGeometry": False,
            **props,
        },
    }


def config(**values):
    return ReviewConfig.model_validate(
        {
            "expectedVersion": 1,
            "sourceCrs": "EPSG:32648",
            "crsEvidence": "Survey fixture with known UTM coordinates",
            "layerRules": [
                {
                    "fileId": "file1",
                    "layer": "PIPE",
                    "action": "pipe",
                    "diameterMm": 100,
                    "material": "HDPE",
                }
            ],
            "acceptWarningCodes": ["DANGLING_ENDPOINTS"],
            **values,
        }
    )


def run(features, **values):
    return analyze(features, {"issues": []}, config(**values))


def test_no_crs_is_preview_only_even_for_looks_like_geographic():
    r = run([feature("a", [[105, 21], [105.01, 21]])], sourceCrs=None)
    assert (
        r["state"] == "needs_review"
        and r["coordinateSpace"] == "cad"
        and not r["drafts"]
    )
    assert any(x["code"] == "CRS_REQUIRED" for x in r["issues"])


def test_no_mapping_or_missing_attributes_blocks_publish():
    r = run([feature("a", [[500000, 2320000], [500100, 2320000]])], layerRules=[])
    assert r["state"] == "needs_review" and any(
        x["code"] == "UNMAPPED_FEATURES" for x in r["issues"]
    )
    r = run(
        [feature("a", [[500000, 2320000], [500100, 2320000]])],
        layerRules=[{"fileId": "file1", "layer": "PIPE", "action": "pipe"}],
    )
    assert r["state"] == "needs_review" and any(
        x["code"] == "MISSING_PIPE_ATTRIBUTES" for x in r["issues"]
    )


def test_pipe_material_is_normalized_or_rejected_before_review():
    canonical = config(
        layerRules=[
            {
                "fileId": "file1",
                "layer": "PIPE",
                "action": "pipe",
                "diameterMm": 100,
                "material": "  ductileiron  ",
            }
        ]
    )
    assert canonical.layerRules[0].material == "DuctileIron"
    with pytest.raises(ValueError, match="HDPE, PVC, DuctileIron"):
        config(
            layerRules=[
                {
                    "fileId": "file1",
                    "layer": "PIPE",
                    "action": "pipe",
                    "diameterMm": 100,
                    "material": "uPVC",
                }
            ]
        )


def test_reversed_duplicate_is_removed_but_parallel_is_preserved_and_requires_review():
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500100, 2320000], [500000, 2320000]]),
        feature("c", [[500000, 2320001], [500100, 2320001]]),
    ]
    original = deepcopy(fs)
    r = run(fs)
    assert fs == original
    assert r["summary"]["duplicates"] == 1 and r["summary"]["keptPipes"] == 2
    assert (
        len(next(f for f in r["clean"] if f["id"] == "a")["properties"]["sources"]) == 2
    )
    assert r["state"] == "needs_review"
    assert any(x["code"] == "NEAR_OVERLAPPING_ROUTES" for x in r["issues"])
    assert 199 < r["summary"]["totalLengthM"] < 201


def test_block_child_strokes_never_become_pipes_from_their_layer():
    child = feature(
        "child",
        [[500000, 2320000], [500001, 2320000]],
        isBlockGeometry=True,
        parentId="symbol",
        blockName="ValveSymbol",
    )
    r = run([child])
    assert r["raw"][0]["properties"]["disposition"] == "reference"
    assert r["summary"]["keptPipes"] == 0


def test_explicit_block_node_and_device_host_generate_provenanced_point_assets():
    fs = [
        feature("pipe", [[500000, 2320000], [500100, 2320000]]),
        block_feature("reservoir", [500000, 2320000], "ReservoirSymbol"),
        block_feature("valve", [500050, 2320000], "ValveSymbol"),
    ]
    r = run(
        fs,
        blockRules=[
            {
                "fileId": "file1",
                "blockName": "ReservoirSymbol",
                "action": "node",
                "nodeType": "Reservoir",
            },
            {
                "fileId": "file1",
                "blockName": "ValveSymbol",
                "action": "device",
                "deviceType": "Valve",
            },
        ],
        deviceHosts=[{"featureId": "valve", "hostFeatureId": "pipe"}],
    )
    assert r["state"] == "ready"
    assert (
        r["summary"]["nodes"] == 2
        and r["summary"]["devices"] == 1
        and r["summary"]["keptPipes"] == 1
    )
    node = next(
        x
        for x in r["drafts"]
        if x["kind"] == "Node" and x["attributes"]["nodeType"] == "Reservoir"
    )
    device = next(x for x in r["drafts"] if x["kind"] == "Device")
    pipe = next(x for x in r["drafts"] if x["kind"] == "Pipe")
    assert pipe["fromRef"] == node["clientRef"]
    assert device["hostRef"] == pipe["clientRef"]
    assert device["attributes"]["deviceType"] == "Valve"
    assert device["attributes"]["sourceBlockName"] == "ValveSymbol"
    assert {
        f["properties"]["kind"] for f in r["clean"] if f["geometry"]["type"] == "Point"
    } == {"Node", "Device"}


def test_device_host_is_never_guessed_and_ambiguous_split_host_blocks_publish():
    fs = [
        feature("host", [[500000, 2320000], [500100, 2320000]]),
        feature("branch", [[500050, 2320000], [500050, 2320050]]),
        block_feature("valve", [500050, 2320000], "ValveSymbol"),
    ]
    blocks = [
        {
            "fileId": "file1",
            "blockName": "ValveSymbol",
            "action": "device",
            "deviceType": "Valve",
        }
    ]
    missing = run(fs, blockRules=blocks)
    assert any(x["code"] == "DEVICE_HOST_REQUIRED" for x in missing["issues"])
    ambiguous = run(
        fs,
        blockRules=blocks,
        deviceHosts=[{"featureId": "valve", "hostFeatureId": "host"}],
        connectEndpointFeatureIds=["branch"],
    )
    assert ambiguous["summary"]["keptPipes"] == 3
    assert ambiguous["summary"]["devices"] == 0
    assert any(x["code"] == "AMBIGUOUS_DEVICE_HOST" for x in ambiguous["issues"])


def test_device_host_kind_and_metric_distance_are_validated():
    fs = [
        feature("pipe", [[500000, 2320000], [500100, 2320000]]),
        block_feature("node", [500000, 2320000], "NodeSymbol"),
        block_feature("pump", [500000, 2320000], "PumpSymbol"),
        block_feature("far-valve", [500050, 2320010], "ValveSymbol"),
    ]
    block_rules = [
        {
            "fileId": "file1",
            "blockName": "NodeSymbol",
            "action": "node",
            "nodeType": "Junction",
        },
        {
            "fileId": "file1",
            "blockName": "PumpSymbol",
            "action": "device",
            "deviceType": "Pump",
        },
        {
            "fileId": "file1",
            "blockName": "ValveSymbol",
            "action": "device",
            "deviceType": "Valve",
        },
    ]
    r = run(
        fs,
        blockRules=block_rules,
        deviceHosts=[
            {"featureId": "pump", "hostFeatureId": "pipe"},
            {"featureId": "far-valve", "hostFeatureId": "pipe"},
        ],
    )
    assert any(
        x["code"] == "INVALID_DEVICE_HOST" and x.get("featureId") == "pump"
        for x in r["issues"]
    )
    assert any(
        x["code"] == "DEVICE_HOST_TOO_FAR" and x.get("featureId") == "far-valve"
        for x in r["issues"]
    )
    assert r["summary"]["devices"] == 0


def test_crossing_lines_are_not_automatically_connected():
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500050, 2319950], [500050, 2320050]]),
    ]
    r = run(fs)
    assert len(r["drafts"]) == 6 and r["summary"]["nodes"] == 4
    assert any(x["code"] == "UNCONNECTED_CROSSING" for x in r["issues"])
    assert r["state"] == "needs_review"


def test_endpoint_on_pipe_requires_explicit_confirmation_then_splits_host():
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500050, 2320000], [500050, 2320050]]),
    ]
    r = run(fs)
    assert any(x["code"] == "POSSIBLE_TEE" for x in r["issues"])
    r = run(fs, connectEndpointFeatureIds=["b"])
    assert r["summary"]["keptPipes"] == 3 and r["summary"]["nodes"] == 4
    pipes = [x for x in r["drafts"] if x["kind"] == "Pipe"]
    endpoints = [p[k] for p in pipes for k in ("fromRef", "toRef")]
    assert max(endpoints.count(n) for n in endpoints) == 3


def test_individual_exclusion_and_short_line_filter_are_auditable():
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500000, 2320100], [500000.01, 2320100]]),
        feature("c", [[500000, 2320200], [500100, 2320200]]),
    ]
    r = run(fs, excludeFeatureIds=["c"], minLengthM=0.1)
    assert r["summary"]["keptPipes"] == 1
    assert {
        f["id"] for f in r["raw"] if f["properties"].get("disposition") == "exclude"
    } == {"b", "c"}
    assert all(
        f["properties"].get("reason")
        for f in r["raw"]
        if f["properties"].get("disposition") == "exclude"
    )


def test_snap_does_not_join_interior_crossing_and_has_recorded_distances():
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500100.05, 2320000], [500200, 2320000]]),
    ]
    r = run(
        fs, snapToleranceM=0.1, acceptWarningCodes=["DANGLING_ENDPOINTS", "SNAP_REVIEW"]
    )
    assert r["summary"]["nodes"] == 3 and r["state"] == "ready"
    assert any(f["properties"].get("snaps") for f in r["clean"])


def test_final_geometry_is_rechecked_after_snap_closes_a_pipe():
    almost_closed = feature(
        "almost-closed",
        [
            [500000, 2320000],
            [500010, 2320000],
            [500005, 2320010],
            [500000.03, 2320000.04],
        ],
    )
    before = run([almost_closed])
    assert not any(x["code"] == "CLOSED_PIPE" for x in before["issues"])
    after = run([almost_closed], snapToleranceM=0.1)
    assert any(x["code"] == "CLOSED_PIPE" for x in after["issues"])
    assert after["state"] == "needs_review"


def test_spatial_pair_budget_blocks_partial_analysis(monkeypatch):
    monkeypatch.setattr(engine, "MAX_SPATIAL_PAIR_CHECKS", 1)
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500000, 2320001], [500100, 2320001]]),
        feature("c", [[500000, 2320002], [500100, 2320002]]),
    ]
    result = run(fs)
    assert any(x["code"] == "SPATIAL_REVIEW_TOO_COMPLEX" for x in result["issues"])
    assert result["drafts"] == []
    assert result["state"] == "needs_review"


def test_near_overlap_finding_cap_bounds_pair_metadata(monkeypatch):
    monkeypatch.setattr(engine, "MAX_SPATIAL_FINDINGS", 1)
    fs = [
        feature("a", [[500000, 2320000], [500100, 2320000]]),
        feature("b", [[500000, 2320001], [500100, 2320001]]),
        feature("c", [[500000, 2320002], [500100, 2320002]]),
    ]
    result = run(fs)
    findings = [x for x in result["issues"] if x["code"] == "NEAR_OVERLAPPING_ROUTES"]
    references = sum(
        len(f["properties"].get("nearOverlapFeatureIds", [])) for f in result["clean"]
    )
    assert len(findings) == 1 and references == 2
    assert any(x["code"] == "SPATIAL_REVIEW_TOO_COMPLEX" for x in result["issues"])
    assert result["drafts"] == []


def test_crossing_finding_cap_blocks_and_bounds_warnings(monkeypatch):
    monkeypatch.setattr(engine, "MAX_SPATIAL_FINDINGS", 1)
    fs = [
        feature("h1", [[500000, 2320000], [500100, 2320000]]),
        feature("h2", [[500000, 2320010], [500100, 2320010]]),
        feature("v1", [[500010, 2319995], [500010, 2320015]]),
        feature("v2", [[500020, 2319995], [500020, 2320015]]),
    ]
    result = run(fs)
    assert sum(x["code"] == "UNCONNECTED_CROSSING" for x in result["issues"]) == 1
    assert any(x["code"] == "SPATIAL_REVIEW_TOO_COMPLEX" for x in result["issues"])
    assert result["drafts"] == []


def test_unknown_coordinates_nan_and_excessive_tolerances_are_rejected():
    with pytest.raises(ValueError):
        config(snapToleranceM=float("nan"))
    with pytest.raises(ValueError):
        config(snapToleranceM=5)
    r = run(
        [feature("a", [[500000, 2320000], [500100, 2320000]])], sourceCrs="made-up-crs"
    )
    assert any(x["code"] == "INVALID_CRS" for x in r["issues"])


def test_affine_needs_independent_control_and_refuses_bad_fit():
    controls = [
        {"source": p, "target": [p[0] + 500000, p[1] + 2320000]}
        for p in ([0, 0], [100, 0], [0, 100])
    ]
    fs = [feature("a", [[0, 0], [100, 0]])]
    r = run(fs, controlPoints=controls)
    assert any(x["code"] == "CONTROL_POINTS_INVALID" for x in r["issues"])
    r = run(
        fs,
        controlPoints=controls
        + [{"source": [100, 100], "target": [500100, 2320100], "checkOnly": True}],
    )
    assert r["state"] == "ready"
    r = run(
        fs,
        controlPoints=controls
        + [{"source": [100, 100], "target": [500110, 2320100], "checkOnly": True}],
    )
    assert r["state"] == "needs_review"


def test_removed_short_and_zero_lines_do_not_require_pipe_metadata():
    features = [
        feature("valid", [[500000, 2320000], [500100, 2320000]]),
        feature("short", [[501000, 2320000], [501000.05, 2320000]], layer="SCRAP"),
        feature("zero", [[502000, 2320000], [502000, 2320000]], layer="SCRAP"),
    ]
    rules = [r.model_dump() for r in config().layerRules] + [
        {"fileId": "file1", "layer": "SCRAP", "action": "pipe"}
    ]
    result = run(features, layerRules=rules, minLengthM=0.1)
    assert result["state"] == "ready", result["issues"]
    assert result["summary"]["keptPipes"] == 1
    assert result["summary"]["excluded"] == 2
    assert not any(i["code"] == "MISSING_PIPE_ATTRIBUTES" for i in result["issues"])
    raw = run([features[2]], layerRules=rules, sourceCrs=None)
    assert raw["summary"]["excluded"] == 1
    assert raw["clean"] == []
