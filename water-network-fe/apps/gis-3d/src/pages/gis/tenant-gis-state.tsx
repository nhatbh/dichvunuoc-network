import type { JSX } from 'solid-js'
import { cAccent, chex, cTheme, tone } from './lib/theme'

type TenantGisStateKind = 'empty' | 'invalid' | 'error'

const COPY: Record<TenantGisStateKind, { title: string; description: string }> = {
  empty: {
    title: 'Đơn vị chưa có dữ liệu GIS',
    description:
      'Chưa có nút mạng, tuyến ống hoặc thiết bị không gian thuộc đơn vị hiện tại. Dữ liệu sẽ xuất hiện sau khi được nhập và kiểm tra.',
  },
  invalid: {
    title: 'Chưa xác định được vùng bản đồ của đơn vị',
    description:
      'Dữ liệu có tồn tại nhưng thông tin home view đang thiếu hoặc không hợp lệ. Cần kiểm tra bootstrap GIS của tenant trước khi mở bản đồ.',
  },
  error: {
    title: 'Không tải được dữ liệu GIS',
    description:
      'Không thể tải thông tin GIS của đơn vị hiện tại. Vui lòng thử lại hoặc kiểm tra kết nối dịch vụ.',
  },
}

export function TenantGisState(props: {
  kind: TenantGisStateKind
  onRetry?: () => void
  class?: string
}): JSX.Element {
  const copy = () => COPY[props.kind]

  return (
    <div
      class={`flex min-h-[420px] w-full items-center justify-center px-6 py-12 ${props.class ?? ''}`}
      data-testid={`tenant-gis-${props.kind}`}
    >
      <div class="max-w-md text-center">
        <div
          class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-current/15 bg-current/5 "
          style={{ color: tone(cAccent()), background: chex(cAccent(), 0.08) }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <path d="M3 6.5 8.5 4l7 3 5.5-2.5v13L15.5 20l-7-3L3 19.5z" />
            <path d="M8.5 4v13M15.5 7v13" />
          </svg>
        </div>
        <h1 class="text-base font-semibold text-current">{copy().title}</h1>
        <p class="mt-2 text-sm leading-6 opacity-65">{copy().description}</p>
        <a
          href="/gis#import"
          style={{ background: cAccent(), color: cTheme() === 'light' ? '#fff' : '#06231f' }}
          class="mt-5 inline-flex rounded px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          Import CAD
        </a>
        {props.onRetry ? (
          <button
            type="button"
            class="mt-5 rounded border border-current/20 px-3 py-2 text-sm font-medium hover:bg-current/5"
            onClick={props.onRetry}
          >
            Thử lại
          </button>
        ) : null}
      </div>
    </div>
  )
}
