import type { ImportCapabilities } from './types'
import { importNumber } from './ui'

/** Why these files cannot be uploaded, or null. Shared by the guided and the advanced screen. */
export function uploadProblem(
  caps: ImportCapabilities,
  chosen: File[],
  alreadyInJob = 0
): string | null {
  if (chosen.length + alreadyInJob > caps.maxFiles)
    return `Mỗi hồ sơ nhận tối đa ${caps.maxFiles} tệp.`
  const invalid = chosen.find(
    file =>
      !/\.(dwg|dxf)$/i.test(file.name) ||
      !caps.formats.includes(file.name.split('.').pop()!.toLowerCase())
  )
  if (invalid) return `Định dạng không được hỗ trợ: ${invalid.name}`
  const tooLarge = chosen.find(file => file.size > caps.maxFileBytes || file.size === 0)
  if (tooLarge)
    return `Tệp rỗng hoặc vượt ${importNumber(caps.maxFileBytes / 1024 / 1024)} MB: ${tooLarge.name}`
  if (!caps.dwgAvailable && chosen.some(file => /\.dwg$/i.test(file.name)))
    return 'Máy chủ chưa có bộ chuyển đổi DWG. Có thể nạp DXF hoặc cấu hình bộ chuyển đổi để nhận DWG.'
  return null
}

/** A job name from the files: "1.MB-PP-Vinh Thinh - Dot 3.dwg" -> "1.MB-PP-Vinh Thinh - Dot 3". */
export const jobNameFor = (chosen: File[]) =>
  chosen
    .map(file => file.name.replace(/\.(dwg|dxf)$/i, ''))
    .join(' + ')
    .slice(0, 160)
