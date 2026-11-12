"""Proposes a drawing's source CRS from the drawing itself (decision 0032).

Evidence, strongest first: an embedded GEODATA definition; a declared system in the
drawing's text ("VN-2000", "kinh tuyến trục 105°30'", "múi chiếu 3°/6°", "UTM 48"); a
province named in the text (TT 26/2024 Annex 01 meridians); the extents' magnitude
(projected metres, millimetres, swapped axes). The tenant and the file name are never
used. The result is a proposal the reviewer confirms or changes; it is never saved
into a job by itself.
"""
from __future__ import annotations

import math
import re
import unicodedata

from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError

CATALOG_VERSION = "tt26-2024-annex01-v1"

# TM-3 meridian -> EPSG (VN-2000 / TM-3), same table as the frontend catalogue.
EPSG_BY_MERIDIAN = {
    103: 9205, 104: 9206, 104.5: 9207, 104.75: 9208, 105: 5897, 105.5: 9209,
    105.75: 9210, 106: 9211, 106.25: 9212, 106.5: 9213, 107: 9214, 107.25: 9215,
    107.5: 9216, 107.75: 5899, 108: 5898, 108.25: 9217, 108.5: 9218,
}
UTM_EPSG = {48: 3405, 49: 3406}

# id, label, TM-3 meridian, (lon, lat) of the provincial capital - the capital only
# sanity-checks a match (a province named in the title block of a drawing that lies
# elsewhere, e.g. the consultant's address); it never selects the CRS.
LOCALITIES = [
    ("lai-chau", "Lai Châu", 103, (103.46, 22.40)),
    ("dien-bien", "Điện Biên", 103, (103.02, 21.39)),
    ("son-la", "Sơn La", 104, (103.91, 21.33)),
    ("kien-giang", "Kiên Giang", 104.5, (105.08, 10.01)),
    ("ca-mau", "Cà Mau", 104.5, (105.15, 9.18)),
    ("lao-cai", "Lào Cai", 104.75, (103.97, 22.49)),
    ("yen-bai", "Yên Bái", 104.75, (104.87, 21.72)),
    ("nghe-an", "Nghệ An", 104.75, (105.68, 18.67)),
    ("phu-tho", "Phú Thọ", 104.75, (105.40, 21.32)),
    ("an-giang", "An Giang", 104.75, (105.44, 10.38)),
    ("thanh-hoa", "Thanh Hoá", 105, (105.78, 19.81)),
    ("vinh-phuc", "Vĩnh Phúc", 105, (105.60, 21.31)),
    ("dong-thap", "Đồng Tháp", 105, (105.63, 10.46)),
    ("can-tho", "TP. Cần Thơ", 105, (105.78, 10.03)),
    ("bac-lieu", "Bạc Liêu", 105, (105.72, 9.29)),
    ("hau-giang", "Hậu Giang", 105, (105.47, 9.78)),
    ("ha-noi", "TP. Hà Nội", 105, (105.85, 21.03)),
    ("ninh-binh", "Ninh Bình", 105, (105.97, 20.25)),
    ("ha-nam", "Hà Nam", 105, (105.91, 20.54)),
    ("ha-giang", "Hà Giang", 105.5, (104.98, 22.82)),
    ("hai-duong", "Hải Dương", 105.5, (106.33, 20.94)),
    ("ha-tinh", "Hà Tĩnh", 105.5, (105.90, 18.34)),
    ("bac-ninh", "Bắc Ninh", 105.5, (106.07, 21.19)),
    ("hung-yen", "Hưng Yên", 105.5, (106.05, 20.65)),
    ("thai-binh", "Thái Bình", 105.5, (106.34, 20.45)),
    ("nam-dinh", "Nam Định", 105.5, (106.17, 20.42)),
    ("tay-ninh", "Tây Ninh", 105.5, (106.10, 11.31)),
    ("vinh-long", "Vĩnh Long", 105.5, (105.97, 10.25)),
    ("soc-trang", "Sóc Trăng", 105.5, (105.97, 9.60)),
    ("tra-vinh", "Trà Vinh", 105.5, (106.34, 9.93)),
    ("cao-bang", "Cao Bằng", 105.75, (106.26, 22.67)),
    ("long-an", "Long An", 105.75, (106.41, 10.54)),
    ("tien-giang", "Tiền Giang", 105.75, (106.36, 10.36)),
    ("ben-tre", "Bến Tre", 105.75, (106.38, 10.24)),
    ("hai-phong", "TP. Hải Phòng", 105.75, (106.68, 20.86)),
    ("ho-chi-minh", "TP. Hồ Chí Minh", 105.75, (106.70, 10.78)),
    ("binh-duong", "Bình Dương", 105.75, (106.65, 10.98)),
    ("tuyen-quang", "Tuyên Quang", 106, (105.21, 21.82)),
    ("hoa-binh", "Hoà Bình", 106, (105.34, 20.82)),
    ("quang-binh", "Quảng Bình", 106, (106.62, 17.47)),
    ("quang-tri", "Quảng Trị", 106.25, (107.10, 16.82)),
    ("binh-phuoc", "Bình Phước", 106.25, (106.90, 11.54)),
    ("bac-kan", "Bắc Kạn", 106.5, (105.83, 22.15)),
    ("thai-nguyen", "Thái Nguyên", 106.5, (105.84, 21.59)),
    ("bac-giang", "Bắc Giang", 107, (106.19, 21.27)),
    ("thua-thien-hue", "Thừa Thiên - Huế", 107, (107.59, 16.46)),
    ("lang-son", "Lạng Sơn", 107.25, (106.76, 21.85)),
    ("kon-tum", "Kon Tum", 107.5, (108.00, 14.35)),
    ("quang-ninh", "Quảng Ninh", 107.75, (107.08, 20.95)),
    ("dong-nai", "Đồng Nai", 107.75, (106.82, 10.95)),
    ("ba-ria-vung-tau", "Bà Rịa - Vũng Tàu", 107.75, (107.17, 10.50)),
    ("quang-nam", "Quảng Nam", 107.75, (108.47, 15.57)),
    ("lam-dong", "Lâm Đồng", 107.75, (108.44, 11.94)),
    ("da-nang", "TP. Đà Nẵng", 107.75, (108.21, 16.05)),
    ("quang-ngai", "Quảng Ngãi", 108, (108.80, 15.12)),
    ("ninh-thuan", "Ninh Thuận", 108.25, (108.99, 11.56)),
    ("khanh-hoa", "Khánh Hoà", 108.25, (109.19, 12.24)),
    ("binh-dinh", "Bình Định", 108.25, (109.22, 13.78)),
    ("dak-lak", "Đắk Lắk", 108.5, (108.04, 12.67)),
    ("dak-nong", "Đắk Nông", 108.5, (107.69, 12.00)),
    ("phu-yen", "Phú Yên", 108.5, (109.30, 13.09)),
    ("gia-lai", "Gia Lai", 108.5, (108.00, 13.98)),
    ("binh-thuan", "Bình Thuận", 108.5, (108.10, 10.93)),
]
EXTRA_NAMES = {
    "ha-noi": ["HA NOI"],
    "ho-chi-minh": ["HO CHI MINH", "TP HCM", "TPHCM"],
    "can-tho": ["CAN THO"],
    "hai-phong": ["HAI PHONG"],
    "da-nang": ["DA NANG"],
    "thua-thien-hue": ["THUA THIEN HUE", "THUA THIEN"],
    "ba-ria-vung-tau": ["BA RIA VUNG TAU", "VUNG TAU"],
}
CAPITAL_TOLERANCE_KM = 150
NEAR_KM = 60
VIETNAM = (102.1, 8.2, 109.6, 23.45)

