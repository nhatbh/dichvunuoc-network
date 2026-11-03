#!/usr/bin/env bash
# Chạy toàn bộ pipeline: DWG/DXF → topology → WGS84 → cao độ → EPANET → phân tích/kịch bản → dữ liệu web.
set -euo pipefail
cd "$(dirname "$0")"

RAW=data/raw
if [ ! -f "$RAW/vinh_thinh.dxf" ]; then
  echo ">> Đổi DWG → DXF (cần LibreDWG: dwg2dxf)"
  dwg2dxf -y -o "$RAW/vinh_thinh.dxf" "$RAW/vinh_thinh.dwg"
fi

DEM=data/dem/cop30_N21_E105.tif
if [ ! -f "$DEM" ]; then
  echo ">> Tải DEM Copernicus GLO-30 (ô N21 E105, ~50 MB)"
  mkdir -p data/dem
  curl -sSL -o "$DEM" "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N21_00_E105_00_DEM/Copernicus_DSM_COG_10_N21_00_E105_00_DEM.tif"
fi

cd scripts
python3 01_inspect_dxf.py ../data/raw/vinh_thinh.dxf > ../output/step1/inspect_log.txt
python3 01b_preview.py ../data/raw/vinh_thinh.dxf ../output/step1/preview_layers.png
python3 02_build_network.py
python3 02b_preview.py
python3 03_to_wgs84.py
python3 04_elevation.py
python3 05_hydraulic_model.py
python3 06_analysis.py      # ~5 phút (ma trận độ nhạy rò rỉ, lưu tạm ở data/model/_run/sig.pkl)
python3 07_export_web.py
echo ">> Xong. Chạy web: cd web && npm install && npm run dev"
