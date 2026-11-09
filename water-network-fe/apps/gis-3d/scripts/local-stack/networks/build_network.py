"""Build a complete network dataset for the local stack from a CAD import.

Input: the draft assets the CAD import service produced for a reviewed drawing
(`draft-assets.json`, e.g. from `python -m wn_import.cli <dwg> --config <review> --output <dir>`).
Output: a network the seed (`seed.mjs --network <file>`) registers in gis-be, with every asset a
catalog component (decision 0028).

The drawing gives pipes (layer = OD mm), valves, bends and reducers. What a working network also
needs is completed by fixed, documented rules; every completed asset carries `"inferred": "<rule>"`
in the dataset (not in gis-be properties) and an asset code with the `-BS` (bổ sung) suffix:

  fittings   a node joining 3 pipes is a Tee (ReducingTee when the diameters differ), 4 is a Cross;
             2 pipes of different diameter meet at a Reducer, at a deflection >= 11.25 deg a Bend;
             a CAD symbol at the node wins unless the node is a branch (then Tee/Cross).
  supply     the dead end of the largest diameter (northernmost on ties) is the Source, with a
             BulkMeter on its first pipe and a PressureSensor on it (DMA inlet).
  dead ends  every other dead end is capped (Cap) with a Washout (xả cặn cuối tuyến).
  hydrants   on pipes DN >= 110 a hydrant tee at most every 150 m (TCVN 2622-1995 / QCVN 06):
             the pipe is split there and a Hydrant DN100 stands on the new Tee.
Air valves need elevations the drawing does not have, so none are added.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict

from pyproj import Geod, Transformer

GEOD = Geod(ellps="WGS84")
HYDRANT_SPACING_M = 150.0
HYDRANT_MIN_DN = 110
BEND_MIN_DEG = 11.25


def length_m(coords):
    return abs(GEOD.line_length([c[0] for c in coords], [c[1] for c in coords]))


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def build(drafts, name, dma, year, prefix):
    lon0 = sum(c[0] for a in drafts for c in a["geometry"]["coordinates"]) / sum(len(a["geometry"]["coordinates"]) for a in drafts)
    lat0 = sum(c[1] for a in drafts for c in a["geometry"]["coordinates"]) / sum(len(a["geometry"]["coordinates"]) for a in drafts)
    to_m = Transformer.from_crs(4326, f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m", always_xy=True)
    to_ll = Transformer.from_crs(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m", 4326, always_xy=True)

    nodes = {}  # ref -> {ref, lon, lat, code, cad, inferred}
    pipes = {}  # ref -> {ref, from, to, coords, dn, material, cad}
    devices = []  # {ref, code, host_pipe|host_node, lon, lat, inferred}
    for a in drafts:
        if a["kind"] == "Node":
            lon, lat = a["geometry"]["coordinates"][0]
            cad = a["attributes"].get("componentCode", "Junction")
            nodes[a["clientRef"]] = {"ref": a["clientRef"], "lon": lon, "lat": lat, "code": cad, "cad": cad != "Junction", "inferred": None}
        elif a["kind"] == "Pipe":
            pipes[a["clientRef"]] = {"ref": a["clientRef"], "from": a["fromRef"], "to": a["toRef"], "coords": a["geometry"]["coordinates"],
                                     "dn": int(a["attributes"]["diameterMm"]), "material": a["attributes"]["material"]}
    for a in drafts:
        if a["kind"] == "Device":
            lon, lat = a["geometry"]["coordinates"][0]
            devices.append({"ref": a["clientRef"], "code": a["attributes"]["componentCode"], "host_pipe": a["hostRef"] if a["hostRef"] in pipes else None,
                            "host_node": a["hostRef"] if a["hostRef"] in nodes else None, "lon": lon, "lat": lat, "inferred": None})

    # -- hydrants: split DN >= 110 pipes so no stretch exceeds the spacing ------------------------
    seq = [0]
    def new_ref(kind):
        seq[0] += 1
        return f"BS-{kind}-{seq[0]:03d}"
    for p in list(pipes.values()):
        total = length_m(p["coords"])
        if p["dn"] < HYDRANT_MIN_DN or total <= HYDRANT_SPACING_M:
            continue
        k = math.ceil(total / HYDRANT_SPACING_M) - 1
        line_m = [to_m.transform(*c) for c in p["coords"]]
        cuts = [total * (i + 1) / (k + 1) for i in range(k)]
        # walk the polyline (metric lengths scaled to geodesic total)
        seg = [math.dist(a, b) for a, b in zip(line_m, line_m[1:])]
        scale = total / sum(seg)
        pieces, current, acc, ci = [], [p["coords"][0]], 0.0, 0
        split_nodes = []
        for i, s in enumerate(seg):
            s_geo = s * scale
            while ci < len(cuts) and acc + s_geo >= cuts[ci] - 1e-6:
                t = (cuts[ci] - acc) / s_geo if s_geo else 0
                x = line_m[i][0] + t * (line_m[i + 1][0] - line_m[i][0])
                y = line_m[i][1] + t * (line_m[i + 1][1] - line_m[i][1])
                pt = list(to_ll.transform(x, y))
                current.append(pt)
                pieces.append(current)
                ref = new_ref("N")
                nodes[ref] = {"ref": ref, "lon": pt[0], "lat": pt[1], "code": "Tee", "cad": False, "inferred": "hydrant-tee"}
                split_nodes.append(ref)
                devices.append({"ref": new_ref("H"), "code": "Hydrant", "host_pipe": None, "host_node": ref, "lon": pt[0], "lat": pt[1], "inferred": "hydrant-spacing"})
                current = [pt]
                ci += 1
            acc += s_geo
            current.append(p["coords"][i + 1])
        pieces.append(current)
        ends = [p["from"], *split_nodes, p["to"]]
        del pipes[p["ref"]]
        new_refs = []
        for j, coords in enumerate(pieces):
            ref = p["ref"] if j == 0 else new_ref("P")
            pipes[ref] = {**p, "ref": ref, "from": ends[j], "to": ends[j + 1], "coords": coords}
            new_refs.append(ref)
        # valves on the pipe move to the piece nearest to them
        for d in devices:
            if d["host_pipe"] == p["ref"]:
                d["host_pipe"] = min(new_refs, key=lambda r: min(length_m([[d["lon"], d["lat"]], c]) for c in pipes[r]["coords"]))

    # -- fittings from the graph ----------------------------------------------------------------
    at = defaultdict(list)
    for p in pipes.values():
        at[p["from"]].append(p)
        at[p["to"]].append(p)
    def direction(node, p):
        coords = p["coords"] if p["from"] == node["ref"] else p["coords"][::-1]
        a, b = to_m.transform(*coords[0]), to_m.transform(*coords[1])
        return math.atan2(b[1] - a[1], b[0] - a[0])
    for n in nodes.values():
        ps = at[n["ref"]]
        dns = sorted({p["dn"] for p in ps})
        n["dn"], n["dn2"] = (dns[-1], dns[0]) if dns else (None, None)
        if len(ps) >= 3:
            code = "Cross" if len(ps) == 4 else ("ReducingTee" if len(dns) > 1 else "Tee")
            if n["code"] != code:
                n["inferred"] = n["inferred"] or "branch"
            n["code"] = code
        elif len(ps) == 2 and not n["cad"] and n["inferred"] is None:
            turn = abs(math.degrees(direction(n, ps[0]) - direction(n, ps[1]))) % 360
            angle = 180 - min(turn, 360 - turn)  # 0 = straight through
            n["angle"] = round(angle, 1)
            if len(dns) > 1:
                n["code"], n["inferred"] = "Reducer", "diameter-change"
            elif angle >= BEND_MIN_DEG:
                n["code"], n["inferred"] = "Bend", "deflection"
        elif len(ps) == 2 and n["code"] == "Bend":
            turn = abs(math.degrees(direction(n, ps[0]) - direction(n, ps[1]))) % 360
            n["angle"] = round(180 - min(turn, 360 - turn), 1)

    # -- supply and dead ends -------------------------------------------------------------------
    dead = [n for n in nodes.values() if len(at[n["ref"]]) == 1]
    source = max(dead, key=lambda n: (at[n["ref"]][0]["dn"], n["lat"]))
    source.update(code="Source", inferred="supply")
    first = at[source["ref"]][0]
    devices.append({"ref": new_ref("M"), "code": "BulkMeter", "host_pipe": first["ref"], "host_node": None,
                    "lon": first["coords"][0][0] if first["from"] == source["ref"] else first["coords"][-1][0],
                    "lat": first["coords"][0][1] if first["from"] == source["ref"] else first["coords"][-1][1], "inferred": "dma-inlet"})
    devices.append({"ref": new_ref("S"), "code": "PressureSensor", "host_pipe": None, "host_node": source["ref"],
                    "lon": source["lon"], "lat": source["lat"], "inferred": "dma-inlet"})
    for n in dead:
        if n is source:
            continue
        n.update(code="Cap", inferred="dead-end")
        devices.append({"ref": new_ref("X"), "code": "Washout", "host_pipe": None, "host_node": n["ref"], "lon": n["lon"], "lat": n["lat"], "inferred": "dead-end"})

    # -- codes and catalog properties -------------------------------------------------------------
    counters = defaultdict(int)
    def code(kind, inferred):
        counters[kind] += 1
        return f"{prefix}-{kind}{counters[kind]:03d}" + ("-BS" if inferred else "")
    common = {"dma": dma, "year": str(year), "condition": "good"}
    out_nodes, out_pipes, out_devices = [], [], []
    for n in sorted(nodes.values(), key=lambda n: (-n["lat"], n["lon"])):
        props = dict(common)
        dn_ranges = {"Tee": (50, 1200), "ReducingTee": (80, 1200), "Cross": (50, 600), "Bend": (50, 1200), "Reducer": (65, 1200),
                     "Cap": (50, 1200), "Junction": (20, 1200), "Source": (300, 1200)}
        lo, hi = dn_ranges[n["code"]]
        if n["dn"]:
            props["dn"] = str(clamp(n["dn"], lo, hi))
        if n["code"] in ("Reducer", "ReducingTee") and n["dn2"] and n["dn2"] != n["dn"]:
            props["dn2"] = str(clamp(n["dn2"], lo, hi))
        if n["code"] in ("Tee", "ReducingTee", "Cross", "Bend", "Reducer", "Cap"):
            props["material"] = "HDPE"
        if n["code"] == "Bend" and n.get("angle") is not None:
            props["angle"] = str(clamp(n["angle"], 0, 180))
        n["code_out"] = code("N", n["inferred"])
        out_nodes.append({"ref": n["ref"], "assetCode": n["code_out"], "componentCode": n["code"], "lon": round(n["lon"], 7), "lat": round(n["lat"], 7),
                          "properties": props, **({"inferred": n["inferred"]} if n["inferred"] else {})})
    for p in sorted(pipes.values(), key=lambda p: p["ref"]):
        out_pipes.append({"ref": p["ref"], "assetCode": code("P", None), "from": p["from"], "to": p["to"], "coordinates": [[round(x, 7), round(y, 7)] for x, y in p["coords"]],
                          "diameterMm": p["dn"], "material": p["material"], "lengthM": round(length_m(p["coords"]), 2), "properties": dict(common)})
    pipe_dn = {p["ref"]: p["dn"] for p in pipes.values()}
    node_dn = {n["ref"]: n["dn"] for n in nodes.values()}
    for d in devices:
        props = dict(common)
        if d["code"] == "GateValve":
            props.update(dn=str(clamp(pipe_dn[d["host_pipe"]], 50, 600)), state="open")
        elif d["code"] == "BulkMeter":
            props["dn"] = str(pipe_dn[d["host_pipe"]])
        elif d["code"] == "Hydrant":
            props["dn"] = "100"
        elif d["code"] == "Washout":
            props["dn"] = str(clamp(min(node_dn[d["host_node"]] or 100, 100), 50, 200))
        elif d["code"] == "PressureSensor":
            props["dn"] = "15"
        kind = {"GateValve": "V", "Hydrant": "H", "Washout": "X", "BulkMeter": "M", "PressureSensor": "S"}[d["code"]]
        out_devices.append({"ref": d["ref"], "assetCode": code(kind, d["inferred"]), "componentCode": d["code"],
                            "hostPipe": d["host_pipe"], "hostNode": d["host_node"], "lon": round(d["lon"], 7), "lat": round(d["lat"], 7),
                            "properties": props, **({"inferred": d["inferred"]} if d["inferred"] else {})})
    summary = defaultdict(int)
    for a in out_nodes + out_devices:
        summary[a["componentCode"] + (" (bổ sung)" if a.get("inferred") else "")] += 1
    return {
        "name": name,
        "rules": __doc__.split("\n\n")[2].strip(),
        "summary": {"pipes": len(out_pipes), "lengthM": round(sum(p["lengthM"] for p in out_pipes)), **dict(sorted(summary.items()))},
        "nodes": out_nodes, "pipes": out_pipes, "devices": out_devices,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("drafts", help="draft-assets.json from the CAD import")
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--dma", required=True)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--prefix", required=True, help="asset code prefix, e.g. VT3")
    a = ap.parse_args()
    drafts = json.load(open(a.drafts))["assets"]
    net = build(drafts, a.name, a.dma, a.year, a.prefix)
    json.dump(net, open(a.out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(net["summary"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
