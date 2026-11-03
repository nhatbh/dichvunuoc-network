/* GIS shell — navigation model (ported from app.jsx NAV / TITLES / SECOF). */
export interface Route {
  name: string
  focusAsset?: { id: string }
  openQuery?: boolean
  branch?: string
  importJob?: string
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
