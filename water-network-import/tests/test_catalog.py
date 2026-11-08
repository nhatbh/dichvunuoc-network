"""Block mappings by component code (the platform catalog, decision 0028)."""

import pytest
from pydantic import ValidationError

from wn_import.catalog import accepts_host, component, component_codes, properties_from_block
from wn_import.models import BlockRule

from test_engine import block_feature, feature, run


def test_catalog_copy_gives_kind_host_and_functions():
    codes = component_codes()
    assert len(codes) >= 45
    assert component("GateValve")["kind"] == "Device" and component("GateValve")["host"] == "pipe"
    assert component("GateValve")["functions"] == ["isolates"]
    assert component("Pump")["host"] == "pipe"
    assert component("Hydrant")["host"] == "node"
    assert component("Tee")["kind"] == "Node"
    assert component("BoosterStation")["kind"] == "Node"
    assert component("Unknown") is None


def test_component_rule_requires_a_known_point_component():
    BlockRule(fileId="f", blockName="V", action="component", componentCode="PRV")
    with pytest.raises(ValidationError):
        BlockRule(fileId="f", blockName="V", action="component", componentCode="Gate valve")
    with pytest.raises(ValidationError):  # a pipe comes from a layer rule
        BlockRule(fileId="f", blockName="V", action="component", componentCode="Pipe")
    with pytest.raises(ValidationError):  # the kind follows from the catalog
        BlockRule(fileId="f", blockName="V", action="component", componentCode="PRV", deviceType="Valve")


@pytest.mark.parametrize(
    "rule, code",
    [
        ({"action": "node", "nodeType": "Junction"}, "Junction"),
        ({"action": "node", "nodeType": "Other"}, "Junction"),
        ({"action": "node", "nodeType": "Tank"}, "Tank"),
        ({"action": "device", "deviceType": "Valve"}, "GateValve"),
        ({"action": "device", "deviceType": "FlowMeter"}, "BulkMeter"),
        ({"action": "device", "deviceType": "Hydrant"}, "Hydrant"),
    ],
)
def test_legacy_node_and_device_rules_become_component_rules(rule, code):
    r = BlockRule.model_validate({"fileId": "f", "blockName": "B", **rule})
    assert (r.action, r.componentCode) == ("component", code)


def test_codes_are_canonical():
    assert BlockRule(fileId="f", blockName="V", action="component", componentCode="gatevalve").componentCode == "GateValve"


def test_hosts_follow_the_catalog():
    assert accepts_host("GateValve", "Pipe") and not accepts_host("GateValve", "Node")
    assert accepts_host("Hydrant", "Node") and accepts_host("Hydrant", "Pipe")  # pipe end node
    assert not accepts_host("Tee", "Pipe")


def test_block_attributes_map_to_catalog_properties():
    props, rejected = properties_from_block("Reducer", {"DN": "200", "dn2": "150", "Material": "HDPE", "NOTE": "x"})
    assert props == {"dn": "200", "dn2": "150", "material": "HDPE"}
    assert rejected == []
    props, rejected = properties_from_block("GateValve", {"DN": "abc", "STATE": "closed"})
    assert props == {"state": "closed"} and rejected == ["DN=abc"]


def six_components():
    return run(
        [
            feature("pipe", [[500000, 2320000], [500100, 2320000]]),
            feature("pipe2", [[500100, 2320000], [500200, 2320000]]),
            block_feature("tee", [500000, 2320000], "TE"),
            block_feature("red", [500100, 2320000], "COT_THU", blockAttributes={"DN": "200", "DN2": "150"}),
            block_feature("prv", [500050, 2320000], "VAN_GIAM_AP", blockAttributes={"SETPOINT": "35"}),
            block_feature("air", [500200, 2320000], "VAN_XA_KHI"),
            block_feature("meter", [500150, 2320000], "DONG_HO_TONG"),
            block_feature("boost", [500300, 2320300], "TRAM_TANG_AP", blockAttributes={"PUMPCOUNT": "3"}),
        ],
        blockRules=[
            {"fileId": "file1", "blockName": "TE", "action": "component", "componentCode": "Tee"},
            {"fileId": "file1", "blockName": "COT_THU", "action": "component", "componentCode": "Reducer"},
            {"fileId": "file1", "blockName": "VAN_GIAM_AP", "action": "component", "componentCode": "PRV"},
            {"fileId": "file1", "blockName": "VAN_XA_KHI", "action": "component", "componentCode": "AirValve"},
            {"fileId": "file1", "blockName": "DONG_HO_TONG", "action": "component", "componentCode": "BulkMeter"},
            {"fileId": "file1", "blockName": "TRAM_TANG_AP", "action": "component", "componentCode": "BoosterStation"},
        ],
        deviceHosts=[
            {"featureId": "prv", "hostFeatureId": "pipe"},
            {"featureId": "meter", "hostFeatureId": "pipe2"},
            {"featureId": "air", "hostFeatureId": "pipe2"},  # attaches to pipe2's end node
        ],
    )


def test_component_blocks_become_drafts_carrying_code_and_properties():
    r = six_components()
    assert r["state"] == "ready", [i for i in r["issues"] if i["severity"] == "error"]
    by_code = {d["attributes"]["componentCode"]: d for d in r["drafts"] if d["kind"] != "Pipe" and d["attributes"]["componentCode"] != "Junction"}
    assert set(by_code) == {"Tee", "Reducer", "PRV", "AirValve", "BulkMeter", "BoosterStation"}
    assert by_code["Tee"]["kind"] == "Node" and by_code["BoosterStation"]["kind"] == "Node"
    assert by_code["Reducer"]["attributes"]["dn"] == "200" and by_code["Reducer"]["attributes"]["dn2"] == "150"
    assert by_code["BoosterStation"]["attributes"]["pumpCount"] == "3"
    assert all("nodeType" not in d["attributes"] and "deviceType" not in d["attributes"] for d in r["drafts"])
    pipes = {d["attributes"]["sourceFeatureId"]: d for d in r["drafts"] if d["kind"] == "Pipe"}
    prv = by_code["PRV"]
    assert prv["kind"] == "Device" and prv["hostRef"] == pipes["pipe"]["clientRef"]
    assert prv["attributes"]["setpoint"] == "35"
    assert by_code["BulkMeter"]["hostRef"] == pipes["pipe2"]["clientRef"]
    assert by_code["AirValve"]["hostRef"] == pipes["pipe2"]["toRef"]


def test_generated_pipe_end_nodes_are_junctions():
    r = six_components()
    generated = [d for d in r["drafts"] if d["kind"] == "Node" and d["attributes"]["generatedFrom"].startswith("pipe-endpoint")]
    assert generated and all(d["attributes"]["componentCode"] == "Junction" for d in generated)


def test_point_device_far_from_pipe_ends_is_rejected():
    r = run(
        [
            feature("pipe", [[500000, 2320000], [500100, 2320000]]),
            block_feature("hyd", [500050, 2320000], "TRU_CUU_HOA"),
        ],
        blockRules=[{"fileId": "file1", "blockName": "TRU_CUU_HOA", "action": "component", "componentCode": "Hydrant"}],
        deviceHosts=[{"featureId": "hyd", "hostFeatureId": "pipe"}],
    )
    assert any(i["code"] == "DEVICE_HOST_TOO_FAR" for i in r["issues"])
