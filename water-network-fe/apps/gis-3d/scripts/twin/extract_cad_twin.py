"""
Builds src/pages/twin/data/cad-twin.json — the CAD-derived data of the integrated 3D map ("Bản đồ số 3D").

Inputs are DXF conversions of the project drawings (LibreDWG `dwg2dxf`, see README.md next to this file):

  site    "1. QH Tổng Mặt bằng Dinh vi Nha May.dwg"   Sông Hồng clean-water plant (29,000 m³/ngđ), site plan
          with its own coordinate table and the Xref "Xr.Binh do" (VN-2000 survey) → exact geo-reference
  intake  "Xref Nen toa do.dwg"                        survey around the river intake (block CTT)
  service "2. MB Ong Dich vu- Vinh Thinh 123.dwg"      service pipes D50/D63 and meter clusters (kt1…)
  network scripts/local-stack/networks/vinh-thinh-dot3.drafts.json (the CAD import of "1.MB-PP-Vinh Thinh - Dot 3.dwg")

Run (Python ≥ 3.10 with ezdxf + pyproj):
  python scripts/twin/extract_cad_twin.py --site <site.dxf> --intake <intake.dxf> --service <service.dxf>

Everything not in the drawings (heights, process pipe routes, raw/treated transmission-main routes, equipment
counts per building) is added by the app and marked `assumed` there; this script only emits what the drawings hold.
"""
import argparse, json, math, os, re, sys
from pathlib import Path

import ezdxf
from ezdxf import recover
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
OUT = APP / 'src/pages/twin/data/cad-twin.json'
NETWORK = APP / 'scripts/local-stack/networks/vinh-thinh-dot3.drafts.json'

# VN-2000, central meridian 105°00' (Vĩnh Phúc), 7-parameter shift to WGS84 (same as the CAD import service)
VN2000_VP = ('+proj=tmerc +lat_0=0 +lon_0=105 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 '
             '+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 '
             '+units=m +no_defs')
TO_WGS = Transformer.from_crs(VN2000_VP, 'EPSG:4326', always_xy=True)


def lonlat(e, n):
    lon, lat = TO_WGS.transform(e, n)
    return [round(lon, 7), round(lat, 7)]


# ── site plan: structures by their drawn outline (drawing frame, mm). Names come from the legend ("ghi chú"). ──
# `match` is the outline's bbox in the drawing; the script checks the drawing holds a polyline with that bbox.
STRUCTURES = [
    # id, legend no, name, kind, bbox (mm) or None (polygon given), match layer
    ('S03', 3, 'Trạm bơm chuyển tiếp', 'transfer_ps', (2349319, 437232, 2358619, 452132)),
    ('S04', 4, 'Cụm bể tiếp nhận, trộn, phản ứng, lắng lamella', 'clarifier', (2316919, 449179, 2337319, 488029)),
    ('S05', 5, 'Cụm bể lọc', 'filters', (2313919, 488029, 2340319, 508429)),
    ('S06', 6, 'Bể chứa nước sạch 10.000 m³', 'reservoir', (2299319, 511429, 2339319, 558229)),
    ('S07', 7, 'Trạm bơm nước sạch và rửa lọc', 'clean_ps', (2259219, 562229, 2299216, 572229)),
    ('S07B', 7, 'Gian bơm rửa lọc & máy gió', 'backwash_ps', (2302439, 562229, 2327439, 572229)),
    ('S08', 8, 'Nhà hóa chất (PAC và polymer)', 'chemical', (2278939, 424462, 2292139, 433682)),
    ('S09', 9, 'Nhà clo (clo hóa sơ bộ + khử trùng)', 'chlorine', (2262219, 424462, 2278939, 433682)),
    ('S10', 10, 'Bể thu hồi nước xả lắng và xả rửa lọc', 'recovery', (2295439, 424462, 2316339, 433682)),
    ('S10B', 10, 'Bể nén bùn', 'sludge', (2319599, 424462, 2336319, 433682)),
    ('S11', 11, 'Trạm điện', 'substation', (2259239, 584729, 2279439, 593929)),
    ('S12', 12, 'Nhà điều hành', 'admin', (2342400, 551600, 2362200, 571800)),
    ('S14', 14, 'Khu vực để xe', 'parking', (2327439, 566029, 2339439, 572029)),
]
# sub-parts of the treatment train, read from the same drawing (cells, tanks, channels)
PARTS = {
    'S04': {
        'mixing': (2325619, 450479, 2328619, 453479),
        'floc': [(x0, y0, x1, y1)
                 for (y0, y1) in [(453879, 457879), (458129, 462129), (462379, 466379)]
                 for (x0, x1) in [(2318319, 2322469), (2322769, 2326919), (2327319, 2331469), (2331769, 2335919)]],
        'lamella': [(2318319, 466629, 2326919, 486629), (2327319, 466629, 2335919, 486629)],
        'channel': (2318319, 487029, 2335919, 487829),
    },
    'S05': {
        'cells': [(2315269, 491329, 2318669, 502479), (2319569, 491329, 2326669, 502479),
                  (2327569, 491329, 2334669, 502479), (2335569, 491329, 2338969, 502479)],
        'gallery': (2315219, 502779, 2339019, 507179),
        'inlet': (2315269, 489229, 2338969, 490229),
    },
}
# raw-water pond (hồ chứa nước thô – sơ lắng): traced along the drawn banks (layers CONGTRINH / DUONGBAO)
POND = [(2257017, 378699), (2333804, 378699), (2333804, 397999), (2349886, 397999), (2469060, 541023),
        (2470330, 544550), (2468915, 548868), (2465386, 552376), (2462633, 553769), (2411102, 561820),
        (2401692, 558272), (2354981, 502213), (2352617, 495684), (2352617, 452128), (2347172, 422861),
        (2345436, 420777), (2337370, 416999), (2262017, 416998), (2257017, 411998)]
