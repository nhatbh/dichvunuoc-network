"""The importer proposes the source CRS from the drawing only (decision 0032)."""
import ezdxf

from wn_import.cad import read_document
from wn_import.crs_detect import decode_tcvn3, suggest_crs

# Vĩnh Thịnh, Vĩnh Tường, Vĩnh Phúc - geometry extents of "1.MB-PP-Vinh Thinh - Dot 3".
VINH_THINH = [549412.8, 2340860.2, 552486.3, 2344742.3]


def test_tcvn3_title_block_strings_decode():
    assert decode_tcvn3("giai ®o¹n më réng m¹ng l­íi _ khu vùc huyÖn vÜnh t­êng") == (
        "giai đoạn mở rộng mạng lưới _ khu vực huyện vĩnh tường"
    )
    assert decode_tcvn3("tuyÕn èng n­íc s¹ch - x· vÜnh thÞnh") == "tuyến ống nước sạch - xã vĩnh thịnh"


def test_province_in_title_block_selects_its_tm3_meridian():
    texts = [
        "DỰ ÁN : NHÀ MÁY NƯỚC SẠCH SÔNG HỒNG CẤP CHO KHU VỰC PHÍA NAM TỈNH VĨNH PHÚC",
        "%%Uh¹ng môc%%U: tuyÕn èng n­íc s¹ch - x· vÜnh thÞnh",
        "KT105", "D50, L=106m",  # chamber labels and lengths are not meridians
    ]
    result = suggest_crs(texts, VINH_THINH)
    assert result["status"] == "detected"
    assert result["crs"] == "EPSG:5897"
    assert result["presetId"] == "tt26-2024-vinh-phuc:TM3"
    assert (result["units"], result["axisOrder"]) == ("m", "xy")
    lon, lat = result["candidates"][0]["center"]
    assert 105.4 < lon < 105.6 and 21.1 < lat < 21.25
    assert any("TỈNH VĨNH PHÚC" in e["text"] for e in result["evidence"])


def test_consultant_address_elsewhere_does_not_win():
    # Hà Nội (KTT 105) named many times as the consultant's address; the drawing lies in Quảng Ninh.
    texts = ["Công ty tư vấn, Thanh Xuân, Hà Nội"] * 5 + ["CÔNG TRÌNH: CẤP NƯỚC TỈNH QUẢNG NINH"]
    result = suggest_crs(texts, [440000, 2315000, 441000, 2316000])  # Hạ Long, TM-3 107°45'
    assert result["crs"] == "EPSG:5899"
    assert result["presetId"] == "tt26-2024-quang-ninh:TM3"
    assert result["status"] == "detected"
    hanoi = next(c for c in result["candidates"] if c["label"] == "TP. Hà Nội")
    assert hanoi["distanceKm"] > 100  # Hà Nội's meridian puts the drawing far from Hà Nội


def test_declared_meridian_wins_and_is_quoted():
    texts = ["Hệ tọa độ VN-2000, kinh tuyến trục 105°30', múi chiếu 3°"]
    result = suggest_crs(texts, [500000, 2330000, 501000, 2331000])
    assert (result["status"], result["crs"]) == ("detected", "EPSG:9209")
    assert result["confidence"] == "high"
    assert any("kinh tuyến trục" in e["text"] for e in result["evidence"])


def test_declared_utm_zone():
    result = suggest_crs(["HỆ TỌA ĐỘ VN-2000 UTM 48, MÚI CHIẾU 6°"], [580000, 2330000, 581000, 2331000])
    assert result["crs"] == "EPSG:3405"


def test_declared_meridian_against_a_different_province_is_ambiguous():
    texts = ["KTT 107°45'", "TỈNH VĨNH PHÚC"]
    result = suggest_crs(texts, VINH_THINH)
    assert result["status"] == "ambiguous"
    assert any(c["code"] == "LOCALITY_DISAGREES" for c in result["checks"])


def test_millimetres_and_swapped_axes():
    mm = suggest_crs(["TỈNH VĨNH PHÚC"], [v * 1000 for v in VINH_THINH])
    assert (mm["units"], mm["crs"]) == ("mm", "EPSG:5897")
    yx = suggest_crs(["TỈNH VĨNH PHÚC"], [2340860.2, 549412.8, 2344742.3, 552486.3])
    assert (yx["axisOrder"], yx["crs"]) == ("yx", "EPSG:5897")


def test_local_coordinates_and_no_evidence_stay_unknown():
    local = suggest_crs(["TỈNH VĨNH PHÚC"], [0, 0, 1200, 800])
    assert local["status"] == "unknown" and local["crs"] is None
    assert local["checks"][0]["code"] == "LOCAL_COORDINATES"
    silent = suggest_crs(["D100 HDPE"], VINH_THINH)
    assert silent["status"] == "unknown" and silent["crs"] is None
    assert silent["evidence"][0]["kind"] == "extents"


def test_tied_provinces_on_different_meridians_are_ambiguous():
    # Hà Nội (105) and Hưng Yên (105.5) both near the drawing, named equally.
    result = suggest_crs(["TỈNH HƯNG YÊN", "TP HÀ NỘI"], [560000, 2310000, 561000, 2311000])
    assert result["status"] == "ambiguous"


def test_read_document_carries_the_suggestion(tmp_path):
    doc = ezdxf.new("R2018")
    model = doc.modelspace()
    model.add_line((550000, 2342000), (550100, 2342000), dxfattribs={"layer": "PIPE"})
    layout = doc.layouts.new("Khung in")
    layout.add_text("CẤP NƯỚC XÃ VĨNH THỊNH, TỈNH VĨNH PHÚC")  # title block in a layout
    path = tmp_path / "f.dxf"
    doc.saveas(path)
    document = read_document({"id": "f1", "name": "f.dxf", "format": "dxf"}, path, tmp_path)
    suggestion = document["file"]["crsSuggestion"]
    assert suggestion["crs"] == "EPSG:5897"
    assert suggestion["presetId"] == "tt26-2024-vinh-phuc:TM3"


def test_footprint_places_the_drawing_for_the_map_preview():
    result = suggest_crs(["TỈNH VĨNH PHÚC"], VINH_THINH)
    ring = result["footprint"]
    assert len(ring) == 5 and ring[0] == ring[-1]
    assert all(105.4 < lon < 105.6 and 21.1 < lat < 21.25 for lon, lat in ring)
    assert suggest_crs(["D100"], [0, 0, 10, 10])["footprint"] is None