# TCVN3 (ABC) single-byte Vietnamese, as decoded through the drawing's ANSI codepage.
_TCVN3 = dict(zip(
    [0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE,
     0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBB, 0xBC, 0xBD, 0xBE, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB,
     0xCC, 0xCE, 0xCF, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xDC, 0xDD, 0xDE,
     0xDF, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE,
     0xEF, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE],
    "ĂÂÊÔƠƯĐăâêôơưđàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ",
))


def decode_tcvn3(text: str) -> str:
    out = []
    for ch in text:
        try:
            byte = ch.encode("cp1252")
        except UnicodeEncodeError:
            out.append(ch)
            continue
        out.append(_TCVN3.get(byte[0], ch) if len(byte) == 1 else ch)
    return "".join(out)


_VIETNAMESE_LATIN1 = set("àáâãèéêìíòóôõùúýÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝ")


def _garbled(text: str) -> int:
    """Legacy-font characters left in a text (Latin-1 symbols that are not Vietnamese letters)."""
    return sum(1 for c in text if "\xa1" <= c <= "\xff" and c not in _VIETNAMESE_LATIN1)


def fold(text: str) -> str:
    text = text.upper().replace("Đ", "D").replace("đ", "D")
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9°'\".,]+", " ", text).strip()


def readable(text: str) -> list[str]:
    """The text as written, and as TCVN3 when it carries legacy-font characters."""
    text = re.sub(r"%%[UuOoDdPpCc]", "", text or "").strip()
    variants = [text]
    decoded = decode_tcvn3(text)
    if decoded != text:
        variants.append(decoded)
    return variants


