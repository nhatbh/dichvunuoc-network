"""
The service-pipe network of "2. MB Ong Dich vu- Vinh Thinh 123.dwg", processed the way the CAD import processes the
distribution drawing (scripts/local-stack/networks/README.md, decision 0030), and connected to that processed network.

- Pipes: layers `50` and `63` are HDPE of that outside diameter. The drawing's own labels ("D50, L=…m") agree. This is
  the same convention as the distribution drawing's layers `90` … `315`.
- Nodes: pipe ends within SNAP_M of each other are one node. A pipe end on another pipe's run splits that pipe there.
  The drawing marks these tees with its fitting ticks (block `pt`) and labels ("T63/50").
- Fittings: the fitting at every node comes from the pipes meeting there, as the importer resolves it.
  - Three pipes: Tee, or ReducingTee when the branch is smaller.
  - Two pipes of different DN: Reducer (block `con`, "C63/50").
  - Two pipes at an angle: Bend ("C63").
  - Four pipes: Cross.
  - A dead end with the drawing's cap (block `bit`, "B50"): Cap. Dead ends without one stay plain junctions.
- Tapping saddles: block `Daudai`, named "kt1", "kt2" … on layer `ten dai khoi thuy`.
  - Each saddle sits on the processed distribution pipes, at the nearest point of the CAD-import pipe.
  - The service pipe that starts at a saddle is extended to it, so the service tree hangs off a real distribution pipe.
- Unconnected trees: a few service trees reach no saddle, because the drawing ends them on a distribution pipe without
  the saddle block, or leaves them unconnected. Each is joined by its shortest link to a distribution pipe (a saddle)
  or to a connected service pipe (a tee), and everything added that way is marked `assumed`.

The service drawing's own copy of the distribution pipes (layers `90` … `315`) is not used. The processed import
result is the reference for those.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict

from ezdxf import recover

SNAP_M = 0.5  # the importer's snapToleranceM for Vinh Thinh
SADDLE_M = 1.5  # a service pipe end this close to a saddle block starts at that saddle
CAP_M = 1.0  # a cap block this close to a dead end caps it
BEND_DEG = 10  # deflection below which two pipes of one DN meeting at a node are a straight joint
LINK_MAX_M = 250  # an unconnected tree farther than this from everything stays unconnected
SERVICE_LAYERS = {'50': 50, '63': 63}


def _pts(e):
    t = e.dxftype()
    if t == 'LINE':
        return [(e.dxf.start[0], e.dxf.start[1]), (e.dxf.end[0], e.dxf.end[1])]
    if t == 'LWPOLYLINE':
        return [(p[0], p[1]) for p in e.get_points('xy')]
    if t == 'POLYLINE':
        return [(p[0], p[1]) for p in e.points()]
    return []


def _clean(pts):
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > 0.01:
            out.append((float(p[0]), float(p[1])))
    return out


def _proj(p, a, b):
    """distance from p to segment ab, parameter t, the point"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy or 1e-12
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    q = (a[0] + dx * t, a[1] + dy * t)
    return math.dist(p, q), t, q


def _cross(a, b, c, d):
    """intersection of segments ab and cd, or None"""
    r = (b[0] - a[0], b[1] - a[1])
    s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-12:
        return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (a[0] + t * r[0], a[1] + t * r[1])
    return None


