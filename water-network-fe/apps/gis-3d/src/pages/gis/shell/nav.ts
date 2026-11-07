/* GIS shell — navigation model (ported from app.jsx NAV / TITLES / SECOF). */
export interface Route {
  name: string
  focusAsset?: { id: string }
  openQuery?: boolean
  branch?: string
  importJob?: string
  /** ops: the sensor shown in Chi tiết cảm biến / the marker opened in Rò rỉ & bảo trì */
  sensor?: string
  marker?: string
}

export interface NavItem {
  id: string
  label: string
  sub: string
  icon: string
  badge?: 'topo' | 'imp' | 'field' | 'cs'
}
export interface NavGroup {
  sec: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  { sec: 'Tổng quan', items: [{ id: 'dashboard', label: 'Tổng quan GIS', sub: 'Tài sản · topology · luồng dữ liệu', icon: 'IcGridSq' }] },
  {
    sec: 'Bản đồ & Tài sản',
    items: [
      { id: 'map', label: 'Bản đồ mạng lưới', sub: 'Lớp · zoom · inspector', icon: 'IcMap' },
      { id: 'editor', label: 'Biên tập mạng lưới', sub: 'Vẽ ống · gắn tài sản · change set', icon: 'IcPencil' },
      { id: 'assets', label: 'Tài sản không gian', sub: 'Point · line · polygon', icon: 'IcPipe' },
    ],
  },
  {
    sec: 'Phân tích mạng',
    items: [
      { id: 'topology', label: 'Kiểm tra topology', sub: 'Dangling · cô lập · cao độ', icon: 'IcGitBranch', badge: 'topo' },
      { id: 'trace', label: 'Truy vết & cô lập van', sub: 'Isolation · upstream', icon: 'IcRoute' },
      { id: 'netmodel', label: 'Mô hình liên thông', sub: 'Connectivity · xuất EPANET', icon: 'IcLink' },
    ],
  },
  { sec: 'Khách hàng', items: [{ id: 'connections', label: 'Đấu nối khách hàng', sub: 'Geocode · gán DMA', icon: 'IcPlug' }] },
  {
    sec: 'Dữ liệu & Phiên bản',
    items: [
      { id: 'import', label: 'Import CAD', sub: 'DWG · DXF · làm sạch mạng', icon: 'IcUpload', badge: 'imp' },
      { id: 'quality', label: 'Chất lượng dữ liệu', sub: 'Hoàn thiện · RTK · độ phủ', icon: 'IcShield' },
      { id: 'field', label: 'Ứng dụng hiện trường', sub: 'Offline · đồng bộ · xung đột', icon: 'IcMobile', badge: 'field' },
      { id: 'scenarios', label: 'Kịch bản mạng lưới', sub: 'Nhánh · phiên bản · so sánh', icon: 'IcGitBranch' },
      { id: 'versions', label: 'Phiên bản & phê duyệt', sub: 'Change set · audit', icon: 'IcCheckBadge', badge: 'cs' },
    ],
  },
]

export const TITLES: Record<string, string> = {
  ops: 'Vận hành',
  leaks: 'Rò rỉ & bảo trì',
  production: 'Kế hoạch sản xuất',
  sensor: 'Chi tiết cảm biến',
  layers: 'Lớp bản đồ',
  query: 'Truy vấn tài sản',
  dashboard: 'Tổng quan GIS',
  map: 'Bản đồ mạng lưới',
  'map-drafts': 'Bản đồ mạng lưới · Bản nháp',
  editor: 'Biên tập mạng lưới',
  assets: 'Tài sản không gian',
  topology: 'Kiểm tra topology',
  trace: 'Truy vết & cô lập van',
  netmodel: 'Mô hình liên thông mạng',
  connections: 'Đấu nối khách hàng',
  import: 'Import CAD lên GIS',
  quality: 'Chất lượng dữ liệu',
  field: 'Ứng dụng hiện trường',
  scenarios: 'Kịch bản mạng lưới',
  versions: 'Phiên bản & phê duyệt',
}

export const SECOF: Record<string, string> = {}
NAV.forEach((g) => g.items.forEach((it) => (SECOF[it.id] = g.sec)))

/* ── SYSTEM 3D shell: the map is the app; every screen is a dock button that
   opens a glass side panel over it (or, for the two editing workspaces, a
   full-viewport work area under the top bar). ── */
