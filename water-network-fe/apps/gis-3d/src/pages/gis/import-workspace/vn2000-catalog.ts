/**
 * Historical cadastral localities, not automatic CRS guesses for current provinces.
 * Meridians: TT 26/2024/TT-BTNMT, Article 3 and Annex 01, Công báo 59+60,
 * 14 January 2025, printed pp. 80–81 (PDF pp. 50–51). All rows use TM-3,
 * k0=0.9999, latitude origin=0, false easting=500000 m, false northing=0 m.
 * EPSG identities and parameters verified against the official PROJ database:
 * https://github.com/OSGeo/PROJ/blob/master/data/sql/projected_crs.sql
 * https://github.com/OSGeo/PROJ/blob/master/data/sql/conversion.sql
 *
 * TT 24/2025's 34-province table concerns administrative maps; it must not
 * overwrite a source drawing's historical CRS. Province labels below therefore
 * retain the locality names in Annex 01 and do not claim current boundaries.
 * No source CRS is selected solely from the job's tenant or filename.
 */
export const vn2000CatalogVersion = 'tt26-2024-annex01-v1'

export interface Vn2000Locality {
  id: string
  label: string
  /** Province/city name in the historical source table, before 2025 mergers. */
  provinceLabel: string
  /** Decimal degrees, not the EPSG database's sexagesimal DDD.MM encoding. */
  centralMeridian: number
  epsg: number
  sourceUrl: string
}

const sourceUrl =
  'https://congbao.chinhphu.vn/van-ban/thong-tu-so-26-2024-tt-btnmt-43701.htm'

const epsgByMeridian = {
  103: 9205,
  104: 9206,
  104.5: 9207,
  104.75: 9208,
  105: 5897,
  105.5: 9209,
  105.75: 9210,
  106: 9211,
  106.25: 9212,
  106.5: 9213,
  107: 9214,
  107.25: 9215,
  107.5: 9216,
  107.75: 5899,
  108: 5898,
  108.25: 9217,
  108.5: 9218,
} as const

// Order and localities follow the 63 numbered rows in Annex 01 exactly.
const localities: Array<[string, string, keyof typeof epsgByMeridian]> = [
  ['lai-chau', 'Lai Châu', 103],
  ['dien-bien', 'Điện Biên', 103],
  ['son-la', 'Sơn La', 104],
  ['kien-giang', 'Kiên Giang', 104.5],
  ['ca-mau', 'Cà Mau', 104.5],
  ['lao-cai', 'Lào Cai', 104.75],
  ['yen-bai', 'Yên Bái', 104.75],
  ['nghe-an', 'Nghệ An', 104.75],
  ['phu-tho', 'Phú Thọ', 104.75],
  ['an-giang', 'An Giang', 104.75],
  ['thanh-hoa', 'Thanh Hoá', 105],
  ['vinh-phuc', 'Vĩnh Phúc', 105],
  ['dong-thap', 'Đồng Tháp', 105],
  ['can-tho', 'TP. Cần Thơ', 105],
  ['bac-lieu', 'Bạc Liêu', 105],
  ['hau-giang', 'Hậu Giang', 105],
  ['ha-noi', 'TP. Hà Nội', 105],
  ['ninh-binh', 'Ninh Bình', 105],
  ['ha-nam', 'Hà Nam', 105],
  ['ha-giang', 'Hà Giang', 105.5],
  ['hai-duong', 'Hải Dương', 105.5],
  ['ha-tinh', 'Hà Tĩnh', 105.5],
  ['bac-ninh', 'Bắc Ninh', 105.5],
  ['hung-yen', 'Hưng Yên', 105.5],
  ['thai-binh', 'Thái Bình', 105.5],
  ['nam-dinh', 'Nam Định', 105.5],
  ['tay-ninh', 'Tây Ninh', 105.5],
  ['vinh-long', 'Vĩnh Long', 105.5],
  ['soc-trang', 'Sóc Trăng', 105.5],
  ['tra-vinh', 'Trà Vinh', 105.5],
  ['cao-bang', 'Cao Bằng', 105.75],
  ['long-an', 'Long An', 105.75],
  ['tien-giang', 'Tiền Giang', 105.75],
  ['ben-tre', 'Bến Tre', 105.75],
  ['hai-phong', 'TP. Hải Phòng', 105.75],
  ['ho-chi-minh', 'TP. Hồ Chí Minh', 105.75],
  ['binh-duong', 'Bình Dương', 105.75],
  ['tuyen-quang', 'Tuyên Quang', 106],
  ['hoa-binh', 'Hoà Bình', 106],
  ['quang-binh', 'Quảng Bình', 106],
  ['quang-tri', 'Quảng Trị', 106.25],
  ['binh-phuoc', 'Bình Phước', 106.25],
  ['bac-kan', 'Bắc Kạn', 106.5],
  ['thai-nguyen', 'Thái Nguyên', 106.5],
  ['bac-giang', 'Bắc Giang', 107],
  ['thua-thien-hue', 'Thừa Thiên - Huế', 107],
  ['lang-son', 'Lạng Sơn', 107.25],
  ['kon-tum', 'Kon Tum', 107.5],
  ['quang-ninh', 'Quảng Ninh', 107.75],
  ['dong-nai', 'Đồng Nai', 107.75],
  ['ba-ria-vung-tau', 'Bà Rịa - Vũng Tàu', 107.75],
  ['quang-nam', 'Quảng Nam', 107.75],
  ['lam-dong', 'Lâm Đồng', 107.75],
  ['da-nang', 'TP. Đà Nẵng', 107.75],
  ['quang-ngai', 'Quảng Ngãi', 108],
  ['ninh-thuan', 'Ninh Thuận', 108.25],
  ['khanh-hoa', 'Khánh Hoà', 108.25],
  ['binh-dinh', 'Bình Định', 108.25],
  ['dak-lak', 'Đắk Lắk', 108.5],
  ['dak-nong', 'Đắk Nông', 108.5],
  ['phu-yen', 'Phú Yên', 108.5],
  ['gia-lai', 'Gia Lai', 108.5],
  ['binh-thuan', 'Bình Thuận', 108.5],
]

export const vn2000Localities: Vn2000Locality[] = localities.map(
  ([id, provinceLabel, centralMeridian]) => ({
    id: `tt26-2024-${id}`,
    label: `${provinceLabel} · địa bàn theo TT26/2024`,
    provinceLabel,
    centralMeridian,
    epsg: epsgByMeridian[centralMeridian],
    sourceUrl,
  })
)
