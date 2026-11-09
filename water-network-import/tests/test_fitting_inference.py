"""Nodes the drawing leaves unnamed get the fitting the pipes meeting there make (decision 0030).

Only what the drawing determines is filled in: the component from how many pipes meet and how
they meet, and dn/dn2/material/angle from those pipes. Nothing is added that the drawing does
not show (no caps, hydrants, sources), and dead ends stay plain junctions.
"""

from test_engine import block_feature, feature, run

LAYERS = [
    {"fileId": "file1", "layer": "PIPE", "action": "pipe", "diameterMm": 110, "material": "HDPE"},
    {"fileId": "file1", "layer": "PIPE160", "action": "pipe", "diameterMm": 160, "material": "HDPE"},
    {"fileId": "file1", "layer": "PIPE90PVC", "action": "pipe", "diameterMm": 90, "material": "PVC"},
    {"fileId": "file1", "layer": "PIPE40", "action": "pipe", "diameterMm": 40, "material": "HDPE"},
]
O = [500000, 2320000]


def at(dx, dy):
    return [O[0] + dx, O[1] + dy]


def nodes(r):
    pipes = [d for d in r["drafts"] if d["kind"] == "Pipe"]
    out = {}
    for d in r["drafts"]:
        if d["kind"] == "Node":
            degree = sum(d["clientRef"] in (p["fromRef"], p["toRef"]) for p in pipes)
            out.setdefault(degree, []).append(d["attributes"])
    return out


def ready(features, **values):
    r = run(features, layerRules=LAYERS, **values)
    assert not [i for i in r["issues"] if i["severity"] == "error"], r["issues"]
    return r


def test_three_pipes_of_one_diameter_meet_at_a_tee():
    r = ready([
        feature("a", [at(-50, 0), O]),
        feature("b", [O, at(50, 0)]),
        feature("c", [O, at(0, 50)]),
    ])
    (tee,) = nodes(r)[3]
    assert tee["componentCode"] == "Tee"
    assert (tee["dn"], tee["material"]) == ("110", "HDPE")
    assert "dn2" not in tee
    assert tee["componentFrom"] == "geometry"


def test_a_smaller_branch_makes_a_reducing_tee():
    (tee,) = nodes(ready([
        feature("a", [at(-50, 0), O], layer="PIPE160"),
        feature("b", [O, at(50, 0)], layer="PIPE160"),
        feature("c", [O, at(0, 50)]),
    ]))[3]
    assert (tee["componentCode"], tee["dn"], tee["dn2"]) == ("ReducingTee", "160", "110")


def test_four_pipes_meet_at_a_cross():
    (cross,) = nodes(ready([
        feature("a", [at(-50, 0), O]),
        feature("b", [O, at(50, 0)]),
        feature("c", [O, at(0, 50)]),
        feature("d", [O, at(0, -50)]),
    ]))[4]
    assert cross["componentCode"] == "Cross"


def test_a_diameter_change_on_a_run_is_a_reducer():
    (reducer,) = nodes(ready([
        feature("a", [at(-50, 0), O], layer="PIPE160"),
        feature("b", [O, at(50, 0)]),
    ]))[2]
    assert (reducer["componentCode"], reducer["dn"], reducer["dn2"]) == ("Reducer", "160", "110")


def test_a_turn_is_a_bend_with_its_angle():
    (bend,) = nodes(ready([
        feature("a", [at(-50, 0), O]),
        feature("b", [O, at(0, 50)]),
    ]))[2]
    assert (bend["componentCode"], bend["angle"], bend["dn"]) == ("Bend", "90", "110")


def test_a_slight_deflection_stays_a_joint():
    (joint,) = nodes(ready([
        feature("a", [at(-50, 0), O]),
        feature("b", [O, at(50, 4)]),  # ~4.6 degrees
    ]))[2]
    assert joint["componentCode"] == "Junction"
    assert joint["dn"] == "110"


def test_dead_ends_stay_junctions_and_nothing_is_added():
    r = ready([feature("a", [at(-50, 0), O])])
    ends = nodes(r)[1]
    assert [e["componentCode"] for e in ends] == ["Junction", "Junction"]
    assert len(r["drafts"]) == 3


def test_mixed_materials_leave_material_unknown():
    (tee,) = nodes(ready([
        feature("a", [at(-50, 0), O], layer="PIPE90PVC"),
        feature("b", [O, at(50, 0)], layer="PIPE90PVC"),
        feature("c", [O, at(0, 50)], layer="PIPE90PVC"),
    ]))[3]
    assert tee["material"] == "PVC"
    (red,) = nodes(ready([
        feature("a", [at(-50, 0), O], layer="PIPE90PVC"),
        feature("b", [O, at(50, 0)]),
    ]))[2]
    assert red["componentCode"] == "Reducer" and "material" not in red


def test_a_value_outside_the_catalog_range_is_left_out():
    (tee,) = nodes(ready([
        feature("a", [at(-50, 0), O], layer="PIPE40"),
        feature("b", [O, at(50, 0)], layer="PIPE40"),
        feature("c", [O, at(0, 50)], layer="PIPE40"),
    ]))[3]
    assert tee["componentCode"] == "Tee" and "dn" not in tee  # Tee is DN50+