export interface PanelDef {
  id: string
  label: string
  /** dock label: one or two short words */
  short: string
  icon: string
  sub: string
  group: number
  /** wide side panel (tables, comparisons) */
  wide?: boolean
  /** full-viewport work area instead of a side panel */
  workspace?: boolean
  /** reachable by route only (not a dock button) */
  hidden?: boolean
  badge?: NavItem['badge']
}

export const PANELS: PanelDef[] = [
  { id: 'ops', label: 'Vận hành', short: 'Vận hành', icon: 'IcActivity', sub: 'Trạng thái cảm biến · cảnh báo · điểm đánh dấu', group: 0 },
  { id: 'leaks', label: 'Rò rỉ & bảo trì', short: 'Rò rỉ', icon: 'IcDroplet', sub: 'Điểm đánh dấu · cân bằng nước DMA', group: 0, wide: true },
  { id: 'production', label: 'Kế hoạch sản xuất', short: 'Sản xuất', icon: 'IcFactory', sub: 'Dự báo nhu cầu · lịch bơm · thực tế', group: 0, wide: true },
  { id: 'sensor', label: 'Chi tiết cảm biến', short: 'Cảm biến', icon: 'IcGauge', sub: 'Số đọc 24 giờ · đường nền · ngưỡng', group: 0, wide: true, hidden: true },
  { id: 'layers', label: 'Lớp bản đồ', short: 'Lớp', icon: 'IcLayers', sub: 'Hiển thị lớp · tô màu tuyến ống', group: 1 },
  { id: 'query', label: 'Truy vấn tài sản', short: 'Truy vấn', icon: 'IcFilter', sub: 'Lọc theo loại · DMA · vật liệu · tuổi', group: 1 },
  { id: 'dashboard', label: 'Tổng quan GIS', short: 'Tổng quan', icon: 'IcGridSq', sub: 'Tài sản · topology · luồng dữ liệu', group: 2 },
  { id: 'assets', label: 'Tài sản không gian', short: 'Tài sản', icon: 'IcPipe', sub: 'Point · line · polygon', group: 2, wide: true },
  { id: 'topology', label: 'Kiểm tra topology', short: 'Topology', icon: 'IcGitBranch', sub: 'Dangling · cô lập · cao độ', group: 3, badge: 'topo' },
  { id: 'trace', label: 'Truy vết & cô lập van', short: 'Truy vết', icon: 'IcRoute', sub: 'Isolation · upstream', group: 3 },
  { id: 'netmodel', label: 'Mô hình liên thông', short: 'Liên thông', icon: 'IcLink', sub: 'Connectivity · xuất EPANET', group: 3 },
  { id: 'connections', label: 'Đấu nối khách hàng', short: 'Đấu nối', icon: 'IcPlug', sub: 'Geocode · gán DMA', group: 4 },
  { id: 'quality', label: 'Chất lượng dữ liệu', short: 'Chất lượng', icon: 'IcShield', sub: 'Hoàn thiện · RTK · độ phủ', group: 5 },
  { id: 'field', label: 'Ứng dụng hiện trường', short: 'Hiện trường', icon: 'IcMobile', sub: 'Offline · đồng bộ · xung đột', group: 5, badge: 'field' },
  { id: 'scenarios', label: 'Kịch bản mạng lưới', short: 'Kịch bản', icon: 'IcGitBranch', sub: 'Nhánh · phiên bản · so sánh', group: 5, wide: true },
  { id: 'versions', label: 'Phiên bản & phê duyệt', short: 'Phê duyệt', icon: 'IcCheckBadge', sub: 'Change set · audit', group: 5, badge: 'cs', wide: true },
  { id: 'editor', label: 'Biên tập mạng lưới', short: 'Biên tập', icon: 'IcPencil', sub: 'Vẽ ống · gắn tài sản · change set', group: 6, workspace: true },
  { id: 'import', label: 'Import CAD', short: 'Import CAD', icon: 'IcUpload', sub: 'DWG · DXF · làm sạch mạng', group: 6, workspace: true, badge: 'imp' },
]

export const PANEL_BY_ID: Record<string, PanelDef> = Object.fromEntries(PANELS.map(p => [p.id, p]))
