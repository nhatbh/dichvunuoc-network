/* GIS — Biên tập: bảng phím tắt → action id. Editor đăng ký 1 listener keydown, tra resolveShortcut. */
export interface Shortcut {
  key: string;      // hiển thị cho bảng trợ giúp
  actionId: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { key: 'Enter', actionId: 'edit', label: 'Sửa thuộc tính đối tượng đang chọn' },
  { key: '⌘/Ctrl+D', actionId: 'duplicate', label: 'Nhân bản' },
  { key: 'R', actionId: 'reverse', label: 'Đảo chiều tuyến' },
  { key: 'Del / ⌫', actionId: 'delete', label: 'Đánh dấu xoá' },
];

/** Khớp một KeyboardEvent với action id, hoặc null. Không xử lý khi đang gõ trong input. */
export function resolveShortcut(e: KeyboardEvent): string | null {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && (e.key === 'd' || e.key === 'D')) return 'duplicate';
  if (e.key === 'Enter') return 'edit';
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  if (e.key === 'r' || e.key === 'R') return 'reverse';
  return null;
}