def test_drawn_fittings_keep_their_component_and_get_missing_values():
    r = ready(
        [
            feature("a", [at(-50, 0), O]),
            feature("b", [O, at(0, 50)]),
            block_feature("bend", O, "CUT"),
            feature("c", [at(100, 0), at(150, 0)], layer="PIPE160"),
            feature("d", [at(150, 0), at(200, 0)]),
            block_feature("red", at(150, 0), "CON", blockAttributes={"DN": "150", "DN2": "100"}),
        ],
        blockRules=[
            {"fileId": "file1", "blockName": "CUT", "action": "component", "componentCode": "Bend"},
            {"fileId": "file1", "blockName": "CON", "action": "component", "componentCode": "Reducer"},
        ],
    )
    by_code = {n["componentCode"]: n for n in nodes(r)[2]}
    assert (by_code["Bend"]["angle"], by_code["Bend"]["dn"]) == ("90", "110")
    assert "componentFrom" not in by_code["Bend"]
    assert (by_code["Reducer"]["dn"], by_code["Reducer"]["dn2"]) == ("150", "100")  # the drawing's own values


def test_a_drawn_fitting_where_pipes_branch_is_reported():
    r = ready(
        [
            feature("a", [at(-50, 0), O]),
            feature("b", [O, at(50, 0)]),
            feature("c", [O, at(0, 50)]),
            block_feature("bend", O, "CUT"),
        ],
        blockRules=[{"fileId": "file1", "blockName": "CUT", "action": "component", "componentCode": "Bend"}],
    )
    (node,) = nodes(r)[3]
    assert node["componentCode"] == "Bend"  # the drawing's symbol is not overruled
    assert "FITTING_BRANCH_MISMATCH" in [i["code"] for i in r["issues"]]


def test_a_drawn_bend_on_a_straight_run_keeps_its_angle_unknown():
    r = ready(
        [feature("a", [at(-50, 0), O]), feature("b", [O, at(50, 0)]), block_feature("bend", O, "CUT")],
        blockRules=[{"fileId": "file1", "blockName": "CUT", "action": "component", "componentCode": "Bend"}],
    )
    (bend,) = nodes(r)[2]
    assert bend["componentCode"] == "Bend" and "angle" not in bend and bend["dn"] == "110"


def test_a_valve_without_a_size_takes_its_pipe_diameter():
    r = ready(
        [feature("a", [at(-50, 0), at(50, 0)], layer="PIPE160"), block_feature("v", at(0, 0), "VAN")],
        blockRules=[{"fileId": "file1", "blockName": "VAN", "action": "component", "componentCode": "GateValve"}],
        deviceHosts=[{"featureId": "v", "hostFeatureId": "a"}],
    )
    (valve,) = [d["attributes"] for d in r["drafts"] if d["kind"] == "Device"]
    assert valve["dn"] == "160" and "state" not in valve


def test_inference_can_be_switched_off():
    r = ready(
        [feature("a", [at(-50, 0), O]), feature("b", [O, at(0, 50)])],
        inferFittings=False,
    )
    (joint,) = nodes(r)[2]
    assert joint["componentCode"] == "Junction" and "dn" not in joint


VALVE = [{"fileId": "file1", "blockName": "VAN", "action": "component", "componentCode": "GateValve"}]


def test_a_valve_drawn_on_one_pipe_is_hosted_by_it_without_a_selection():
    r = ready(
        [
            feature("a", [at(-50, 0), at(50, 0)]),
            feature("far", [at(-50, 30), at(50, 30)]),
            block_feature("v", at(10, 0.4), "VAN"),
        ],
        blockRules=VALVE,
        hostToleranceM=0.5,
    )
    pipes = {d["attributes"]["sourceFeatureId"]: d["clientRef"] for d in r["drafts"] if d["kind"] == "Pipe"}
    (valve,) = [d for d in r["drafts"] if d["kind"] == "Device"]
    assert valve["hostRef"] == pipes["a"]
    assert "DEVICE_HOST_RESOLVED" in [i["code"] for i in r["issues"]]


def test_a_valve_with_no_pipe_or_two_pipes_in_reach_still_needs_a_selection():
    for features in (
        [feature("a", [at(-50, 0), at(50, 0)]), block_feature("v", at(10, 3), "VAN")],
        [
            feature("a", [at(-50, 0), at(50, 0)]),
            feature("b", [at(-50, 0.6), at(50, 0.6)], layer="PIPE160"),
            block_feature("v", at(10, 0.3), "VAN"),
        ],
    ):
        r = run(features, layerRules=LAYERS, blockRules=VALVE, hostToleranceM=0.5)
        assert "DEVICE_HOST_REQUIRED" in [i["code"] for i in r["issues"]]


def test_a_selection_wins_over_the_nearest_pipe():
    r = ready(
        [
            feature("a", [at(-50, 0), at(50, 0)]),
            feature("b", [at(-50, 1), at(50, 1)], layer="PIPE160"),
            block_feature("v", at(10, 0.2), "VAN"),
        ],
        blockRules=VALVE,
        hostToleranceM=2,
        deviceHosts=[{"featureId": "v", "hostFeatureId": "b"}],
    )
    (valve,) = [d for d in r["drafts"] if d["kind"] == "Device"]
    assert valve["attributes"]["dn"] == "160"
