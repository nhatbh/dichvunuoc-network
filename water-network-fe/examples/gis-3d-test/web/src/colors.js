// Thang màu cho các đại lượng tô ống/nút. Mỗi thang: các mốc [giá trị, màu] nội suy tuyến tính.
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function ramp(stops) {
  const s = stops.map(([v, c]) => [v, hex(c)]);
  return (x) => {
    if (x == null || Number.isNaN(x)) return [150, 150, 150];
    if (x <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (x <= s[i][0]) {
        const t = (x - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        return s[i - 1][1].map((a, k) => Math.round(a + (s[i][1][k] - a) * t));
      }
    }
    return s[s.length - 1][1];
  };
}

export const METRICS = {
  pressure: {
    label: "Áp lực (m)",
    unit: "m",
    stops: [[0, "#7f0000"], [10, "#d7301f"], [15, "#fc8d59"], [20, "#fee08b"], [30, "#91cf60"], [45, "#1a9850"], [60, "#2166ac"], [75, "#542788"]],
  },
  flow: {
    label: "Lưu lượng (L/s)",
    unit: "L/s",
    stops: [[0, "#bdbdbd"], [0.05, "#9ecae1"], [0.5, "#4292c6"], [2, "#2171b5"], [10, "#08519c"], [30, "#08306b"]],
  },
  velocity: {
    label: "Vận tốc (m/s)",
    unit: "m/s",
    stops: [[0, "#8c6d31"], [0.1, "#bdbdbd"], [0.3, "#74c476"], [0.8, "#31a354"], [1.2, "#fd8d3c"], [1.5, "#e31a1c"], [2.5, "#67000d"]],
  },
  pipeAge: {
    label: "Tuổi ống (năm) [giả định]",
    unit: "năm",
    stops: [[0, "#1a9850"], [5, "#91cf60"], [15, "#fee08b"], [30, "#fc8d59"], [50, "#d73027"]],
  },
  waterAge: {
    label: "Tuổi nước (giờ)",
    unit: "h",
    stops: [[0, "#2166ac"], [4, "#67a9cf"], [8, "#a6dba0"], [16, "#fee08b"], [24, "#f46d43"], [48, "#a50026"]],
  },
  diameter: {
    label: "Đường kính (mm)",
    unit: "mm",
    categorical: true,
    cats: { 315: "#08306b", 225: "#2171b5", 160: "#6a51a3", 110: "#238b45", 90: "#d94801", 63: "#e7298a", 50: "#737373" },
  },
  dma: {
    label: "Khu DMA đề xuất",
    categorical: true,
    cats: { DMA1: "#1b9e77", DMA2: "#d95f02", DMA3: "#7570b3", DMA4: "#e7298a", DMA5: "#66a61e", DMA6: "#e6ab02", DMA7: "#a6761d" },
  },
};

const fns = {};
for (const [k, m] of Object.entries(METRICS)) {
  if (m.categorical) fns[k] = (v) => hex(m.cats[v] || "#999999");
  else fns[k] = ramp(m.stops);
}
export const colorFor = (metric, v) => fns[metric](v);
export const pressureColor = fns.pressure;
export const rgb = (c, a = 255) => [...c, a];
export const cssColor = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
