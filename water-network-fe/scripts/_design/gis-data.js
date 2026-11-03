/* Bản đồ mạng lưới GIS — water-network-gis-service · dữ liệu mô phỏng.
   Sinh hình học mạng lưới (lưới đường + ống + tài sản) theo seed cố định để
   danh sách tài sản, topology, truy vết… đều tham chiếu cùng một geometry. */
(function () {
  window.fmtInt = window.fmtInt || ((n) => Math.round(n).toLocaleString("vi-VN"));
  window.fmtDec = (n, d = 1) => Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
  window.fmtKm = (m) => (m >= 1000 ? (m / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " km" : Math.round(m) + " m");

  // ── PRNG cố định ──
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(20260623);
  const rr = (a, b) => a + (b - a) * rnd();
  const ri = (a, b) => Math.floor(rr(a, b + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const W = 1680, H = 1060, U2M = 1.15; // 1 đơn vị ≈ 1,15 m
  const COLS = 9, ROWS = 6;
  const vx = [], hy = [];
  for (let i = 0; i < COLS; i++) vx.push(Math.round(132 + i * (1416 / (COLS - 1)) + rr(-14, 14)));
  for (let j = 0; j < ROWS; j++) hy.push(Math.round(118 + j * (824 / (ROWS - 1)) + rr(-12, 12)));

  // ── Sông + hồ (nền) ──
  const river = "M -40 250 C 220 300, 360 180, 560 240 C 800 310, 980 200, 1240 280 C 1460 340, 1620 300, 1740 360";
  const lake = [[1180, 720], [1330, 700], [1420, 770], [1390, 880], [1240, 910], [1140, 840]];
  const parks = [
    { id: "PK1", name: "Công viên Trung Tâm", poly: [[470, 560], [640, 545], [690, 660], [600, 730], [460, 700]] },
    { id: "PK2", name: "Vườn hoa Tây", poly: [[150, 800], [300, 790], [330, 900], [180, 930]] },
  ];

  // ── Khối nhà (giả lập basemap) ──
  const blocks = [];
  for (let i = 0; i < COLS - 1; i++) for (let j = 0; j < ROWS - 1; j++) {
    const x0 = vx[i] + 16, x1 = vx[i + 1] - 16, y0 = hy[j] + 14, y1 = hy[j + 1] - 14;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (cy > 180 && cy < 330 && cx < 1300) continue; // tránh sông
    const inLake = cx > 1120 && cx < 1440 && cy > 680 && cy < 920;
    const inPark = parks.some((p) => { const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]); return cx > Math.min(...xs) && cx < Math.max(...xs) && cy > Math.min(...ys) && cy < Math.max(...ys); });
    if (inLake || inPark) continue;
    const n = ri(3, 6);
    for (let k = 0; k < n; k++) {
      const bw = rr(26, (x1 - x0) / 2.4), bh = rr(22, (y1 - y0) / 2.4);
      const bx = rr(x0, x1 - bw), by = rr(y0, y1 - bh);
      blocks.push({ x: Math.round(bx), y: Math.round(by), w: Math.round(bw), h: Math.round(bh), t: rnd() });
    }
  }

  // ── Nút (giao lộ) ──
  const nodes = [];
  const nodeAt = {};
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
    const id = `ND-${String(i)}${String(j)}`;
    const n = { id, code: `J${i}${j}`, x: vx[i], y: hy[j], i, j, z: Math.round(rr(4, 28) * 10) / 10, kind: "junction" };
    nodes.push(n); nodeAt[`${i},${j}`] = n;
  }

  // ── DMA ──
  const DMA_DEFS = [
    { id: "DMA-01", name: "DMA Trần Hưng Đạo", ci: [0, 3], cj: [0, 2], col: "#0E7C86" },
    { id: "DMA-02", name: "DMA Lê Lợi", ci: [3, 6], cj: [0, 2], col: "#0969DA" },
    { id: "DMA-03", name: "DMA Nguyễn Trãi", ci: [6, 8], cj: [0, 3], col: "#8250DF" },
    { id: "DMA-04", name: "DMA Hai Bà Trưng", ci: [0, 4], cj: [2, 5], col: "#1A7F37" },
    { id: "DMA-05", name: "DMA Quang Trung", ci: [4, 8], cj: [3, 5], col: "#D86C1F" },
  ];
  const dmaOf = (x, y) => {
    let ci = 0, cj = 0;
    for (let i = 0; i < COLS - 1; i++) if (x >= vx[i]) ci = i;
    for (let j = 0; j < ROWS - 1; j++) if (y >= hy[j]) cj = j;
    const d = DMA_DEFS.find((d) => ci >= d.ci[0] && ci < d.ci[1] && cj >= d.cj[0] && cj < d.cj[1]);
    return d ? d.id : "DMA-01";
  };
  const dmas = DMA_DEFS.map((d) => {
    const poly = [[vx[d.ci[0]], hy[d.cj[0]]], [vx[d.ci[1]], hy[d.cj[0]]], [vx[d.ci[1]], hy[d.cj[1]]], [vx[d.ci[0]], hy[d.cj[1]]]];
    return { id: d.id, name: d.name, col: d.col, poly };
  });

  // ── Ống ──
  const MATERIALS = ["Gang dẻo", "HDPE", "uPVC", "Thép", "Gang xám"];
  const pipes = [];
  let pid = 0;
  function addPipe(a, b, trunk) {
    const dn = trunk ? pick([300, 400, 500, 600]) : pick([100, 110, 150, 160, 200]);
    const lenU = Math.hypot(a.x - b.x, a.y - b.y);
    const year = ri(1992, 2024);
    const age = 2026 - year;
    let cond = age > 30 ? "poor" : age > 18 ? "fair" : "good";
    let status = "ok";
    const r = rnd();
    if (r < 0.05) status = "leak"; else if (r < 0.12) status = "planned"; else if (r < 0.16) status = "abandoned";
    pipes.push({
      id: `PIP-${String(++pid).padStart(4, "0")}`, code: `O.${dn}.${String(pid).padStart(3, "0")}`,
      from: a.id, to: b.id, dn, trunk: !!trunk, material: pick(MATERIALS), year, cond, status,
      lenM: Math.round(lenU * U2M), pts: [[a.x, a.y], [b.x, b.y]], dma: dmaOf((a.x + b.x) / 2, (a.y + b.y) / 2),
    });
  }
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS - 1; i++) addPipe(nodeAt[`${i},${j}`], nodeAt[`${i + 1},${j}`], j === 1 || j === 4);
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS - 1; j++) addPipe(nodeAt[`${i},${j}`], nodeAt[`${i},${j + 1}`], i === 2 || i === 6);

  const pipeBy = Object.fromEntries(pipes.map((p) => [p.id, p]));
  const midOf = (p) => [(p.pts[0][0] + p.pts[1][0]) / 2, (p.pts[0][1] + p.pts[1][1]) / 2];

  // ── Van ──
  const valves = [];
  let vid = 0;
  pipes.forEach((p) => {
    const onBoundary = (() => { // van biên DMA: 2 đầu khác DMA
      const a = nodes.find((n) => n.id === p.from), b = nodes.find((n) => n.id === p.to);
      return dmaOf(a.x, a.y) !== dmaOf(b.x, b.y);
    })();
    if (onBoundary || (p.trunk && rnd() < 0.4) || rnd() < 0.12) {
      const t = onBoundary ? 0.5 : rr(0.3, 0.7);
      const x = p.pts[0][0] + (p.pts[1][0] - p.pts[0][0]) * t, y = p.pts[0][1] + (p.pts[1][1] - p.pts[0][1]) * t;
      const kind = onBoundary ? "boundary" : p.dn >= 300 ? "gate" : "gate";
      const closed = onBoundary && rnd() < 0.5;
      valves.push({ id: `VAL-${String(++vid).padStart(3, "0")}`, code: `V.${vid}`, x: Math.round(x), y: Math.round(y), pipe: p.id, dn: p.dn, kind, state: closed ? "closed" : "open", dma: p.dma, year: ri(2000, 2024) });
    }
  });

  // ── Trụ cứu hoả ──
  const hydrants = [];
  pipes.filter((p) => p.trunk).forEach((p, k) => { if (k % 2 === 0) { const m = midOf(p); hydrants.push({ id: `HYD-${String(hydrants.length + 1).padStart(3, "0")}`, code: `PCC.${hydrants.length + 1}`, x: Math.round(m[0] + rr(-20, 20)), y: Math.round(m[1] + rr(-16, 16)), dma: p.dma, status: rnd() < 0.12 ? "fault" : "ok" }); } });

  // ── Nguồn: nhà máy, bể, trạm bơm ──
  const plant = { id: "PLANT-1", name: "NMN Sông Đà", x: 90, y: 360, flow: 4200 };
  const reservoirs = [
    { id: "RES-1", name: "Bể chứa Trung Tâm", x: vx[4], y: hy[2], cap: 8000, level: 78, dma: "DMA-02" },
    { id: "RES-2", name: "Đài nước Đông", x: vx[7] + 30, y: hy[1] - 40, cap: 3000, level: 64, dma: "DMA-03" },
  ];
  const pumps = [
    { id: "PUMP-1", name: "Trạm bơm Tây", x: vx[1], y: hy[3], pumps: 3, run: 2, dma: "DMA-04" },
    { id: "PUMP-2", name: "Trạm bơm Nam", x: vx[5], y: hy[4], pumps: 2, run: 2, dma: "DMA-05" },
    { id: "PUMP-3", name: "Trạm tăng áp Đông", x: vx[7], y: hy[3], pumps: 2, run: 1, dma: "DMA-03" },
  ];

  // ── Đấu nối khách hàng (điểm) ──
  const STREETS = ["Trần Hưng Đạo", "Lê Lợi", "Nguyễn Trãi", "Hai Bà Trưng", "Quang Trung", "Lý Thường Kiệt", "Phan Đình Phùng", "Hoàng Diệu"];
  const CTYPE = { sh: { label: "Sinh hoạt", col: "#0E7C86" }, hcsn: { label: "Hành chính SN", col: "#0969DA" }, sx: { label: "Sản xuất", col: "#8250DF" }, kd: { label: "Kinh doanh DV", col: "#D86C1F" } };
  const connDots = [];
  const connections = [];
  blocks.forEach((b, bi) => {
    if (rnd() < 0.45) return;
    const x = b.x + b.w / 2 + rr(-6, 6), y = b.y + b.h / 2 + rr(-6, 6);
    const dma = dmaOf(x, y);
    connDots.push({ x: Math.round(x), y: Math.round(y), dma });
    if (connDots.length % 3 === 0) {
      const tk = pick(["sh", "sh", "sh", "hcsn", "sx", "kd"]);
      const st = rnd() < 0.07 ? "pending" : rnd() < 0.12 ? "review" : "active";
      connections.push({
        id: `SC-${String(connections.length + 1).padStart(4, "0")}`,
        danhbo: `${ri(1, 9)}${String(ri(100000, 999999))}`,
        name: pick(["Nguyễn Văn", "Trần Thị", "Lê Hoàng", "Phạm Minh", "Vũ Thanh", "Đỗ Quang", "Bùi Thị", "Hồ Ngọc"]) + " " + pick(["An", "Bình", "Cường", "Dung", "Hà", "Khanh", "Lâm", "Mai", "Phúc", "Tú"]),
        addr: `${ri(2, 240)} ${pick(STREETS)}`, type: tk, dma, x: Math.round(x), y: Math.round(y),
        meter: `ĐH-${ri(10, 24)}${String(ri(10000, 99999))}`, dn: pick([15, 20, 25, 32]), status: st,
        geocoded: rnd() < 0.92, gpsRtk: rnd() < 0.7,
      });
    }
  });

  // ── Lớp bản đồ ──
  const LAYERS = [
    { id: "basemap", label: "Nền bản đồ", grp: "Nền", on: true, lock: true },
    { id: "dma", label: "Ranh giới DMA", grp: "Phân vùng", on: true, count: dmas.length },
    { id: "pipe", label: "Tuyến ống", grp: "Tài sản", on: true, count: pipes.length },
    { id: "valve", label: "Van", grp: "Tài sản", on: true, count: valves.length },
    { id: "hydrant", label: "Trụ cứu hoả", grp: "Tài sản", on: false, count: hydrants.length },
    { id: "node", label: "Nút / Phụ kiện", grp: "Tài sản", on: false, count: nodes.length },
    { id: "source", label: "Nguồn (bể, bơm, NMN)", grp: "Tài sản", on: true, count: reservoirs.length + pumps.length + 1 },
    { id: "conn", label: "Đấu nối khách hàng", grp: "Khách hàng", on: false, count: connections.length },
    { id: "label", label: "Nhãn tuyến ống", grp: "Hiển thị", on: false },
  ];

  // ── Tài sản không gian (gộp) ──
  const ASSET_TYPES = {
    pipe: { label: "Tuyến ống", geom: "line", icon: "IcPipe", col: "#0E7C86" },
    valve: { label: "Van", geom: "point", icon: "IcValve", col: "#0969DA" },
    hydrant: { label: "Trụ cứu hoả", geom: "point", icon: "IcHydrant", col: "#D1242F" },
    node: { label: "Nút / Phụ kiện", geom: "point", icon: "IcNode", col: "#8250DF" },
    pump: { label: "Trạm bơm", geom: "point", icon: "IcPump", col: "#D86C1F" },
    reservoir: { label: "Bể / Đài nước", geom: "point", icon: "IcTank", col: "#1A7F37" },
    dma: { label: "Vùng DMA", geom: "polygon", icon: "IcPolygon", col: "#9A6700" },
  };
  const COND = { good: { label: "Tốt", col: "#1A7F37" }, fair: { label: "Khá", col: "#9A6700" }, poor: { label: "Kém", col: "#D86C1F" }, critical: { label: "Nguy cấp", col: "#D1242F" } };
  const PSTATUS = { ok: { label: "Vận hành", col: "#1A7F37" }, leak: { label: "Rò rỉ", col: "#D1242F" }, planned: { label: "Quy hoạch", col: "#0969DA" }, abandoned: { label: "Đã hủy", col: "#8B949E" } };

  const assets = [];
  pipes.forEach((p) => assets.push({ id: p.id, code: p.code, type: "pipe", geom: "line", name: `Ống DN${p.dn} · ${p.material}`, dma: p.dma, cond: p.cond, status: p.status, attrs: { "Đường kính": `DN ${p.dn}`, "Vật liệu": p.material, "Năm lắp": p.year, "Chiều dài": window.fmtKm(p.lenM) }, geomRef: p }));
  valves.forEach((v) => assets.push({ id: v.id, code: v.code, type: "valve", geom: "point", name: `Van ${v.kind === "boundary" ? "biên DMA" : "chặn"} DN${v.dn}`, dma: v.dma, cond: "good", status: v.state === "closed" ? "planned" : "ok", attrs: { "Đường kính": `DN ${v.dn}`, "Loại": v.kind === "boundary" ? "Van biên" : "Van chặn", "Trạng thái": v.state === "closed" ? "Đang đóng" : "Đang mở", "Năm lắp": v.year }, geomRef: v }));
  hydrants.forEach((h) => assets.push({ id: h.id, code: h.code, type: "hydrant", geom: "point", name: "Trụ cứu hoả", dma: h.dma, cond: h.status === "fault" ? "poor" : "good", status: h.status === "fault" ? "leak" : "ok", attrs: { "Trạng thái": h.status === "fault" ? "Cần kiểm tra" : "Sẵn sàng" }, geomRef: h }));
  pumps.forEach((p) => assets.push({ id: p.id, code: p.id, type: "pump", geom: "point", name: p.name, dma: p.dma, cond: "good", status: "ok", attrs: { "Số bơm": p.pumps, "Đang chạy": p.run }, geomRef: p }));
  reservoirs.forEach((r) => assets.push({ id: r.id, code: r.id, type: "reservoir", geom: "point", name: r.name, dma: r.dma, cond: "good", status: "ok", attrs: { "Dung tích": window.fmtInt(r.cap) + " m³", "Mực nước": r.level + "%" }, geomRef: r }));
  dmas.forEach((d) => assets.push({ id: d.id, code: d.id, type: "dma", geom: "polygon", name: d.name, dma: d.id, cond: "good", status: "ok", attrs: { "Số đấu nối": connections.filter((c) => c.dma === d.id).length, "Số ống": pipes.filter((p) => p.dma === d.id).length }, geomRef: d }));

  // ── Topology issues ──
  const TOPO_KINDS = {
    dangling: { label: "Ống treo (dangling)", sev: "error", col: "#D1242F", hint: "Đầu ống không đấu vào nút/ống nào" },
    overshoot: { label: "Ống vượt nút (overshoot)", sev: "error", col: "#D1242F", hint: "Ống đi quá điểm giao, tạo đoạn thừa" },
    dupNode: { label: "Nút trùng (duplicate)", sev: "warn", col: "#D86C1F", hint: "Hai nút sát nhau dưới ngưỡng dung sai" },
    elev: { label: "Sai cao độ kết nối", sev: "warn", col: "#D86C1F", hint: "Chênh cao độ tại điểm nối vượt ngưỡng" },
    disconnect: { label: "Đoạn cô lập", sev: "error", col: "#D1242F", hint: "Cụm ống không liên thông tới nguồn" },
    flow: { label: "Thiếu van cô lập", sev: "info", col: "#0969DA", hint: "Đoạn không thể cô lập độc lập khi sửa chữa" },
  };
  const topoIssues = [];
  let tiq = 0;
  const sampleP = (n) => pipes.filter((p) => p.trunk).filter((_, k) => k % 3 === 0).slice(0, n);
  [["dangling", 3], ["overshoot", 2], ["dupNode", 2], ["elev", 4], ["disconnect", 1], ["flow", 3]].forEach(([kind, n]) => {
    for (let k = 0; k < n; k++) {
      const p = pipes[ri(0, pipes.length - 1)];
      const m = midOf(p);
      topoIssues.push({ id: `TI-${String(++tiq).padStart(3, "0")}`, kind, dma: p.dma, x: Math.round(m[0]), y: Math.round(m[1]), ref: p.id, status: rnd() < 0.25 ? "fixed" : rnd() < 0.2 ? "ignored" : "open", auto: rnd() < 0.4 });
    }
  });

  // ── Truy vết / cô lập van ──
  // chọn 1 ống chính làm điểm vỡ, tìm van quanh nó để cô lập
  const breakPipe = pipes.find((p) => p.trunk && p.dma === "DMA-04") || pipes[20];
  const isoValves = valves.filter((v) => v.dma === breakPipe.dma).slice(0, 5);
  const isolation = {
    target: breakPipe.id, targetMid: midOf(breakPipe),
    valves: isoValves.map((v) => v.id),
    affectedPipes: pipes.filter((p) => p.dma === breakPipe.dma).slice(0, 14).map((p) => p.id),
    affectedConns: connections.filter((c) => c.dma === breakPipe.dma).length,
    estPop: connections.filter((c) => c.dma === breakPipe.dma).length * 3.4,
  };

  // ── Import khảo sát ──
  const importJobs = [
    { id: "IMP-2041", file: "khaosat_THD_rtk.geojson", fmt: "GeoJSON", src: "GPS RTK", rows: 1284, ok: 1271, err: 13, status: "done", at: "08:42 · 23/06", by: "Phạm Khảo Sát" },
    { id: "IMP-2040", file: "daunoi_q3_batch2.csv", fmt: "CSV", src: "Nhập tay", rows: 642, ok: 598, err: 44, status: "review", at: "Hôm qua · 16:10", by: "Lê Thu Thập" },
    { id: "IMP-2039", file: "mangluoi_LeLoi.shp", fmt: "Shapefile", src: "Đo đạc", rows: 3920, ok: 3920, err: 0, status: "done", at: "21/06 · 09:30", by: "Phạm Khảo Sát" },
    { id: "IMP-2038", file: "van_2026_update.geojson", fmt: "GeoJSON", src: "GPS RTK", rows: 210, ok: 0, err: 210, status: "failed", at: "20/06 · 14:02", by: "Trần Đo Đạc" },
    { id: "IMP-2037", file: "tru_pcc_full.shp", fmt: "Shapefile", src: "Đo đạc", rows: 156, ok: 152, err: 4, status: "running", at: "Đang chạy…", by: "Phạm Khảo Sát" },
  ];
  const importErrors = [
    { row: 18, field: "geometry", msg: "Toạ độ ngoài phạm vi SRID hệ thống (VN-2000)" },
    { row: 47, field: "DN", msg: "Đường kính rỗng — không khớp lookup vật tư" },
    { row: 102, field: "geometry", msg: "Self-intersection: polyline tự cắt" },
    { row: 211, field: "dma_id", msg: "Mã DMA 'DMA-09' không tồn tại" },
    { row: 388, field: "material", msg: "Giá trị 'PVC-U2' không thuộc danh mục vật liệu" },
  ];

  // ── Change set / phê duyệt ──
  const changeSets = [
    { id: "CS-318", title: "Cập nhật tuyến ống DN300 Hai Bà Trưng", author: "Lê Biên Tập", at: "10:15 hôm nay", status: "pending", adds: 12, mods: 8, dels: 1, dma: "DMA-04", reviewer: null },
    { id: "CS-317", title: "Bổ sung 44 đấu nối Q3 (đợt 2)", author: "Lê Thu Thập", at: "Hôm qua", status: "pending", adds: 44, mods: 0, dels: 0, dma: "DMA-02", reviewer: null },
    { id: "CS-316", title: "Sửa cao độ 6 nút lưới Nguyễn Trãi", author: "Trần Đo Đạc", at: "21/06", status: "approved", adds: 0, mods: 6, dels: 0, dma: "DMA-03", reviewer: "Vũ Phê Duyệt" },
    { id: "CS-315", title: "Hủy đoạn ống cũ Lê Lợi (đã thay)", author: "Lê Biên Tập", at: "20/06", status: "rejected", adds: 0, mods: 0, dels: 9, dma: "DMA-02", reviewer: "Vũ Phê Duyệt" },
    { id: "CS-314", title: "Đồng bộ van biên DMA-01 / DMA-04", author: "Phạm Khảo Sát", at: "19/06", status: "approved", adds: 4, mods: 11, dels: 0, dma: "DMA-01", reviewer: "Vũ Phê Duyệt" },
  ];

  // ── Hiện trường ──
  const fieldObs = [
    { id: "FO-901", type: "Van rò rỉ ti", asset: valves[2] ? valves[2].id : "VAL-003", by: "Đội HT 1", at: "07:50", sync: "synced", photo: true, note: "Ti van rỉ nước, đề nghị thay gioăng" },
    { id: "FO-900", type: "Sai vị trí trụ PCC", asset: hydrants[0] ? hydrants[0].id : "HYD-001", by: "Đội HT 2", at: "Hôm qua", sync: "conflict", photo: true, note: "Trụ lệch 6m so với bản đồ" },
    { id: "FO-899", type: "Bổ sung đồng hồ tổng", asset: "—", by: "Đội HT 1", at: "Hôm qua", sync: "pending", photo: false, note: "Lắp mới đồng hồ DN100 đầu tuyến" },
    { id: "FO-898", type: "Nắp hố ga vỡ", asset: nodes[12] ? nodes[12].id : "ND-22", by: "Đội HT 3", at: "21/06", sync: "synced", photo: true, note: "" },
  ];
  const offlinePkgs = [
    { id: "OP-12", dma: "DMA-04", area: "Hai Bà Trưng", assets: 642, size: "18 MB", by: "Đội HT 1", state: "active", expires: "25/06" },
    { id: "OP-11", dma: "DMA-02", area: "Lê Lợi", assets: 410, size: "11 MB", by: "Đội HT 2", state: "syncing", expires: "24/06" },
    { id: "OP-10", dma: "DMA-03", area: "Nguyễn Trãi", assets: 388, size: "9 MB", by: "Đội HT 3", state: "expired", expires: "20/06" },
  ];

  // ── Vai trò ──
  const ROLES = [
    { id: "GIS_VIEWER", label: "Xem bản đồ & thông tin tài sản", n: 86 },
    { id: "GIS_EDITOR", label: "Thêm / sửa geometry & thuộc tính", n: 24 },
    { id: "GIS_REVIEWER", label: "Phê duyệt change set", n: 6 },
    { id: "SURVEYOR", label: "Tải & đồng bộ dữ liệu khảo sát", n: 14 },
    { id: "NETWORK_ENGINEER", label: "Topology, truy vết, cô lập van", n: 9 },
    { id: "GIS_ADMIN", label: "Quản lý layer, style, hệ toạ độ, phân quyền", n: 3 },
  ];

  // ── Luồng dữ liệu ──
  const DATAFLOW = {
    inputs: [
      { src: "EAM", label: "Lý lịch tài sản" },
      { src: "CIS / Billing", label: "Khách hàng & đồng hồ" },
      { src: "Monitoring", label: "Vị trí thiết bị" },
      { src: "DMA Mgmt", label: "Boundary DMA" },
      { src: "Hiện trường", label: "Dữ liệu đo đạc" },
    ],
    outputs: [
      "gis.asset-spatial.created", "gis.asset-spatial.updated", "gis.topology.changed",
      "gis.change-set.approved", "gis.network-isolation.calculated",
    ],
  };

  // ── Service liên thông (microservice anh em trong khối Mạng lưới cấp nước) ──
  const SERVICES = {
    scada:     { id: "scada",     label: "Giám sát mạng lưới",        sub: "SCADA / IoT realtime",     icon: "IcActivity",  col: "#0969DA" },
    hydraulic: { id: "hydraulic", label: "Mô phỏng thuỷ lực",          sub: "Hydraulic · Digital Twin", icon: "IcWaves",     col: "#8250DF" },
    dmamgmt:   { id: "dmamgmt",   label: "Quản lý phân vùng DMA",       sub: "DMA · Bulk Meter · PRV",   icon: "IcGridSq",    col: "#1A7F37" },
    nrw:       { id: "nrw",       label: "Đối soát & phân tích thất thoát", sub: "NRW · Cân bằng nước",  icon: "IcTarget",    col: "#D86C1F" },
    pma:       { id: "pma",       label: "Quản lý áp lực mạng",          sub: "PMA · PRV · Critical Point", icon: "IcSliders", col: "#0E7C86" },
    eam:       { id: "eam",       label: "Quản lý tài sản mạng",         sub: "EAM · Lý lịch tài sản",    icon: "IcBriefcase", col: "#566270" },
    cmms:      { id: "cmms",      label: "Bảo trì – Sửa chữa",           sub: "CMMS · Phiếu công việc",   icon: "IcWrench",    col: "#9A6700" },
  };
  // trạng thái liên kết: linked = đang liên thông trực tiếp; open = có việc/cảnh báo đang mở; push = có thể đẩy / lập lịch
  const LINK_STATE = {
    linked: { label: "Đã liên kết", col: "#1A7F37" },
    open:   { label: "Đang mở",     col: "#D1242F" },
    push:   { label: "Có thể đẩy",  col: "#7E8997" },
  };
  function hashNum(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  // Trả về danh sách service mà 1 tài sản GIS liên thông tới + hành động ngữ cảnh
  function assetLinks(a) {
    if (!a) return [];
    const h = hashNum(a.id);
    const out = [];
    const g = a.geomRef || {};
    if (a.type === "pipe") {
      out.push({ id: "eam", status: "linked", detail: "Lý lịch ống · " + a.code });
      out.push({ id: "hydraulic", status: "linked", detail: "Link mô hình thuỷ lực" });
      if (g.trunk) out.push({ id: "scada", status: h % 3 === 0 ? "linked" : "push", detail: h % 3 === 0 ? "Cảm biến lưu lượng đầu tuyến" : "Chưa gắn cảm biến" });
      out.push({ id: "dmamgmt", status: "linked", detail: "Thuộc " + a.dma });
      if (g.status === "leak") out.push({ id: "cmms", status: "open", detail: "Phiếu sửa rò rỉ đang mở" });
      else if (g.cond === "poor") out.push({ id: "cmms", status: "push", detail: "Đề xuất kiểm tra định kỳ" });
    } else if (a.type === "valve") {
      out.push({ id: "eam", status: "linked", detail: "Lý lịch van · " + a.code });
      out.push({ id: "hydraulic", status: "linked", detail: "Phần tử van mô hình" });
      if (g.kind === "boundary") { out.push({ id: "dmamgmt", status: "linked", detail: "Van biên " + a.dma }); out.push({ id: "nrw", status: "linked", detail: "Ranh cân bằng nước DMA" }); }
      if (h % 4 === 0) out.push({ id: "scada", status: "linked", detail: "Cảm biến đóng/mở van" });
      out.push({ id: "cmms", status: h % 5 === 0 ? "open" : "push", detail: h % 5 === 0 ? "Phiếu vận hành van đang mở" : "Lịch vận hành van định kỳ" });
    } else if (a.type === "hydrant") {
      out.push({ id: "eam", status: "linked", detail: "Lý lịch trụ · " + a.code });
      out.push({ id: "cmms", status: a.status === "leak" ? "open" : "push", detail: a.status === "leak" ? "Phiếu kiểm tra trụ" : "Lịch xúc xả định kỳ" });
    } else if (a.type === "pump") {
      out.push({ id: "scada", status: "linked", detail: "Realtime: bơm chạy · áp đẩy" });
      out.push({ id: "pma", status: "linked", detail: "Điểm điều áp PMA" });
      out.push({ id: "eam", status: "linked", detail: "Lý lịch trạm bơm" });
      out.push({ id: "hydraulic", status: "linked", detail: "Phần tử bơm mô hình" });
      out.push({ id: "cmms", status: "push", detail: "Bảo trì dự đoán bơm" });
    } else if (a.type === "reservoir") {
      out.push({ id: "scada", status: "linked", detail: "Realtime: mực nước · lưu lượng" });
      out.push({ id: "eam", status: "linked", detail: "Lý lịch bể / đài nước" });
      out.push({ id: "hydraulic", status: "linked", detail: "Nút áp lực mô hình" });
      out.push({ id: "dmamgmt", status: "linked", detail: "Cấp cho " + a.dma });
    } else if (a.type === "dma") {
      out.push({ id: "dmamgmt", status: "linked", detail: "Hồ sơ vùng DMA" });
      out.push({ id: "nrw", status: "linked", detail: "Cân bằng nước & %NRW" });
      out.push({ id: "pma", status: "linked", detail: "Quản lý áp lực vùng" });
      out.push({ id: "scada", status: "linked", detail: "Đồng hồ tổng đầu vào" });
    } else if (a.type === "node") {
      out.push({ id: "hydraulic", status: "linked", detail: "Nút giao mô hình · " + (a.code || a.id) });
    }
    return out;
  }

  // ── KPI tổng quan ──
  const totalLenM = pipes.filter((p) => p.status !== "abandoned").reduce((s, p) => s + p.lenM, 0);
  const DASH = {
    pipeKm: totalLenM / 1000,
    pipeCount: pipes.length, valveCount: valves.length, hydrantCount: hydrants.length,
    connCount: connections.length, dmaCount: dmas.length,
    topoOpen: topoIssues.filter((t) => t.status === "open").length,
    csPending: changeSets.filter((c) => c.status === "pending").length,
    importPending: importJobs.filter((j) => j.status === "review" || j.status === "running").length,
    fieldPending: fieldObs.filter((f) => f.sync !== "synced").length,
    geocodedPct: Math.round((connections.filter((c) => c.geocoded).length / connections.length) * 100),
    rtkPct: Math.round((connections.filter((c) => c.gpsRtk).length / connections.length) * 100),
    condMix: ["good", "fair", "poor", "critical"].map((k) => ({ k, label: COND[k].label, col: COND[k].col, n: pipes.filter((p) => p.cond === k).length })),
    matMix: MATERIALS.map((m) => ({ label: m, n: pipes.filter((p) => p.material === m).length })),
  };

  window.GIS = {
    TODAY: "23/06/2026", SRID: "VN-2000 (EPSG:3405)", world: { w: W, h: H },
    nodes, pipes, pipeBy, valves, hydrants, plant, reservoirs, pumps, dmas, blocks, parks, river, lake,
    connDots, connections, LAYERS, assets, ASSET_TYPES, COND, PSTATUS, MATERIALS, CTYPE,
    TOPO_KINDS, topoIssues, isolation, importJobs, importErrors, changeSets, fieldObs, offlinePkgs,
    ROLES, DATAFLOW, DASH, midOf,
    SERVICES, LINK_STATE, assetLinks,
  };
})();
