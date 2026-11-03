/* Bản đồ mạng lưới GIS — shared branch/card store (SolidJS port of non-component parts of scenarios.jsx).
   Persistence via localStorage: gis.branches.v1 / gis.cards.v1. */

export interface Branch {
  id: string
  name: string
  lane: 'past' | 'current' | 'future'
  state: 'official' | 'review' | 'draft' | 'archived'
  ver: string
  base: string | null
  baseVer?: string
  at: string
  by: string
  cards: string[]
  x: number
  y: number
  pipeKm: number
  assets: number
  note: string
  /** Blank draft branch (empty canvas) — created from the editor "Tạo bản trắng" action. */
  blank?: boolean
  /** Server design revision holding this branch's saved drafts (see editor/revision-sync.ts). */
  revisionId?: string
  /** Preview image (PNG data URL) captured when the branch was last saved / submitted. */
  thumb?: string
  /** Last local save / creation (epoch ms) — orders the branch browser, newest first. */
  touched?: number
}

export interface CardInfo {
  title: string
  kind: string
  adds: number
  mods: number
  dels: number
  dma: string
  by: string
}

export const SC_LANES: Record<string, { label: string; col: string; sub: string }> = {
  past: { label: 'Quá khứ', col: '#8B949E', sub: 'Snapshot bất biến' },
  current: { label: 'Hiện tại', col: '#0E7C86', sub: 'Bản chính thức (of-record)' },
  future: { label: 'Tương lai', col: '#0969DA', sub: 'Kịch bản quy hoạch' },
}

export const SC_STATE: Record<string, { l: string; c: string; ic: string }> = {
  official: { l: 'Chính thức', c: '#1A7F37', ic: 'IcCheckBadge' },
  review: { l: 'Đang duyệt', c: '#9A6700', ic: 'IcClock' },
  draft: { l: 'Nháp', c: '#0969DA', ic: 'IcPencil' },
  archived: { l: 'Lưu trữ', c: '#8B949E', ic: 'IcDatabase' },
}

export const SC_CARDS: Record<string, CardInfo> = {
  'CS-314': { title: 'Đồng bộ van biên DMA-01 / DMA-04', kind: 'valve', adds: 4, mods: 11, dels: 0, dma: 'DMA-01', by: 'Phạm Khảo Sát' },
  'CS-316': { title: 'Sửa cao độ 6 nút lưới Nguyễn Trãi', kind: 'node', adds: 0, mods: 6, dels: 0, dma: 'DMA-03', by: 'Trần Đo Đạc' },
  'CS-318': { title: 'Cập nhật tuyến ống DN300 Hai Bà Trưng', kind: 'pipe', adds: 12, mods: 8, dels: 1, dma: 'DMA-04', by: 'Lê Biên Tập' },
  'CS-330': { title: 'Tuyến truyền tải DN400 KĐT Đông', kind: 'pipe', adds: 34, mods: 0, dels: 0, dma: 'DMA-03', by: 'Phòng Quy hoạch' },
  'CS-331': { title: 'Thay 1,2km ống gang → HDPE Lê Lợi', kind: 'pipe', adds: 18, mods: 18, dels: 18, dma: 'DMA-02', by: 'Lê Biên Tập' },
  'CS-332': { title: 'Bổ sung 3 van phân vùng DMA-04', kind: 'valve', adds: 3, mods: 2, dels: 0, dma: 'DMA-04', by: 'Network Eng.' },
  'CS-333': { title: 'Trạm tăng áp Đông — giai đoạn 2', kind: 'pump', adds: 1, mods: 0, dels: 0, dma: 'DMA-03', by: 'Phòng Quy hoạch' },
  'CS-334': { title: 'Vòng khép mạng DN300 Đông–Nam', kind: 'pipe', adds: 9, mods: 4, dels: 0, dma: 'DMA-05', by: 'Phòng Quy hoạch' },
}

