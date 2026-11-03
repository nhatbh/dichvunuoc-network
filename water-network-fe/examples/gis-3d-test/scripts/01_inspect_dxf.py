"""Bước 1: đọc & kiểm tra bản vẽ DXF — liệt kê layer, loại đối tượng, số lượng, phạm vi tọa độ."""
import sys, collections, json
import ezdxf
from ezdxf import recover

path = sys.argv[1]
try:
    doc = ezdxf.readfile(path)
    aud = None
except Exception:
    doc, aud = recover.readfile(path)
msp = doc.modelspace()
print("DXF version:", doc.dxfversion, "| $INSUNITS:", doc.header.get("$INSUNITS"))
print("Header EXTMIN/EXTMAX:", doc.header.get("$EXTMIN"), doc.header.get("$EXTMAX"))

by_layer = collections.defaultdict(collections.Counter)
bbox = collections.defaultdict(lambda: [1e18, 1e18, -1e18, -1e18])
zvals = collections.Counter()
def upd(layer, x, y, z=0.0):
    b = bbox[layer]; b[0]=min(b[0],x); b[1]=min(b[1],y); b[2]=max(b[2],x); b[3]=max(b[3],y)
    zvals[round(z, 2)] += 1
for e in msp:
    L = e.dxf.layer; t = e.dxftype(); by_layer[L][t] += 1
    try:
        if t == "LINE":
            for p in (e.dxf.start, e.dxf.end): upd(L, p.x, p.y, p.z)
        elif t == "LWPOLYLINE":
            for p in e.get_points("xy"): upd(L, p[0], p[1], e.dxf.elevation)
        elif t == "POLYLINE":
            for v in e.vertices: p=v.dxf.location; upd(L, p.x, p.y, p.z)
        elif t in ("INSERT", "TEXT", "MTEXT", "CIRCLE", "POINT"):
            p = e.dxf.insert if t != "CIRCLE" and t != "POINT" else (e.dxf.center if t=="CIRCLE" else e.dxf.location)
            upd(L, p.x, p.y, p.z)
    except Exception:
        pass

print("\n%-35s %8s  %s" % ("LAYER", "TOTAL", "ENTITY TYPES"))
for L in sorted(by_layer, key=lambda k: -sum(by_layer[k].values())):
    c = by_layer[L]; b = bbox.get(L)
    ext = "" if not b or b[0] > 1e17 else f"  X[{b[0]:.0f}..{b[2]:.0f}] Y[{b[1]:.0f}..{b[3]:.0f}]"
    print("%-35s %8d  %s%s" % (L[:35], sum(c.values()), dict(c), ext))
print("\nZ values (top 10):", zvals.most_common(10))

blocks = collections.Counter(e.dxf.name for e in msp.query("INSERT"))
print("\nBlock INSERT names:", blocks.most_common(40))
for name, _ in blocks.most_common(40):
    ins = next(iter(msp.query(f'INSERT[name=="{name}"]')))
    atts = [(a.dxf.tag, a.dxf.text) for a in ins.attribs]
    if atts: print("  attribs", name, atts[:8])