INLET_OUTFALL = (2329000, 384500)  # legend 1 — cửa xả cấp nước thô
GUARD = [(2473545, 555409), (2469593, 556026), (2468775, 550790), (2472727, 550172)]  # legend 13
GATE = [(2474857, 563811), (2471279, 544127)]  # the two gate posts (layer text)
FOUNTAIN = [(2379676, 567959), (2386088, 567959), (2389545, 560579), (2384546, 554579), (2381088, 552959),
            (2379676, 552959), (2375176, 557459), (2375176, 563459)]


def bbox_of(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def site(path):
    doc, _ = recover.readfile(path)
    msp = doc.modelspace()
    ins = next(e for e in msp if e.dxftype() == 'INSERT' and e.dxf.name == 'Xr.Binh do')
    I = ins.dxf.insert; s = ins.dxf.xscale; th = math.radians(ins.dxf.rotation)

    def real(x, y):  # drawing mm → VN-2000 E, N
        dx = (x - I[0]) / s; dy = (y - I[1]) / s
        return dx * math.cos(th) + dy * math.sin(th), -dx * math.sin(th) + dy * math.cos(th)

    # every closed outline in the drawing (blocks exploded) to check the table against
    outlines = []
    def walk(es, d=0):
        for e in es:
            if e.dxftype() == 'INSERT' and d < 4 and not e.dxf.name.startswith('Xr'):
                try:
                    yield from walk(list(e.virtual_entities()), d + 1)
                except Exception:
                    pass
            else:
                yield e
    trees, boundary, roads = [], None, []
    for e in walk(msp):
        t = e.dxftype()
        if t == 'LWPOLYLINE':
            pts = [(p[0], p[1]) for p in e.get_points('xy')]
            outlines.append(bbox_of(pts))
            if e.dxf.layer == 'tim 1' and boundary is None and min(p[0] for p in pts) > 0:
                boundary = pts
            if e.dxf.layer == 'DUONGBAO' and len(pts) >= 2:
                roads.append(pts)
    for e in msp:
        if e.dxftype() == 'INSERT' and e.dxf.name == 'CAYMB179':
            trees.append((e.dxf.insert[0], e.dxf.insert[1]))

    def matched(b):
        return any(all(abs(a - c) < 400 for a, c in zip(b, o)) for o in outlines)

    # plant origin = centre of the site boundary (drawing frame); local frame in metres, x/y along the drawing axes
    bx0, by0, bx1, by1 = bbox_of(boundary)
    ox, oy = (bx0 + bx1) / 2, (by0 + by1) / 2
    loc = lambda x, y: [round((x - ox) / 1000, 2), round((y - oy) / 1000, 2)]
    rect = lambda b: [loc(b[0], b[1]), loc(b[2], b[1]), loc(b[2], b[3]), loc(b[0], b[3])]

    e0, n0 = real(ox, oy)
    e1, n1 = real(ox + 100000, oy)  # 100 m along the drawing x axis
    origin = lonlat(e0, n0)
    ll1 = lonlat(e1, n1)
    # bearing of the drawing x axis on the map (radians, counter-clockwise from east), from the geo points
    ky = 110_574.0; kx = 111_320.0 * math.cos(math.radians(origin[1]))
    x_axis = math.atan2((ll1[1] - origin[1]) * ky, (ll1[0] - origin[0]) * kx)

    structures = []
    for sid, no, name, kind, b in STRUCTURES:
        structures.append({'id': sid, 'no': no, 'name': name, 'kind': kind, 'poly': rect(b),
                           'fromDrawing': matched(b)})
    structures.append({'id': 'S13', 'no': 13, 'name': 'Nhà bảo vệ', 'kind': 'guard',
                       'poly': [loc(*p) for p in GUARD], 'fromDrawing': True})
    structures.append({'id': 'S02', 'no': 2, 'name': 'Hồ chứa nước thô (sơ lắng)', 'kind': 'pond',
                       'poly': [loc(*p) for p in POND], 'fromDrawing': True})
    parts = {}
    for sid, d in PARTS.items():
        parts[sid] = {k: ([rect(b) for b in v] if isinstance(v, list) else rect(v)) for k, v in d.items()}

    return {
        'name': 'Nhà máy nước sạch Sông Hồng',
        'capacity': '29.000 m³/ngđ',
        'source': '1. QH Tổng Mặt bằng Dinh vi Nha May.dwg (Xref Xr.Binh do, VN-2000 KT 105°)',
        'origin': origin,
        'xAxisRad': round(x_axis, 6),
        'boundary': [loc(*p) for p in boundary],
        'boundaryLonLat': [lonlat(*real(*p)) for p in boundary],
        'structures': structures,
        'parts': parts,
        'inletOutfall': loc(*INLET_OUTFALL),
        'gate': [loc(*p) for p in GATE],
        'fountain': [loc(*p) for p in FOUNTAIN],
        'roads': [[loc(*p) for p in r] for r in roads if len(r) >= 2 and max(abs(p[0]) for p in r) < 3e7],
        'trees': [loc(*p) for p in trees],
    }


def intake(path):
    doc, _ = recover.readfile(path)
    msp = doc.modelspace()
    ctt = next(e for e in msp if e.dxftype() == 'INSERT' and e.dxf.name == 'CTT')
    e, n = ctt.dxf.insert[0], ctt.dxf.insert[1]
    water = []
    for x in msp:
        if x.dxftype() == 'LWPOLYLINE' and x.dxf.layer == 'duongmepnuoc':
            water.append([lonlat(p[0], p[1]) for p in x.get_points('xy')])
    return {
        'name': 'Công trình thu & trạm bơm nước thô (TB1)',
        'source': 'Xref Nen toa do.dwg (block CTT), 00- Tram bom 1 - Sheet A',
        'origin': lonlat(e, n),
        'rotationDeg': round(ctt.dxf.rotation, 3),
        'waterEdge': water,
    }


def service(path):
    doc, _ = recover.readfile(path)
    msp = doc.modelspace()
    lines, meters = [], []
    for e in msp:
        lay = e.dxf.layer
        if lay in ('50', '63') and e.dxftype() in ('LWPOLYLINE', 'POLYLINE'):
            pts = [(p[0], p[1]) for p in (e.get_points('xy') if e.dxftype() == 'LWPOLYLINE' else e.points())]
            if len(pts) >= 2:
                lines.append({'dn': int(lay), 'path': [lonlat(*p) for p in pts]})
        elif lay == 'ten dai khoi thuy' and e.dxftype() == 'INSERT':
            meters.append(lonlat(e.dxf.insert[0], e.dxf.insert[1]))
    return {'source': '2. MB Ong Dich vu- Vinh Thinh 123.dwg (layers 50, 63, ten dai khoi thuy)',
            'lines': lines, 'meterClusters': meters}


def network(path):
    d = json.loads(Path(path).read_text(encoding='utf8'))
    pt = lambda c: c[0] if isinstance(c[0], list) else c
    pipes, valves, fittings = [], [], []
    for a in d['assets']:
        at = a['attributes']
        if a['kind'] == 'Pipe':
            pipes.append({'id': a['clientRef'], 'dn': int(at.get('diameterMm') or 110), 'mat': at.get('material', 'HDPE'),
                          'len': round(float(at.get('lengthM') or 0), 1), 'from': a['fromRef'], 'to': a['toRef'],
                          'path': [[round(c[0], 7), round(c[1], 7)] for c in a['geometry']['coordinates']]})
        elif a['kind'] == 'Device':
            valves.append({'id': a['assetCode'], 'pipe': a['hostRef'], 'dn': int(at.get('dn') or 110),
                           'at': [round(v, 7) for v in pt(a['geometry']['coordinates'])]})
        elif a['kind'] == 'Node':
            fittings.append({'id': a['clientRef'], 'kind': at.get('componentCode') or 'Junction',
                             'at': [round(v, 7) for v in pt(a['geometry']['coordinates'])]})
    return {'source': '1.MB-PP-Vinh Thinh - Dot 3.dwg (CAD import, vinh-thinh-dot3.review.json)',
            'pipes': pipes, 'valves': valves, 'fittings': fittings}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', required=True)
    ap.add_argument('--intake', required=True)
    ap.add_argument('--service', required=True)
    a = ap.parse_args()
    out = {
        'crs': 'VN-2000 / KT 105°00′ (Vĩnh Phúc) → WGS84',
        'plant': site(a.site),
        'intake': intake(a.intake),
        'network': network(NETWORK),
        'service': service(a.service),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    p = out['plant']
    print('plant origin', p['origin'], 'x-axis', round(math.degrees(p['xAxisRad']), 3), '°',
          'structures', len(p['structures']), 'unmatched', [s['id'] for s in p['structures'] if not s['fromDrawing']],
          'trees', len(p['trees']), 'roads', len(p['roads']))
    print('intake', out['intake']['origin'], 'network pipes', len(out['network']['pipes']),
          'service lines', len(out['service']['lines']), 'meter clusters', len(out['service']['meterClusters']))
    print('wrote', OUT, OUT.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