export function scSeed(): Branch[] {
  return [
    { id: 'B-2020', name: 'Hiện trạng 2020', lane: 'past', state: 'archived', ver: 'v6', base: null, at: '31/12/2020', by: 'Phòng GIS', cards: [], x: 20, y: 70, pipeKm: 268.4, assets: 2140, note: 'Snapshot bàn giao số hoá lần đầu.' },
    { id: 'B-2023', name: 'Hiện trạng 2023', lane: 'past', state: 'archived', ver: 'v9', base: 'B-2020', at: '31/12/2023', by: 'Phòng GIS', cards: ['CS-316'], x: 150, y: 210, pipeKm: 301.7, assets: 2680, note: 'Đóng băng trước đợt thay ống lớn 2024.' },
    { id: 'B-CUR', name: 'Hiện trạng mạng lưới', lane: 'current', state: 'official', ver: 'v12', base: 'B-2023', at: '10:15 hôm nay', by: 'Lê Biên Tập', cards: ['CS-314', 'CS-318'], x: 412, y: 150, pipeKm: 318.6, assets: 2914, note: 'Bản of-record — nguồn sự thật, đồng bộ Hydraulic/DMA/EAM/Billing.' },
    { id: 'B-PIPE', name: 'Thay ống gang Lê Lợi', lane: 'future', state: 'review', ver: 'v2', base: 'B-CUR', baseVer: 'v12', at: 'Hôm qua', by: 'Lê Biên Tập', cards: ['CS-331'], x: 662, y: 36, pipeKm: 318.6, assets: 2914, note: 'Kịch bản cải tạo DMA-02, chờ duyệt để nhập vào Hiện trạng.' },
    { id: 'B-QH30', name: 'Quy hoạch 2030 — mở rộng Đông', lane: 'future', state: 'draft', ver: 'v3', base: 'B-CUR', baseVer: 'v12', at: '19/06', by: 'Phòng Quy hoạch', cards: ['CS-330', 'CS-333'], x: 690, y: 168, pipeKm: 339.1, assets: 3050, note: 'Mở rộng cấp nước KĐT Đông + tăng áp.' },
    { id: 'B-DMA4', name: 'Tái cấu trúc DMA-04', lane: 'future', state: 'draft', ver: 'v2', base: 'B-CUR', baseVer: 'v11', at: '17/06', by: 'Network Eng.', cards: ['CS-332'], x: 662, y: 300, pipeKm: 319.9, assets: 2920, note: 'Chia tách DMA-04 để giảm NRW, base ở v11 — cần rebase lên v12.' },
    { id: 'B-QH30B', name: 'QH 2030 · giai đoạn 2', lane: 'future', state: 'draft', ver: 'v1', base: 'B-QH30', baseVer: 'v3', at: 'Hôm nay', by: 'Phòng Quy hoạch', cards: ['CS-330', 'CS-333', 'CS-334'], x: 848, y: 300, pipeKm: 348.0, assets: 3120, note: 'Kế thừa QH2030 + khép vòng mạng — minh hoạ nhánh-từ-nhánh.' },
  ]
}

const SC_LS_BRANCHES = 'gis.branches.v1'
const SC_LS_CARDS = 'gis.cards.v1'

export function scLoadBranches(): Branch[] {
  try {
    const raw = localStorage.getItem(SC_LS_BRANCHES)
    if (raw) {
      const arr = JSON.parse(raw) as Branch[]
      if (Array.isArray(arr) && arr.length) return arr
    }
  } catch (_) { /* ignore */ }
  return scSeed()
}

export function scSaveBranches(branches: Branch[]): void {
  try { localStorage.setItem(SC_LS_BRANCHES, JSON.stringify(branches)) } catch (_) { /* ignore */ }
}

export function scLoadCards(): Record<string, CardInfo> {
  try {
    const raw = localStorage.getItem(SC_LS_CARDS)
    if (raw) return (JSON.parse(raw) as Record<string, CardInfo>) || {}
  } catch (_) { /* ignore */ }
  return {}
}

export function scSaveCard(id: string, card: CardInfo): void {
  try {
    const ex = scLoadCards()
    ex[id] = card
    localStorage.setItem(SC_LS_CARDS, JSON.stringify(ex))
  } catch (_) { /* ignore */ }
}

// merge persisted cards into the registry
try { Object.assign(SC_CARDS, scLoadCards()) } catch (_) { /* ignore */ }

/** Collect all card IDs effective for a branch (following base chain). */
export function effectiveCards(branch: Branch, all: Branch[]): string[] {
  const byId = Object.fromEntries(all.map((b) => [b.id, b]))
  const out: string[] = []
  let cur: Branch | undefined = branch
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur.cards.forEach((c) => { if (!out.includes(c)) out.unshift(c) })
    cur = cur.base ? byId[cur.base] : undefined
  }
  return out
}

export function cardDelta(ids: string[]): { adds: number; mods: number; dels: number } {
  return ids.reduce(
    (s, id) => {
      const c = SC_CARDS[id]
      return c ? { adds: s.adds + c.adds, mods: s.mods + c.mods, dels: s.dels + c.dels } : s
    },
    { adds: 0, mods: 0, dels: 0 },
  )
}
