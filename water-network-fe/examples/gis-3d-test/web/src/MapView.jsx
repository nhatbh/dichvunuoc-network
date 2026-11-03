import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl); // MapLibre 6: chỉ rõ file worker sau khi Vite đóng gói
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer, ColumnLayer, IconLayer, LineLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { colorFor, pressureColor } from "./colors.js";
import { ICONS } from "./icons.js";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const WIDTH = { 50: 2, 63: 2.6, 90: 3.6, 110: 4.2, 160: 5.2, 225: 6.4, 315: 7.6 };
const LOOP = 60; // giây hoạt ảnh của 1 vòng hạt
const GAP = 4; // giây giữa 2 hạt liên tiếp trên 1 ống

function metersBetween(a, b) {
  const k = Math.PI / 180, R = 6371000;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.sqrt(x * x + y * y) * R;
}

// Giá trị tô màu ống theo đại lượng đang chọn tại giờ h
export function pipeValue(metric, net, scen, i, h, refYear) {
  const p = net.pipes[i];
  switch (metric) {
    case "pressure": {
      const a = net.nodeIndex[p.n0], b = net.nodeIndex[p.n1];
      return (scen.pressure[a][h] + scen.pressure[b][h]) / 2;
    }
    case "flow": return Math.abs(scen.flow[i][h]);
    case "velocity": return Math.abs(scen.velocity[i][h]);
    case "pipeAge": return refYear - p.year;
    case "waterAge": {
      if (!scen.age) return null;
      const a = net.nodeIndex[p.n0], b = net.nodeIndex[p.n1];
      return Math.max(scen.age[a][h], scen.age[b][h]);
    }
    case "diameter": return p.od;
    case "dma": return p.dma;
    default: return null;
  }
}