_MERIDIAN = re.compile(
    r"(?:KINH TUYEN TRUC|KTT|KINH TUYEN GOC|CENTRAL MERIDIAN|LON 0)\s*[:=]?\s*"
    r"(\d{3})\s*(?:°|DO|D|O)?\s*(?:(\d{1,2})\s*(?:'|PHUT|P)?)?"
)
_ZONE = re.compile(r"MUI CHIEU\s*(3|6)\s*(?:°|DO|O)?")
_UTM = re.compile(r"\bUTM\b\s*(?:ZONE\s*)?(48|49)")
_VN2000 = re.compile(r"\bVN\s*2000\b")
_EPSG = re.compile(r"\bEPSG\s*[: ]\s*(\d{4,5})\b")


def _declared(texts):
    found = {}
    for raw in texts:
        for variant in readable(raw):
            f = fold(variant)
            if not f:
                continue
            if (m := _EPSG.search(f)):
                found.setdefault("epsg", (int(m.group(1)), variant))
            if (m := _MERIDIAN.search(f)):
                degrees, minutes = int(m.group(1)), int(m.group(2) or 0)
                if 102 <= degrees <= 112 and minutes in (0, 15, 30, 45):
                    found.setdefault("meridian", (degrees + minutes / 60, variant))
            if (m := _ZONE.search(f)):
                found.setdefault("zone", (int(m.group(1)), variant))
            if (m := _UTM.search(f)):
                found.setdefault("utm", (int(m.group(1)), variant))
            if _VN2000.search(f):
                found.setdefault("vn2000", (True, variant))
    return found


def _localities(texts):
    names = {
        lid: [fold(label.replace("TP. ", ""))] + EXTRA_NAMES.get(lid, [])
        for lid, label, _, _ in LOCALITIES
    }
    patterns = {
        lid: re.compile(r"\b(TINH|TP|THANH PHO)?\s*(" + "|".join(map(re.escape, keys)) + r")\b")
        for lid, keys in names.items()
    }
    scores, quotes = {}, {}
    for raw in texts:
        best = {}  # one text counts once per province, in its best-reading variant
        for variant in readable(raw):
            f = fold(variant)
            for lid, pattern in patterns.items():
                hits = [3 if m.group(1) else 1 for m in pattern.finditer(f)]
                if hits and sum(hits) > best.get(lid, (0,))[0]:
                    best[lid] = (sum(hits), max(hits), variant)
        for lid, (score, strongest, variant) in best.items():
            scores[lid] = scores.get(lid, 0) + score
            # quote the clearest mention: "TỈNH …" over a bare name, the best-decoded reading
            rank = (strongest, -_garbled(variant))
            if lid not in quotes or rank > quotes[lid][0]:
                quotes[lid] = (rank, " ".join(variant.split())[:160])
    quotes = {lid: quote for lid, (_, quote) in quotes.items()}
    return scores, quotes


