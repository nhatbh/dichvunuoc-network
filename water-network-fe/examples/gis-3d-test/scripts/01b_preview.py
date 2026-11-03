"""Bước 1b: vẽ bản đồ xem trước các layer ống + block chính."""
import sys, ezdxf, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
doc = ezdxf.readfile(sys.argv[1]); msp = doc.modelspace(); out = sys.argv[2]
def P(e):
    t=e.dxftype()
    if t=="LWPOLYLINE": p=[(q[0],q[1]) for q in e.get_points("xy")]; return p+[p[0]] if e.closed else p
    if t=="POLYLINE": return [(v.dxf.location.x,v.dxf.location.y) for v in e.vertices]
    if t=="LINE": return [(e.dxf.start.x,e.dxf.start.y),(e.dxf.end.x,e.dxf.end.y)]
style={"315":("#08306b",3.2),"225":("#2171b5",2.6),"160":("#6a51a3",2.2),"110":("#238b45",1.9),"90":("#d94801",1.6),"63":("#e7298a",0.9),"50":("#737373",0.6)}
fig,ax=plt.subplots(figsize=(14,16),dpi=110)
for e in msp.query('LWPOLYLINE[layer=="DEFPOINTS"]'):
    p=P(e); ax.plot(*zip(*p),color="#cccccc",lw=0.6,ls="--",zorder=0)
for e in msp.query('TEXT[layer=="DEFPOINTS"]'):
    ax.text(e.dxf.insert.x,e.dxf.insert.y,"Tờ "+e.dxf.text,color="#aaaaaa",fontsize=7)
for lay in ["50","63","90","110","160","225","315"]:
    c,w=style[lay]; first=True
    for e in msp.query(f'LWPOLYLINE POLYLINE LINE[layer=="{lay}"]'):
        p=P(e); zig = e.dxf.linetype=="ZIGZAG"
        ax.plot(*zip(*p),color=("#ff00ff" if zig else c),lw=w,ls=(":" if zig else "-"),label=(f"Layer {lay}" if first else None),zorder=int(lay)/10)
        first=False
mk={"Daudai":("o","#e31a1c",10,"Daudai (đai khởi thủy) — 180"),"bit":("s","#000000",4,"bit (bịt đầu) — 400"),"con":("^","#ff7f00",14,"con (côn) — 20")}
for n,(m,c,s,lab) in mk.items():
    xy=[(e.dxf.insert.x,e.dxf.insert.y) for e in msp.query(f'INSERT[name=="{n}"]')]
    ax.scatter(*zip(*xy),marker=m,c=c,s=s,label=lab,zorder=20)
ax.set_aspect("equal"); ax.legend(loc="lower left",fontsize=9); ax.grid(alpha=.2)
ax.set_title("Xem trước bản vẽ: MB ống dịch vụ Vĩnh Thịnh (tọa độ bản vẽ, m)\nĐường chấm tím = đối tượng linetype ZIGZAG trên layer 63")
ax.ticklabel_format(useOffset=False,style="plain")
plt.tight_layout(); plt.savefig(out); print("saved",out)
