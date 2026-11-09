/* Topology queries (`/api/gis/topology/*` on the BFF → topology-rs, decision 0029). The demo
   mock answers the same contract with the same rules (`shared/api/mocks/topology-handlers`). */
import { IsolationResult, TraceResult, type TraceDirection } from '@wn/contracts/topology'
import type { z } from 'zod'
import { env } from '@/shared/config/env'
import { authClient } from '@/shared/lib/client-auth'

async function request<S extends z.ZodTypeAny>(schema: S, path: string, init: RequestInit = {}): Promise<z.infer<S>> {
  const token = await authClient.getAccessToken()
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token && token !== 'session-cookie') headers.set('Authorization', 'Bearer ' + token)
  const response = await fetch((env.VITE_API_URL.replace(/\/$/, '') || '/api/gis') + '/topology' + path, {
    ...init,
    headers,
    credentials: env.VITE_AUTH_MODE === 'backend-session' ? 'include' : 'same-origin',
  })
  const json = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? 'Dịch vụ topology chưa sẵn sàng. Thử lại sau ít phút.'
        : response.status === 403
          ? 'Bạn chưa có quyền xem phân tích mạng.'
          : json?.detail || 'Không thể chạy phân tích mạng.'
    )
  return schema.parse(json)
}

export const topologyApi = {
  isolate: (start: { pipeId: string } | { nodeId: string }, signal?: AbortSignal) =>
    request(IsolationResult, '/isolation', { method: 'POST', body: JSON.stringify(start), signal }),
  trace: (from: string, direction: TraceDirection, signal?: AbortSignal) =>
    request(TraceResult, `/trace?from=${encodeURIComponent(from)}&direction=${direction}`, { signal }),
}
