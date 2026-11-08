"""Block mappings by component code (the platform catalog, @wn/component-models)."""

import pytest
from pydantic import ValidationError

from wn_import.catalog import component, component_codes
from wn_import.models import BlockRule

from test_engine import block_feature, feature, run


def test_catalog_copy_is_loaded_and_says_how_gis_stores_each_code():
    codes = component_codes()
    assert len(codes) >= 45
    assert component("GateValve")["gisDeviceType"] == "Valve"
    assert component("Pump")["gisKind"] == "Device" and component("Pump")["host"] == "node"
    assert component("Tee")["gisNodeType"] == "Junction"
    assert component("Reservoir")["gisNodeType"] == "Reservoir"
    assert component("Unknown") is None


def test_component_rule_requires_a_known_point_component():
    BlockRule(fileId="f", blockName="V", action="component", componentCode="PRV")
    with pytest.raises(ValidationError):
        BlockRule(fileId="f", blockName="V", action="component", componentCode="Gate valve")
    with pytest.raises(ValidationError):  # a pipe comes from a layer rule
        BlockRule(fileId="f", blockName="V", action="component", componentCode="Pipe")
    with pytest.raises(ValidationError):  # the type follows from the catalog
        BlockRule(fileId="f", blockName="V", action="component", componentCode="PRV", deviceType="Valve")
    with pytest.raises(ValidationError):
        BlockRule(fileId="f", blockName="V", action="device", deviceType="Valve", componentCode="PRV")


def test_component_blocks_become_gis_nodes_and_devices_carrying_their_code():
    fs = [
        feature("pipe", [[500000, 2320000], [500100, 2320000]]),
        block_feature("res", [500000, 2320000], "BE_CHUA"),
        block_feature("prv", [500050, 2320000], "VAN_GIAM_AP"),
        block_feature("tee", [500100, 2320000], "TE_DEU"),
    ]
    r = run(
        fs,
        blockRules=[
            {"fileId": "file1", "blockName": "BE_CHUA", "action": "component", "componentCode": "Reservoir"},
            {"fileId": "file1", "blockName": "VAN_GIAM_AP", "action": "component", "componentCode": "PRV"},
            {"fileId": "file1", "blockName": "TE_DEU", "action": "component", "componentCode": "Tee"},
        ],
        deviceHosts=[{"featureId": "prv", "hostFeatureId": "pipe"}],
    )
    assert r["state"] == "ready"
    by_code = {d["attributes"].get("componentCode"): d for d in r["drafts"] if d["attributes"].get("componentCode")}
    assert by_code["Reservoir"]["kind"] == "Node" and by_code["Reservoir"]["attributes"]["nodeType"] == "Reservoir"
    assert by_code["Tee"]["kind"] == "Node" and by_code["Tee"]["attributes"]["nodeType"] == "Junction"
    prv = by_code["PRV"]
    pipe = next(d for d in r["drafts"] if d["kind"] == "Pipe")
    assert prv["kind"] == "Device" and prv["attributes"]["deviceType"] == "Valve" and prv["hostRef"] == pipe["clientRef"]
