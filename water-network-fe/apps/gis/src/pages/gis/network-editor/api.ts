import { authClient } from '@/shared/lib/client-auth'
import { env } from '@/shared/config/env'
import { importSessionScope } from '../import-workspace/api'
import type { Edit, Issue, Revision, State } from './model'
export function createNetworkEditorApi(scope: string, signal: AbortSignal) {
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (importSessionScope(await authClient.getSession()) !== scope)
      throw new Error('Đơn vị đăng nhập đã thay đổi. Tải lại màn hình.')
    const token = await authClient.getAccessToken()
    if (importSessionScope(await authClient.getSession()) !== scope)
      throw new Error('Đơn vị đăng nhập đã thay đổi. Tải lại màn hình.')
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (token && token !== 'session-cookie') headers.set('Authorization', 'Bearer ' + token)
    const response = await fetch(
      (env.VITE_API_URL.replace(/\/$/, '') || '/api/gis') + '/editor' + path,
      {
        method,
        headers,
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: env.VITE_AUTH_MODE === 'backend-session' ? 'include' : 'same-origin',
      }
    )
    const json = await response.json().catch(() => null)
    if (!response.ok)
      throw new Error(
        json?.errors?.map((x: Issue) => x.message).join('\n') ||
          (response.status === 409
            ? 'Bản nháp hoặc mạng đã thay đổi. Mở lại bản nháp để lấy phiên bản mới; các thay đổi đang sửa vẫn được giữ trên màn hình.'
            : response.status === 403
              ? 'Bạn chưa có quyền thực hiện thao tác này.'
              : json?.detail || json?.message || 'Không thể kết nối dịch vụ biên tập.')
      )
    return json as T
  }
  const revisionPath = (id: string) => '/revisions/' + encodeURIComponent(id)
  return {
    assets: () => request<State>('/assets'),
    list: () => request<(Revision & { updatedAt: string })[]>('/revisions'),
    get: (id: string) => request<Revision>(revisionPath(id)),
    create: async (name: string) => {
      const project = await request<{ id: string }>('/projects', 'POST', { name })
      const revision = await request<{ id: string }>(
        '/projects/' + encodeURIComponent(project.id) + '/revisions',
        'POST'
      )
      const current = await request<Revision>(revisionPath(revision.id))
      return request<Revision>(revisionPath(revision.id), 'PUT', {
        expectedVersion: current.version,
        operations: [],
      })
    },
    save: (revision: Revision, operations: Edit[]) =>
      request<Revision & { errors: Issue[] }>(revisionPath(revision.id), 'PUT', {
        expectedVersion: revision.version,
        operations,
      }),
    action: (id: string, action: 'validate' | 'submit' | 'approve' | 'reject', reason?: string) =>
      request<{ isValid?: boolean; errors?: Issue[] }>(revisionPath(id) + '/' + action, 'POST', {
        reason,
      }),
    results: (id: string) =>
      request<{ draftAssetId: string; gisAssetId?: string; status?: string; reason?: string }[]>(
        revisionPath(id) + '/publish-result'
      ),
  }
}
export type EditorApi = ReturnType<typeof createNetworkEditorApi>
