"""Cấu hình chung cho toàn bộ pipeline. Mọi giá trị GIẢ ĐỊNH được đánh dấu [GĐ] và liệt kê trong báo cáo."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DXF = ROOT / "data/raw/vinh_thinh.dxf"
INTERIM = ROOT / "data/interim"
OUT = ROOT / "output"
WEB_DATA = ROOT / "web/public/data"

# --- Bước 2: topology ---------------------------------------------------------
SNAP_TOL = 0.5          # m — gộp điểm cách nhau < 0.5 m (theo yêu cầu)
NEAR_MISS_TOL = 3.0     # m — khe hở 0.5–3 m giữa đầu ống và ống khác: báo lỗi "nút treo/hở"
AUTOFIX_GAP = 2.0       # m [GĐ] khe hở ≤ 2 m làm cô lập mạng con thì tự nối (có ghi lỗi)

# Layer ống -> đường kính ngoài OD (mm). Đã được người dùng xác nhận.
PIPE_LAYERS = {"50": 50, "63": 63, "90": 90, "110": 110, "160": 160, "225": 225, "315": 315}
EXCLUDE_LINETYPES = {"ZIGZAG"}   # đường ranh giới khu vực trên layer 63 (đã xác nhận)
SERVICE_OD = {50, 63}            # ống dịch vụ (thiết kế mới); còn lại là ống phân phối/truyền dẫn hiện có

# [GĐ] Vật liệu HDPE PE100 PN10 (SDR17) cho toàn bộ — bản vẽ không ghi vật liệu.
# Đường kính trong = OD − 2·e, e theo ISO 4427 / TCVN 7305 SDR17.
WALL_SDR17_MM = {50: 3.0, 63: 3.8, 90: 5.4, 110: 6.6, 160: 9.5, 225: 13.4, 315: 18.7}
MATERIAL = "HDPE PE100 PN10"
# [GĐ] Hệ số Hazen-Williams: ống dịch vụ mới C=140; ống chính hiện có C=130 (đã vận hành, có lắng cặn).
HW_C_SERVICE = 140
HW_C_MAIN = 130
# [GĐ] Năm lắp đặt: ống dịch vụ = 2025 (dự án mới), ống chính = 2012 (chưa có hồ sơ).
YEAR_SERVICE = 2025
YEAR_MAIN = 2012
REF_YEAR = 2026

# --- Bước 3: tọa độ -----------------------------------------------------------
# VN-2000, kinh tuyến trục 105°00' (Vĩnh Phúc cũ), múi 3°, k0=0.9999; towgs84 theo TT 973/2001/TT-TCĐC.
VN2000_PROJ = ("+proj=tmerc +lat_0=0 +lon_0=105 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 "
               "+towgs84=-191.90441,-39.30318,-111.45032,-0.00928836,0.01975479,-0.00427372,0.252906278 "
               "+units=m +no_defs")

# --- Bước 5: thủy lực -----------------------------------------------------------
PERSONS_PER_HH = 4.0          # [GĐ] người/hộ (nông thôn ĐBSH)
HH_PER_M_SERVICE = 1 / 15.0   # [GĐ] 1 hộ đấu nối / 15 m ống dịch vụ (nhà hai bên ngõ, mặt tiền 6–8 m, ~50% lấp đầy)
LPCD = 100.0                  # [GĐ] L/người/ngày — QCVN 01:2021/BXD khu dân cư nông thôn
OTHER_DEMAND_FACTOR = 1.10    # [GĐ] +10% dịch vụ công cộng, trường học, kinh doanh nhỏ
SOURCE_HEAD_ABOVE_GROUND = 2.0  # [GĐ] mực nước bể chứa trạm bơm cao hơn mặt đất 2 m
N_PUMPS = 2                   # [GĐ] 2 bơm chạy song song tại đầu ống D315 phía Bắc
PUMP_DESIGN_HEAD = 32.0       # [GĐ] cột áp bơm tại điểm thiết kế (m)
PUMP_EFF = 0.75               # [GĐ] hiệu suất bơm+động cơ
LEAK_TARGET_NRW = 0.18        # [GĐ] tỷ lệ rò rỉ nền ~18% (mạng mới ở nông thôn VN 15–25%)
LEAK_EMITTER_EXP = 1.0        # [GĐ] số mũ rò rỉ (ống nhựa, FAVAD N1≈1.0)

P_LOW = 10.0     # m — áp lực phục vụ tối thiểu (TCVN 33:2006, nhà 1 tầng)
P_HIGH = 60.0    # m
V_HIGH = 1.5     # m/s
V_LOW = 0.1      # m/s
FIRE_FLOW_LPS = 10.0  # [GĐ] 1 đám cháy 10 L/s trong 2 giờ (TCVN 2622 cho khu dân cư < 5 000 người/điểm)
LEAK_TEST_LPS = 2.0   # [GĐ] rò rỉ ẩn để thử bộ phân tích
GROWTH = 1.25         # tăng nhu cầu 25%