def classify_extents(bounds):
    """'m' / 'mm' with axis order for projected VN metres, or None for local coordinates."""
    if not bounds:
        return None
    cx, cy = (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2
    for units, k in (("m", 1), ("mm", 1000)):
        for axis, (e, n) in (("xy", (cx, cy)), ("yx", (cy, cx))):
            if 150_000 * k <= e <= 850_000 * k and 900_000 * k <= n <= 2_650_000 * k:
                x0, y0, x1, y1 = (v / k for v in bounds)
                box = (x0, y0, x1, y1) if axis == "xy" else (y0, x0, y1, x1)
                return {"units": units, "axisOrder": axis, "center": (e / k, n / k), "box": box}
    return None


def _to_lonlat(epsg, easting, northing):
    t = Transformer.from_crs(CRS.from_epsg(epsg), CRS.from_epsg(4326), always_xy=True)
    return t.transform(easting, northing)


def footprint(epsg, box):
    """The drawing's extent as a lon/lat ring in the given CRS (for the map preview)."""
    t = Transformer.from_crs(CRS.from_epsg(epsg), CRS.from_epsg(4326), always_xy=True)
    x0, y0, x1, y1 = box
    return [[round(v, 7) for v in t.transform(x, y)] for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0))]


def _km(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(lat), (a[1] - b[1]) * 110.57)


def _in_vietnam(lonlat):
    return VIETNAM[0] <= lonlat[0] <= VIETNAM[2] and VIETNAM[1] <= lonlat[1] <= VIETNAM[3]


def suggest_crs(texts, bounds, geodata=()):
    """Return the proposal for one file; see the module docstring."""
    result = _suggest(texts, bounds, geodata)
    extents = classify_extents(bounds)
    if result["crs"] and extents:
        try:
            result["footprint"] = footprint(CRS.from_user_input(result["crs"]).to_epsg(), extents["box"])
        except (CRSError, TypeError):
            result["footprint"] = None
    return result


