import hashlib

import ezdxf
import pytest

from wn_import import cad
from wn_import.cad import read_document


def test_modelspace_blocks_arcs_and_annotations_preserve_provenance(tmp_path):
    doc = ezdxf.new("R2018")
    doc.units = 6
    doc.layers.new("PIPE_DN100_HDPE")
    block = doc.blocks.new("ValveSymbol")
    block.add_line((0, 0), (1, 0))
    model = doc.modelspace()
    model.add_line(
        (500000, 2320000), (500100, 2320000), dxfattribs={"layer": "PIPE_DN100_HDPE"}
    )
    model.add_text("DN100 HDPE", dxfattribs={"insert": (500010, 2320010)})
    model.add_blockref(
        "ValveSymbol",
        (500050, 2320000),
        dxfattribs={
            "xscale": 2,
            "yscale": 2,
            "rotation": 90,
            "layer": "PIPE_DN100_HDPE",
        },
    )
    model.add_arc((500000, 2320000), 10, 0, 90)
    doc.layout().add_line((0, 0), (100, 100))
    path = tmp_path / "network.dxf"
    doc.saveas(path)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    r = read_document({"id": "one", "name": path.name}, path, tmp_path / "out")
    assert r["file"]["units"] == 6 and r["file"]["paperSpaceCount"] == 1
    assert len(r["features"]) == 5
    symbol = next(x for x in r["features"] if x["properties"]["entityType"] == "INSERT")
    assert symbol["geometry"]["coordinates"] == [500050, 2320000]
    assert symbol["properties"]["blockName"] == "ValveSymbol"
    assert symbol["properties"]["parentId"] is None
    assert symbol["properties"]["disposition"] == "review"
    nested = next(
        x for x in r["features"] if x["properties"].get("parentId") == symbol["id"]
    )
    assert nested["properties"]["layer"] == "PIPE_DN100_HDPE"
    assert nested["properties"]["blockName"] == "ValveSymbol"
    assert nested["properties"]["isBlockGeometry"] is True
    assert nested["properties"]["disposition"] == "reference"
    assert nested["geometry"]["coordinates"][1] == [500050, 2320002]
    assert any(
        len(x["geometry"]["coordinates"]) > 3
        for x in r["features"]
        if x["geometry"]["type"] == "LineString"
    )
    assert r["blocks"] == [
        {
            "fileId": "one",
            "name": "ValveSymbol",
            "count": 1,
            "isXref": False,
            "sampleFeatureIds": [symbol["id"]],
            "suggestedAction": "review",
        }
    ]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_xrefs_are_reported_not_loaded(tmp_path):
    doc = ezdxf.new()
    doc.add_xref_def(filename="private.dwg", name="missing")
    doc.modelspace().add_blockref("missing", (0, 0))
    path = tmp_path / "xref.dxf"
    doc.saveas(path)
    r = read_document({"id": "one", "name": path.name}, path, tmp_path / "out")
    assert len(r["features"]) == 1 and any(
        x["code"] == "MISSING_XREF" for x in r["issues"]
    )
    assert r["features"][0]["properties"]["isXref"] is True
    assert r["features"][0]["properties"]["disposition"] == "reference"
    assert r["blocks"][0]["suggestedAction"] == "reference"


def test_curve_flattening_stops_at_vertex_budget_without_materializing_all_points(
    tmp_path, monkeypatch
):
    doc = ezdxf.new()
    doc.modelspace().add_circle((0, 0), 100)
    path = tmp_path / "large-curve.dxf"
    doc.saveas(path)
    monkeypatch.setattr(cad, "MAX_VERTICES", 3)
    with pytest.raises(ValueError, match="giới hạn số đỉnh"):
        read_document({"id": "one", "name": path.name}, path, tmp_path / "out")


def test_array_insert_is_rejected_before_multi_insert_iteration(tmp_path, monkeypatch):
    doc = ezdxf.new()
    block = doc.blocks.new("marker")
    block.add_point((0, 0))
    doc.modelspace().add_blockref(
        "marker",
        (0, 0),
        dxfattribs={
            "row_count": 2,
            "column_count": 2,
            "row_spacing": 1,
            "column_spacing": 1,
        },
    )
    path = tmp_path / "array.dxf"
    doc.saveas(path)
    monkeypatch.setattr(cad, "MAX_FEATURES", 3)

    def unexpected_iteration(_self):
        raise AssertionError("multi_insert() must not be entered past the resource cap")

    monkeypatch.setattr(ezdxf.entities.Insert, "multi_insert", unexpected_iteration)
    with pytest.raises(ValueError, match="giới hạn số đối tượng"):
        read_document({"id": "one", "name": path.name}, path, tmp_path / "out")
