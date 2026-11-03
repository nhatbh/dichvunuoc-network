import { z } from 'zod'
import { env } from '@/shared/config/env'
import { authClient, type AuthSessionData } from '@/shared/lib/client-auth'
import { capabilitiesSchema, featuresSchema, jobSchema, type ReviewConfig } from './types'

export class ImportApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
  }
}

/** A request belongs to one user and tenant for its entire lifetime. */
export function importSessionScope(session: AuthSessionData | null): string {
  // The CAD worker requires an explicitly selected Organization. A legacy
  // session may continue using the existing GIS, but cannot open CAD jobs.
  if (session?.user.tenantContextSource === 'legacy-tenant-id') return ''
  const tenant = session?.user.tenantId ?? session?.user.organizationAlias
  return session?.user.id && tenant ? `${session.user.id}:${tenant}` : ''
}

export function createImportApi(scope: string, signal: AbortSignal) {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const session = await authClient.getSession()
    if (!scope || importSessionScope(session) !== scope)
      throw new ImportApiError(
        'Đơn vị hoặc phiên đăng nhập đã thay đổi. Tải lại danh sách import.',
        409
      )
    const token = await authClient.getAccessToken()
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    // Auth acquisition may itself refresh the selected organization.
    if (importSessionScope(await authClient.getSession()) !== scope)
      throw new ImportApiError('Đơn vị đã thay đổi. Tải lại danh sách import.', 409)
    const headers = new Headers(init.headers)
    if (token && token !== 'session-cookie') headers.set('Authorization', `Bearer ${token}`)
    if (init.body && !(init.body instanceof FormData))
      headers.set('Content-Type', 'application/json')
    const base = env.VITE_API_URL.replace(/\/$/, '') || '/api/gis'
    const response = await fetch(`${base}/imports${path}`, {
      ...init,
      headers,
      signal,
      credentials: env.VITE_AUTH_MODE === 'backend-session' ? 'include' : 'same-origin',
    })
    if (!response.ok) {
      const fallback: Record<number, string> = {
        401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        403: 'Bạn chưa có quyền thực hiện thao tác này cho đơn vị hiện tại.',
        409: 'Hồ sơ đã thay đổi. Đã tải lại phiên bản mới; vui lòng rà soát trước khi tiếp tục.',
        413: 'Tệp vượt giới hạn tải lên của máy chủ.',
        422: 'Một số trường ánh xạ không hợp lệ. Kiểm tra loại tài sản, vật liệu và các ngưỡng trước khi gửi lại.',
        503: 'Dịch vụ import CAD chưa sẵn sàng. Vui lòng thử lại sau.',
      }
      let detail = ''
      try {
        const body = (await response.json()) as Record<string, unknown>
        detail =
          typeof body.detail === 'string'
            ? body.detail
            : typeof body.message === 'string'
              ? body.message
              : ''
      } catch {
        /* gateways may return HTML; never paint that response */
      }
      throw new ImportApiError(
        fallback[response.status] ?? (detail || 'Không thể xử lý yêu cầu import.'),
        response.status
      )
    }
    return response
  }
  async function json<T extends z.ZodTypeAny>(
    schema: T,
    path: string,
    init?: RequestInit
  ): Promise<z.output<T>> {
    const response = await request(path, init)
    const result = schema.safeParse(await response.json())
    if (!result.success)
      throw new ImportApiError(
        'Phản hồi import không hợp lệ. Tải lại hoặc kiểm tra phiên bản dịch vụ.',
        502
      )
    return result.data
  }
  return {
    capabilities: () => json(capabilitiesSchema, '/capabilities'),
    list: () => json(z.object({ items: z.array(jobSchema) }), '/'),
    get: (id: string) => json(jobSchema, `/${encodeURIComponent(id)}`),
    upload: (name: string, files: File[]) => {
      const body = new FormData()
      body.set('name', name)
      files.forEach(file => body.append('files', file, file.name))
      return json(jobSchema, '/', { method: 'POST', body })
    },
    addFiles: (id: string, expectedVersion: number, files: File[]) => {
      const body = new FormData()
      body.set('expectedVersion', String(expectedVersion))
      files.forEach(file => body.append('files', file, file.name))
      return json(jobSchema, `/${encodeURIComponent(id)}/files`, { method: 'POST', body })
    },
    review: (id: string, expectedVersion: number, config: ReviewConfig) =>
      json(jobSchema, `/${encodeURIComponent(id)}/review`, {
        method: 'PUT',
        body: JSON.stringify({ ...config, expectedVersion }),
      }),
    features: (id: string, view: 'raw' | 'clean', offset = 0) =>
      json(
        featuresSchema,
        `/${encodeURIComponent(id)}/features?view=${view}&offset=${offset}&limit=2000`
      ),
    submit: (id: string, expectedVersion: number, projectName?: string) =>
      json(jobSchema, `/${encodeURIComponent(id)}/submit`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion, projectName }),
      }),
    publish: (id: string, expectedVersion: number, reason?: string, lifecycleEvidence?: string) =>
      json(jobSchema, `/${encodeURIComponent(id)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion, reason, lifecycleEvidence }),
      }),
    publishResult: (id: string) => json(jobSchema, `/${encodeURIComponent(id)}/publish-result`),
    report: async (id: string) => (await request(`/${encodeURIComponent(id)}/report`)).blob(),
  }
}
export type ImportApi = ReturnType<typeof createImportApi>

export function importErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể kết nối dịch vụ import.'
}