def _suggest(texts, bounds, geodata):
    evidence, checks = [], []
    extents = classify_extents(bounds)
    result = {
        "status": "unknown", "crs": None, "presetId": None, "units": "m", "axisOrder": "xy",
        "confidence": "none", "evidence": evidence, "candidates": [], "checks": checks,
        "catalogVersion": CATALOG_VERSION, "footprint": None,
    }

    for item in geodata or []:
        definition = (item or {}).get("coordinateSystemDefinition") or ""
        if not definition.strip():
            continue
        try:
            epsg = CRS.from_user_input(definition).to_epsg()
        except CRSError:
            epsg = None
        if epsg:
            evidence.append({"kind": "geodata", "text": f"GEODATA EPSG:{epsg}"})
            result.update(status="detected", crs=f"EPSG:{epsg}", confidence="high")
            if extents:
                result.update(units=extents["units"], axisOrder=extents["axisOrder"])
            return result

    if extents is None:
        checks.append({"code": "LOCAL_COORDINATES", "ok": False,
                       "message": "Tọa độ bản vẽ không nằm trong dải VN-2000 phẳng (mét); cần căn bằng điểm khống chế."})
        return result
    result.update(units=extents["units"], axisOrder=extents["axisOrder"])
    unit_text = "mét" if extents["units"] == "m" else "milimét"
    axis_text = "" if extents["axisOrder"] == "xy" else ", trục X/Y đảo"
    evidence.append({"kind": "extents",
                     "text": f"Tọa độ E {extents['center'][0]:,.0f} / N {extents['center'][1]:,.0f} — VN-2000 phẳng, {unit_text}{axis_text}"})
    center = extents["center"]

    declared = _declared(texts)
    scores, quotes = _localities(texts)

    def place(epsg):
        lonlat = _to_lonlat(epsg, *center)
        return lonlat, _in_vietnam(lonlat)

    candidates = []
    for lid, label, meridian, capital in LOCALITIES:
        if lid not in scores:
            continue
        epsg = EPSG_BY_MERIDIAN[meridian]
        lonlat, inside = place(epsg)
        distance = _km(lonlat, capital)
        candidates.append({
            "presetId": f"tt26-2024-{lid}:TM3", "label": label, "crs": f"EPSG:{epsg}",
            "meridian": meridian, "score": scores[lid], "quote": quotes[lid],
            "distanceKm": round(distance), "consistent": inside and distance <= CAPITAL_TOLERANCE_KM,
            "center": [round(lonlat[0], 6), round(lonlat[1], 6)],
            "footprint": footprint(epsg, extents["box"]),
        })
    # A drawing usually lies near the capital of the province it names; the consultant's
    # address names another province, which places the drawing far from that capital.
    candidates.sort(key=lambda c: (not c["consistent"], c["distanceKm"] > NEAR_KM, -c["score"], c["distanceKm"]))
    result["candidates"] = candidates[:6]

    explicit = None
    if "epsg" in declared:
        explicit = (f"EPSG:{declared['epsg'][0]}", declared["epsg"][1], None)
    elif "utm" in declared or ("zone" in declared and declared["zone"][0] == 6):
        zone = declared["utm"][0] if "utm" in declared else (
            48 if declared.get("meridian", (105, ""))[0] < 108 else 49)
        quote = (declared.get("utm") or declared["zone"])[1]
        explicit = (f"EPSG:{UTM_EPSG[zone]}", quote, None)
    elif "meridian" in declared and declared["meridian"][0] in EPSG_BY_MERIDIAN:
        meridian = declared["meridian"][0]
        explicit = (f"EPSG:{EPSG_BY_MERIDIAN[meridian]}", declared["meridian"][1], meridian)
    if "vn2000" in declared:
        evidence.append({"kind": "declared", "text": declared["vn2000"][1].strip()[:160]})

    consistent = [c for c in candidates if c["consistent"]]
    if explicit:
        crs, quote, meridian = explicit
        evidence.append({"kind": "declared", "text": quote.strip()[:160]})
        lonlat, inside = place(int(crs.split(":")[1]))
        checks.append({"code": "IN_VIETNAM", "ok": inside,
                       "message": f"Vị trí quy đổi {lonlat[1]:.4f}, {lonlat[0]:.4f}"})
        match = next((c for c in consistent if c["crs"] == crs), None)
        result.update(crs=crs, presetId=match["presetId"] if match else None)
        if match:
            evidence.append({"kind": "locality", "text": match["quote"]})
        disagree = consistent and not match and meridian is not None
        if disagree:
            checks.append({"code": "LOCALITY_DISAGREES", "ok": False,
                           "message": f"Địa danh {consistent[0]['label']} dùng KTT {consistent[0]['meridian']}°, khác khai báo."})
        result.update(status="detected" if inside and not disagree else "ambiguous",
                      confidence="high" if inside and not disagree else "low")
        return result

    if not consistent:
        if candidates:
            checks.append({"code": "LOCALITY_FAR", "ok": False,
                           "message": "Địa danh tìm thấy không khớp vị trí bản vẽ."})
        return result
    top = consistent[0]
    near = top["distanceKm"] <= NEAR_KM
    tied = [c for c in consistent[1:] if c["crs"] != top["crs"]
            and (c["distanceKm"] <= NEAR_KM) == near and c["score"] * 2 >= top["score"]]
    evidence.append({"kind": "locality", "text": top["quote"]})
    checks.append({"code": "NEAR_LOCALITY", "ok": True,
                   "message": f"Cách trung tâm {top['label']} {top['distanceKm']} km"})
    result.update(crs=top["crs"], presetId=top["presetId"],
                  status="ambiguous" if tied else "detected",
                  confidence="low" if tied else "medium")
    return result
