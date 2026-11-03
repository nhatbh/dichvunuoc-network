export const importField =
  'w-full rounded-lg border border-line bg-[var(--surface)] px-3 py-2 text-[12px] text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:opacity-50'
export const importButton =
  'rounded-lg border border-line px-3 py-2 text-xs font-medium hover:bg-[var(--surface2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-40'
export const importNumber = (value: number) =>
  value.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