export default function MapView({ net, ana, scen, hour, metric, show, is3D, initialView, selection, onSelect, flyTo, onMapReady }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);

  // ---- khởi tạo bản đồ ----
  useEffect(() => {
    const xs = net.nodes.map((n) => n.ll[0]), ys = net.nodes.map((n) => n.ll[1]);
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      ...(initialView
        ? { center: [initialView[0], initialView[1]], zoom: initialView[2], pitch: is3D ? 60 : 0, bearing: is3D ? -25 : 0 }
        : { bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], fitBoundsOptions: { padding: 40 } }),
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // interleaved=false: canvas deck.gl riêng phía trên bản đồ (chế độ interleaved chưa tương thích MapLibre 6)
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);
    map.on("load", () => {
      // nhãn tiếng Việt (OSM name:vi → name)
      for (const l of map.getStyle().layers) {
        if (/shield/.test(l.id)) { map.setLayoutProperty(l.id, "visibility", "none"); continue; } // style thiếu sprite biển số
        if (l.type === "symbol" && map.getLayoutProperty(l.id, "text-field") != null) {
          map.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:vi"], ["get", "name"]]);
        }
      }
      setReady(true); onMapReady?.(map);
    });
    mapRef.current = map; overlayRef.current = overlay;
    return () => map.remove();
  }, [net]);

  // ---- 2D / 3D ----
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    m.easeTo(is3D ? { pitch: 60, bearing: -25, duration: 900 } : { pitch: 0, bearing: 0, duration: 700 });
  }, [is3D]);

  // ---- bay tới đối tượng ----
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    if (flyTo.bounds) mapRef.current.fitBounds(flyTo.bounds, { padding: 80, maxZoom: 17, duration: 900 });
    else mapRef.current.flyTo({ center: flyTo.center, zoom: flyTo.zoom || 17, duration: 900 });
  }, [flyTo]);

  // ---- hoạt ảnh hạt ----
  useEffect(() => {
    if (!show.particles) return;
    let raf, last = performance.now();
    const tick = (t) => { setTime((x) => (x + (t - last) / 1000) % LOOP); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [show.particles]);

  // độ dài tích lũy mỗi ống (m)
  const cum = useMemo(() => net.pipes.map((p) => {
    const c = [0];
    for (let k = 1; k < p.path.length; k++) c.push(c[k - 1] + metersBetween(p.path[k - 1], p.path[k]));
    return c;
  }), [net]);

  const trips = useMemo(() => {
    if (!scen || !show.particles) return [];
    const out = [];
    net.pipes.forEach((p, i) => {
      const q = scen.flow[i][hour], v = Math.abs(scen.velocity[i][hour]);
      if (Math.abs(q) < 0.005) return; // < 0.005 L/s coi như đứng yên
      const speed = 12 + 110 * Math.min(v, 2); // m / giây hoạt ảnh (tỉ lệ với vận tốc thật)
      let path = p.path, c = cum[i];
      if (q < 0) { path = [...path].reverse(); const L = c[c.length - 1]; c = c.map((x) => L - x).reverse(); }
      const ts = c.map((d) => d / speed);
      for (let s = 0; s < LOOP; s += GAP) out.push({ path, ts: ts.map((t) => t + s), od: p.od });
    });
    return out;
  }, [scen, hour, show.particles, cum, net]);

  const scenMeta = scen?.meta || {};
  const lostSet = useMemo(() => new Set(scenMeta.lost_nodes || []), [scen]);
  const segSet = useMemo(() => new Set(scenMeta.segment_pipes || []), [scen]);

  const layers = useMemo(() => {
    if (!scen) return [];
    const L = [];
    const sel = selection;
    // nền: viền trắng cho ống để nổi trên bản đồ
    L.push(new PathLayer({
      id: "pipes-casing", data: net.pipes, getPath: (p) => p.path, getWidth: (p) => WIDTH[p.od] + 2.5,
      widthUnits: "pixels", getColor: [255, 255, 255, 230], capRounded: true, jointRounded: true,
    }));
    // đối tượng đang chọn (vẽ dưới ống để không che hạt dòng chảy)
    if (sel?.type === "pipe") {
      const p = net.pipes[net.pipeIndex[sel.id]];
      if (p) L.push(new PathLayer({ id: "sel-pipe", data: [p], getPath: (d) => d.path, getColor: [0, 255, 255, 180], getWidth: WIDTH[p.od] + 8, widthUnits: "pixels" }));
    }
    if (sel?.type === "node") {
      const n = net.nodes[net.nodeIndex[sel.id]];
      if (n) L.push(new ScatterplotLayer({ id: "sel-node", data: [n], getPosition: (d) => d.ll, radiusUnits: "pixels", getRadius: 12, filled: false, stroked: true, getLineColor: [0, 230, 255], lineWidthMinPixels: 4 }));
    }
    L.push(new PathLayer({
      id: "pipes", data: net.pipes, getPath: (p) => p.path, pickable: true, autoHighlight: true,
      highlightColor: [0, 255, 255, 200], widthUnits: "pixels", capRounded: true, jointRounded: true,
      getWidth: (p) => WIDTH[p.od],
      getColor: (p, { index }) => {
        if (segSet.has(p.id)) return [40, 40, 40, 255];
        if (lostSet.has(p.n0) && lostSet.has(p.n1)) return [170, 170, 170, 200];
        return [...colorFor(metric, pipeValue(metric, net, scen, index, hour, ana.ref_year)), 255];
      },
      updateTriggers: { getColor: [metric, hour, scen.key] },
    }));
    if (show.particles) {
      L.push(new TripsLayer({
        id: "particles", data: trips, getPath: (d) => d.path, getTimestamps: (d) => d.ts,
        getColor: [255, 255, 255], opacity: 1, widthUnits: "pixels", getWidth: (d) => WIDTH[d.od] + 2.5,
        capRounded: true, jointRounded: true, trailLength: 2, fadeTrail: true, currentTime: time,
      }));
    }
    if (show.loops) {
      L.push(new PathLayer({
        id: "loops", data: ana.loops, getPath: (d) => d.line, getColor: [0, 200, 120, 220], getWidth: 6,
        widthUnits: "pixels", pickable: true,
      }));
    }
    if (show.nodes) {
      L.push(new ScatterplotLayer({
        id: "nodes", data: net.nodes, getPosition: (n) => n.ll, pickable: true, autoHighlight: true,
        radiusUnits: "meters", getRadius: (n) => (n.hh > 0 ? 2.2 : 1.5), radiusMinPixels: 1.8, radiusMaxPixels: 7,
        stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 0.5,
        getFillColor: (n, { index }) => (lostSet.has(n.id) ? [120, 120, 120] : pressureColor(scen.pressure[index][hour])),
        updateTriggers: { getFillColor: [hour, scen.key] },
      }));
    }
    if (show.columns) {
      L.push(new ColumnLayer({
        id: "columns", data: net.nodes.filter((n) => n.hh > 0 || n.tags.includes("daudai")), diskResolution: 10, radius: 2.2,
        extruded: true, pickable: true, elevationScale: 1,
        getPosition: (n) => n.ll,
        getElevation: (n) => Math.max(0, scen.pressure[net.nodeIndex[n.id]][hour]) * 1.5, // phóng đại ×1,5
        getFillColor: (n) => pressureColor(scen.pressure[net.nodeIndex[n.id]][hour]),
        updateTriggers: { getElevation: [hour, scen.key], getFillColor: [hour, scen.key] },
      }));
    }
    // cảnh báo động: nút áp lực < ngưỡng tại giờ đang xem
    const th = ana.thresholds;
    const lowNow = net.nodes.filter((n, i) => n.hh > 0 && !lostSet.has(n.id) && scen.pressure[i][hour] < th.p_low);
    if (show.warnings && lowNow.length) {
      L.push(new ScatterplotLayer({
        id: "low-now", data: lowNow, getPosition: (n) => n.ll, radiusUnits: "pixels", getRadius: 9,
        stroked: true, filled: false, getLineColor: [215, 48, 31, 230], lineWidthMinPixels: 2.5, pickable: true,
      }));
    }
    if (show.warnings) {
      L.push(new IconLayer({
        id: "issues", data: ana.issues, getPosition: (d) => d.lonlat, pickable: true,
        getIcon: (d) => (d.severity === "do" ? ICONS.pinRed : ICONS.pinYellow), getSize: (d) => (d.severity === "do" ? 30 : 22), sizeUnits: "pixels",
      }));
    }
    if (show.errors) {
      const errs = ana.errors.filter((e) => e.severity !== "info" && e.kind !== "nhan_khac_layer");
      L.push(new ScatterplotLayer({
        id: "errors", data: errs, getPosition: (e) => e.ll, radiusUnits: "pixels", getRadius: 11, filled: false,
        stroked: true, lineWidthMinPixels: 3, pickable: true,
        getLineColor: (e) => (e.severity === "do" ? [200, 0, 160] : [255, 140, 0]),
      }));
      L.push(new TextLayer({
        id: "errors-label", data: errs, getPosition: (e) => e.ll, getText: (e) => e.id, getSize: 11, getPixelOffset: [0, -18],
        getColor: [120, 0, 100], background: true, getBackgroundColor: [255, 255, 255, 220], fontWeight: 700,
      }));
    }
    if (show.valves) {
      L.push(new ScatterplotLayer({
        id: "valves", data: ana.valves, pickable: true, radiusUnits: "pixels", getRadius: 3.5,
        getPosition: (v) => {
          // vẽ van lệch 3 m từ nút về phía ống
          const n = net.nodes[net.nodeIndex[v.node]].ll, p = net.pipes[net.pipeIndex[v.pipe]];
          const other = p.n0 === v.node ? p.path[1] : p.path[p.path.length - 2];
          const d = metersBetween(n, other) || 1, t = Math.min(1, 3 / d);
          return [n[0] + (other[0] - n[0]) * t, n[1] + (other[1] - n[1]) * t];
        },
        getFillColor: [20, 20, 20], stroked: true, getLineColor: [255, 212, 0], lineWidthMinPixels: 1.5,
      }));
    }
    if (show.sensors) {
      L.push(new IconLayer({
        id: "sensors", data: ana.sensors.map((s) => net.nodes[net.nodeIndex[s]]), getPosition: (n) => n.ll,
        getIcon: () => ICONS.logger, getSize: 24, pickable: true,
      }));
      L.push(new IconLayer({
        id: "meters", data: ana.dma.filter((d) => net.pipeIndex[d.meter_pipe] != null), pickable: true,
        getPosition: (d) => { const p = net.pipes[net.pipeIndex[d.meter_pipe]].path; return p[Math.floor(p.length / 2)]; },
        getIcon: () => ICONS.meter, getSize: 26,
      }));
    }
    // nguồn
    const src = net.nodes[net.nodeIndex["SRC"]];
    L.push(new IconLayer({ id: "source", data: [src], getPosition: (n) => n.ll, getIcon: () => ICONS.source, getSize: 34, pickable: true }));
    // lớp theo kịch bản
    if (scenMeta.valves_to_close) {
      L.push(new IconLayer({ id: "close-valves", data: scenMeta.valves_to_close, getPosition: (v) => v.lonlat, getIcon: () => ICONS.valve, getSize: 22, pickable: true }));
    }
    if (scenMeta.node && scen.key === "chua_chay") {
      L.push(new IconLayer({ id: "fire", data: [scenMeta], getPosition: (d) => d.lonlat, getIcon: () => ICONS.fire, getSize: 40, pickable: true }));
    }
    if (scenMeta.true_lonlat) {
      L.push(new LineLayer({ id: "leak-err", data: [scenMeta], getSourcePosition: (d) => d.true_lonlat, getTargetPosition: (d) => d.est_lonlat, getColor: [8, 81, 156], getWidth: 3 }));
      L.push(new IconLayer({ id: "leak-est", data: [scenMeta], getPosition: (d) => d.est_lonlat, getIcon: () => ICONS.leakEst, getSize: 34, pickable: true }));
      L.push(new IconLayer({ id: "leak-true", data: [scenMeta], getPosition: (d) => d.true_lonlat, getIcon: () => ICONS.leakTrue, getSize: 40, pickable: true }));
    }
    return L;
  }, [net, ana, scen, hour, metric, show, trips, time, selection, lostSet, segSet]);

  useEffect(() => {
    if (!overlayRef.current || !ready) return;
    overlayRef.current.setProps({
      layers,
      onClick: (info) => {
        if (!info.object) return;
        const id = info.layer.id, o = info.object;
        if (id === "pipes") onSelect({ type: "pipe", id: o.id });
        else if (id === "nodes" || id === "columns" || id === "low-now" || id === "source" || id === "sensors") onSelect({ type: "node", id: o.id });
        else if (id === "issues") onSelect({ type: "issue", id: o.id });
        else if (id === "errors") onSelect({ type: "error", id: o.id });
        else if (id === "valves" || id === "close-valves") onSelect({ type: "pipe", id: o.pipe });
        else if (id === "loops") onSelect({ type: "loop", obj: o });
        else if (id === "meters") onSelect({ type: "pipe", id: o.meter_pipe });
        else if (id.startsWith("leak") || id === "fire") onSelect({ type: "node", id: o.true_node || o.node });
      },
      getTooltip: ({ object, layer }) => {
        if (!object) return null;
        const id = layer.id;
        if (id === "pipes") {
          const i = net.pipeIndex[object.id];
          return { text: `${object.id} · D${object.od} · ${object.len.toFixed(0)} m\nQ = ${scen.flow[i][hour].toFixed(2)} L/s · v = ${Math.abs(scen.velocity[i][hour]).toFixed(2)} m/s` };
        }
        if (id === "nodes" || id === "columns" || id === "low-now") {
          const i = net.nodeIndex[object.id];
          return { text: `${object.id}${object.kt ? " (" + object.kt + ")" : ""}\nÁp lực ${scen.pressure[i][hour].toFixed(1)} m · cao độ ${object.elev.toFixed(1)} m · ${object.hh.toFixed(1)} hộ` };
        }
        if (id === "issues") return { text: `${object.id}: ${object.title}` };
        if (id === "errors") return { text: `${object.id}: ${object.msg}` };
        if (id === "valves") return { text: `Van giả định trên ${object.pipe} tại ${object.node}` };
        if (id === "close-valves") return { text: `Đóng van: ${object.pipe} tại ${object.node}` };
        if (id === "loops") return { text: `Đề xuất mạch vòng ${object.from_node}–${object.to_node} D${object.od_mm} ~${object.length_m} m` };
        if (id === "sensors") return { text: `Logger áp lực đề xuất tại ${object.id}` };
        if (id === "meters") return { text: `Đồng hồ ${object.id} (${object.hh} hộ) trên ${object.meter_pipe}` };
        if (id === "source") return { text: "Trạm bơm / nguồn (giả định)" };
        if (id === "leak-true") return { text: `Rò rỉ thật (ẩn): ${object.true_node}` };
        if (id === "leak-est") return { text: `Vị trí ước tính: ${object.est_node} — sai số ${object.err_m} m` };
        if (id === "fire") return { text: `Trụ cứu hỏa giả định ${object.node}` };
        return null;
      },
    });
  }, [layers, ready]);

  return <div ref={box} className="map" />;
}