def _length(pts):
    return sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def _bearing(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def _text(e):
    return e.dxf.text if e.dxftype() == 'TEXT' else e.text


class _Grid:
    """bucket points for radius queries"""

    def __init__(self, cell=5.0):
        self.cell = cell
        self.b = defaultdict(list)

    def add(self, p, v):
        self.b[(int(p[0] // self.cell), int(p[1] // self.cell))].append((p, v))

    def near(self, p, r):
        c = self.cell
        out = []
        for i in range(int((p[0] - r) // c), int((p[0] + r) // c) + 1):
            for j in range(int((p[1] - r) // c), int((p[1] + r) // c) + 1):
                for q, v in self.b.get((i, j), ()):
                    if math.dist(p, q) <= r:
                        out.append((math.dist(p, q), q, v))
        return sorted(out, key=lambda x: x[0])


def read(path, decode):
    """the drawing's service pipes, saddles, caps, reducers, fitting ticks and labels (VN-2000 metres)"""
    doc, _ = recover.readfile(path)
    msp = doc.modelspace()
    lines, blocks, labels = [], defaultdict(list), []
    for e in msp:
        lay = e.dxf.layer
        t = e.dxftype()
        if lay in SERVICE_LAYERS and t in ('LINE', 'LWPOLYLINE', 'POLYLINE'):
            pts = _clean(_pts(e))
            if len(pts) >= 2 and _length(pts) > 0.05:
                lines.append({'dn': SERVICE_LAYERS[lay], 'path': pts})
        elif t == 'INSERT' and e.dxf.name in ('Daudai', 'bit', 'con', 'pt'):
            blocks[e.dxf.name].append((float(e.dxf.insert[0]), float(e.dxf.insert[1])))
        elif t in ('TEXT', 'MTEXT') and lay in ('ten dai khoi thuy', 'Text phu kien'):
            s = decode(_text(e)).strip()
            p = e.dxf.insert
            if s:
                labels.append({'layer': lay, 'text': s, 'at': (float(p[0]), float(p[1]))})
    return lines, blocks, labels


def _on_mains(p, mains):
    best = (1e9, None, None, 0.0)
    for m in mains:
        for k in range(1, len(m['path'])):
            d, _, q = _proj(p, m['path'][k - 1], m['path'][k])
            if d < best[0]:
                best = (d, m, q, _bearing(m['path'][k - 1], m['path'][k]))
    return best


class _Net:
    """service pipes as pieces between nodes"""

    def __init__(self):
        self.pieces = []  # {dn, path, from, to, assumed}
        self.nodes = {}  # id -> {at, saddle, assumed}
        self._n = 0

    def node(self, at, saddle=None, assumed=False):
        if saddle:
            nid = saddle['id']
        else:
            self._n += 1
            nid = f'SN-{self._n}'
        self.nodes[nid] = {'id': nid, 'at': at, 'saddle': saddle, 'assumed': assumed}
        return nid

    def split(self, pi, k, q, assumed=False):
        """split piece pi at point q on its segment k (path[k-1] → path[k]); returns the new node id"""
        pc = self.pieces[pi]
        path = pc['path']
        if math.dist(q, path[0]) < 0.05:
            return pc['from']
        if math.dist(q, path[-1]) < 0.05:
            return pc['to']
        nid = self.node(q, assumed=assumed)
        a = path[:k] + [q]
        b = [q] + path[k:]
        a = [p for i, p in enumerate(a) if i == 0 or math.dist(a[i - 1], p) > 0.01]
        b = [p for i, p in enumerate(b) if i == 0 or math.dist(b[i - 1], p) > 0.01]
        pc['path'], to = a, pc['to']
        pc['to'] = nid
        self.pieces.append({**pc, 'path': b, 'from': nid, 'to': to})
        return nid

    def degree(self):
        d = defaultdict(list)
        for i, pc in enumerate(self.pieces):
            d[pc['from']].append((i, 0))
            d[pc['to']].append((i, 1))
        return d

    def reached(self):
        adj = defaultdict(list)
        for pc in self.pieces:
            adj[pc['from']].append(pc['to'])
            adj[pc['to']].append(pc['from'])
        seen = set()
        stack = [n for n, v in self.nodes.items() if v['saddle'] and n in adj]
        while stack:
            n = stack.pop()
            if n not in seen:
                seen.add(n)
                stack.extend(adj[n])
        return seen


def build(lines, blocks, labels, mains, report=print):
    """
    lines: service pipes [{dn, path}] in metres; mains: processed distribution pipes [{id, dn, path}] in the same
    metres. Returns (pieces, fittings, saddles) in metres; the caller converts to lon/lat.
    """
    # ── saddles on the processed distribution pipes ──
    kt = [l for l in labels if l['layer'] == 'ten dai khoi thuy' and re.fullmatch(r'(?i)kt\d+[a-z]?', l['text'])]
    saddles = []
    used = set()
    for i, d in enumerate(blocks['Daudai']):
        dist, m, q, h = _on_mains(d, mains)
        tag = None
        for l in sorted(kt, key=lambda l: math.dist(l['at'], d)):
            if l['text'].lower() not in used and math.dist(l['at'], d) < 25:
                tag = l['text'].lower()
                used.add(tag)
                break
        saddles.append({'id': f'DKT-{i + 1}', 'tag': tag or f'dkt{i + 1}', 'drawn': d, 'at': q, 'main': m['id'],
                        'mainDn': m['dn'], 'heading': h, 'offset': dist})
    off = sorted(s['offset'] for s in saddles)
    report(f'saddles {len(saddles)}: moved onto the processed pipes by median {off[len(off) // 2]:.2f} m, max {off[-1]:.2f} m')

    # ── service pipe ends that start at a saddle: extend them to the saddle on the processed pipe ──
    sg = _Grid()
    for s in saddles:
        sg.add(s['drawn'], s)
    start_saddle = {}  # line index -> saddle (the line is turned to start there)
    for li, l in enumerate(lines):
        for end in (0, 1):
            p = l['path'][0 if end == 0 else -1]
            hit = sg.near(p, SADDLE_M)
            if hit and li not in start_saddle:
                s = hit[0][2]
                if end == 1:
                    l['path'].reverse()
                # the drawn start sits on the service drawing's own copy of the distribution pipe, up to a few metres
                # off the processed one: the pipe starts at the saddle instead (no kink back across the pipe)
                path = l['path']
                path[0] = s['at']
                while len(path) > 2 and math.dist(path[0], path[1]) < 0.05:
                    del path[1]
                start_saddle[li] = s
    fed = {s['id'] for s in start_saddle.values()}
    report(f'service pipes starting at a saddle {len(start_saddle)}; saddles without a pipe: {len(saddles) - len(fed)}')

    # ── tees: a pipe end on another pipe's run splits that pipe ──
    splits = defaultdict(list)
    for li, l in enumerate(lines):
        for end in (0, 1):
            if end == 0 and li in start_saddle:
                continue
            p = l['path'][0 if end == 0 else -1]
            for lj, m in enumerate(lines):
                path = m['path']
                if lj == li or math.dist(p, path[0]) <= SNAP_M or math.dist(p, path[-1]) <= SNAP_M:
                    continue
                for k in range(1, len(path)):
                    dist, t, q = _proj(p, path[k - 1], path[k])
                    if dist <= SNAP_M:
                        splits[lj].append((k, t, q))
                        break
    net = _Net()
    raw = []  # (piece, line index)
    for li, l in enumerate(lines):
        path = l['path']
        cur, k_prev = [path[0]], 1
        for k, t, q in sorted(splits.get(li, []), key=lambda c: (c[0], c[1])):
            cur.extend(path[k_prev:k])
            if math.dist(cur[-1], q) > 0.01:
                cur.append(q)
            if len(cur) >= 2 and _length(cur) > 0.05:
                raw.append(({'dn': l['dn'], 'path': cur}, li))
            cur, k_prev = [q], k
        cur.extend(path[k_prev:])
        if len(cur) >= 2 and _length(cur) > 0.05:
            raw.append(({'dn': l['dn'], 'path': cur}, li))
    report(f'service pipes {len(lines)} → {len(raw)} after splitting at {sum(len(v) for v in splits.values())} tees')

    # ── nodes: ends within SNAP_M are one node; a saddle's end stays at its saddle ──
    ends = []  # (piece index, end, point, saddle or None)
    for pi, (pc, li) in enumerate(raw):
        s = start_saddle.get(li)
        first_piece = s and math.dist(pc['path'][0], s['at']) < 0.01
        ends.append((pi, 0, pc['path'][0], s if first_piece else None))
        ends.append((pi, 1, pc['path'][-1], None))
    parent = list(range(len(ends)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    eg = _Grid(2.0)
    for ei, (_, _, p, s) in enumerate(ends):
        for _, _, other in eg.near(p, SNAP_M):
            so = ends[other][3]
            if s and so and s['id'] != so['id']:
                continue  # two saddles side by side stay two saddles
            parent[find(ei)] = find(other)
        eg.add(p, ei)
    groups = defaultdict(list)
    for ei in range(len(ends)):
        groups[find(ei)].append(ei)
    net.pieces = [{**pc, 'from': None, 'to': None, 'assumed': False} for pc, _ in raw]
    for members in groups.values():
        sad = next((ends[ei][3] for ei in members if ends[ei][3]), None)
        pts = [ends[ei][2] for ei in members]
        at = sad['at'] if sad else (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        nid = net.node(at, saddle=sad)
        for ei in members:
            pi, end, _, _ = ends[ei]
            net.pieces[pi]['from' if end == 0 else 'to'] = nid
            net.pieces[pi]['path'][0 if end == 0 else -1] = at
    for s in saddles:  # a saddle no pipe reached is still on its pipe
        if s['id'] not in net.nodes:
            net.node(s['at'], saddle=s)
    # a stub whose two ends became one node: the drawing's link to its own copy of the distribution pipe, where the
    # processed pipe runs through the stub's far end (the pipes beyond it now start at the saddle)
    stubs = [p for p in net.pieces if p['from'] == p['to']]
    net.pieces = [p for p in net.pieces if p['from'] != p['to']]
    report(f'stubs dropped (both ends on one node): {len(stubs)}, {sum(_length(p["path"]) for p in stubs):.1f} m')
    # two drawn saddles that land on one spot of the processed pipe, with one tree between them: one saddle, both names
    used_nodes = {p['from'] for p in net.pieces} | {p['to'] for p in net.pieces}
    merged = []
    for s in list(saddles):
        if s['id'] in used_nodes:
            continue
        host = next((o for o in saddles if o is not s and o['id'] in used_nodes and math.dist(o['at'], s['at']) < SNAP_M), None)
        if host:
            host['tag'] = f"{host['tag']} + {s['tag']}"
            saddles.remove(s)
            del net.nodes[s['id']]
            merged.append(s['tag'])
    report(f'saddles merged into one at the same spot: {merged}')

    # ── join every tree that reaches no saddle by its shortest link (assumed) ──
    caps = _Grid(2.0)
    for c in blocks['bit']:
        caps.add(c, c)
    added = {'saddle': 0, 'tee': 0, 'cross': 0, 'pipe_m': 0.0}
    loose_left = []
    for _ in range(200):
        reach = net.reached()
        loose = [i for i, pc in enumerate(net.pieces) if pc['from'] not in reach]
        if not loose:
            break
        # one tree at a time: the one containing the first loose piece
        adj = defaultdict(list)
        for i in loose:
            adj[net.pieces[i]['from']].append(i)
            adj[net.pieces[i]['to']].append(i)
        tree, stack = set(), [loose[0]]
        while stack:
            i = stack.pop()
            if i not in tree:
                tree.add(i)
                stack.extend(adj[net.pieces[i]['from']] + adj[net.pieces[i]['to']])
        deg = net.degree()
        tree_nodes = {net.pieces[i]['from'] for i in tree} | {net.pieces[i]['to'] for i in tree}
        open_ends = [n for n in tree_nodes if len(deg[n]) == 1 and not caps.near(net.nodes[n]['at'], CAP_M)]
        targets = [('main', m, k) for m in mains for k in range(1, len(m['path']))]
        targets += [('svc', i, k) for i, pc in enumerate(net.pieces) if pc['from'] in reach for k in range(1, len(pc['path']))]

        def seg(t):
            kind, o, k = t
            path = o['path'] if kind == 'main' else net.pieces[o]['path']
            return path[k - 1], path[k]

        best = None  # (gap, rank, kind, ...)
        for t in targets:
            a, b = seg(t)
            rank = 0 if t[0] == 'main' else 1
            for n in open_ends or tree_nodes:
                d, _, q = _proj(net.nodes[n]['at'], a, b)
                if best is None or (d, rank) < best[:2]:
                    best = (d, rank, 'end', n, t, q)
            for i in tree:
                path = net.pieces[i]['path']
                for k in range(1, len(path)):
                    x = _cross(path[k - 1], path[k], a, b)
                    if x and (best is None or (0.0, rank) < best[:2]):
                        best = (0.0, rank, 'cross', (i, k), t, x)
        length = sum(_length(net.pieces[i]['path']) for i in tree)
        if best is None or best[0] > LINK_MAX_M:
            loose_left.append(length)
            for i in tree:  # leave it, but do not look at it again
                net.nodes[net.pieces[i]['from']]['saddle'] = net.nodes[net.pieces[i]['from']]['saddle'] or {'id': None}
            continue
        gap, _, how, where, t, q = best
        kind, o, k = t
        # the point on the target: a new saddle on the distribution pipe, or a tee on the service pipe
        if kind == 'main':
            a, b = seg(t)
            s = {'id': f'DKT-G{added["saddle"] + 1}', 'tag': f'đai giả định {added["saddle"] + 1}', 'drawn': None, 'at': q,
                 'main': o['id'], 'mainDn': o['dn'], 'heading': _bearing(a, b), 'offset': 0.0, 'assumed': True}
            saddles.append(s)
            target_node = net.node(q, saddle=s, assumed=True)
            added['saddle'] += 1
        else:
            target_node = net.split(o, k, q, assumed=True)
            added['tee'] += 1
        # the point on the tree: its end, or a split where it crosses the target
        if how == 'end':
            if gap > 0.05:
                dn = net.pieces[deg[where][0][0]]['dn'] if deg[where] else 50
                net.pieces.append({'dn': dn, 'path': [net.nodes[target_node]['at'], net.nodes[where]['at']],
                                   'from': target_node, 'to': where, 'assumed': True})
                added['pipe_m'] += gap
            else:
                for pc in net.pieces:  # the end becomes the target node
                    for e in ('from', 'to'):
                        if pc[e] == where:
                            pc[e] = target_node
                            pc['path'][0 if e == 'from' else -1] = net.nodes[target_node]['at']
                del net.nodes[where]
        else:
            i, kk = where
            mid = net.split(i, kk, q, assumed=True)
            for pc in net.pieces:
                for e in ('from', 'to'):
                    if pc[e] == mid:
                        pc[e] = target_node
                        pc['path'][0 if e == 'from' else -1] = net.nodes[target_node]['at']
            del net.nodes[mid]
            added['cross'] += 1
    for n in net.nodes.values():  # undo the "seen" marks of trees left unconnected
        if n['saddle'] and n['saddle'].get('id') is None:
            n['saddle'] = None
    report(f"joined unconnected trees with {added['saddle']} assumed saddles, {added['tee']} assumed tees "
           f"({added['cross']} at crossings), {added['pipe_m']:.0f} m of assumed link pipe; "
           f"left unconnected: {len(loose_left)} trees, {sum(loose_left):.0f} m")

    # ── the fitting at each node, from the pipes meeting there ──
    deg = net.degree()
    fittings = []
    kinds = defaultdict(int)
    for nid, n in net.nodes.items():
        at = n['at']
        dirs = []
        for pi, end in deg[nid]:
            path = net.pieces[pi]['path']
            nxt = path[1] if end == 0 else path[-2]
            dirs.append((_bearing(at, nxt), net.pieces[pi]['dn']))
        if n['saddle']:
            s = n['saddle']
            s['dn2'] = max((d for _, d in dirs), default=50)
            kinds['TappingSaddle'] += 1
            continue
        if not dirs:
            continue
        dns = sorted({d for _, d in dirs}, reverse=True)
        kind, heading, dn, dn2, angle = None, dirs[0][0], dns[0], None, None
        if len(dirs) == 1:
            if caps.near(at, CAP_M):
                kind, heading = 'Cap', dirs[0][0] + math.pi  # the cap's port faces its pipe
        elif len(dirs) == 2:
            (a, da), (b, db) = dirs
            defl = 180 - abs((math.degrees(a - b) + 180) % 360 - 180)
            if da != db:
                kind, dn2 = 'Reducer', min(da, db)
                heading = b if da > db else a  # port A (−x) faces the larger pipe
            elif defl >= BEND_DEG:
                kind, angle, heading = 'Bend', round(defl), a + math.pi
        elif len(dirs) == 3:
            best = None  # the run is the pair closest to straight, the branch the third
            for i in range(3):
                for j in range(i + 1, 3):
                    dev = abs(180 - abs((math.degrees(dirs[i][0] - dirs[j][0]) + 180) % 360 - 180))
                    if best is None or dev < best[0]:
                        best = (dev, i, j)
            _, i, j = best
            br = 3 - i - j
            run = max(dirs[i][1], dirs[j][1])
            heading = dirs[j][0]
            if math.sin(dirs[br][0] - heading) < 0:  # the catalog's branch is +90° from +x
                heading = dirs[i][0]
            if dirs[br][1] < run:
                kind, dn, dn2 = 'ReducingTee', run, dirs[br][1]
            else:
                kind, dn = 'Tee', run
        else:
            kind = 'Cross'
        kinds[kind or 'Junction'] += 1
        if kind:
            f = {'id': nid, 'kind': kind, 'dn': dn, 'at': at, 'heading': heading}
            if dn2:
                f['dn2'] = dn2
            if angle:
                f['angle'] = angle
            if n['assumed']:
                f['assumed'] = True
            fittings.append(f)
    report('service fittings ' + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda x: -x[1])))
    lab = defaultdict(int)
    for l in labels:
        m = re.match(r'(?i)([tbc])\s*\d+(/\d+)?', l['text']) if l['layer'] == 'Text phu kien' else None
        if m:
            lab[{'t': 'T (tê)', 'b': 'B (bịt)', 'c': 'C/ (côn)' if m.group(2) else 'C (cút)'}[m.group(1).lower()]] += 1
    report('drawing labels ' + ', '.join(f'{k} {v}' for k, v in sorted(lab.items())))
    reach = net.reached()
    report(f'service pipes reaching a saddle: {sum(1 for p in net.pieces if p["from"] in reach)} of {len(net.pieces)}')
    return net.pieces, fittings, saddles
