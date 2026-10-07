import axios, { AxiosError } from 'axios'

export type User = { id: number; email: string; firstName: string; lastName: string; role: string; permissions: string[]; customerId: number | null }

export const api = axios.create({ baseURL: '/api', withCredentials: true })

let accessToken: string | null = null
export const setAccessToken = (t: string | null) => { accessToken = t }

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`
  return cfg
})

// Un solo refresh a la vez: el refresh token rota, dos en paralelo cerrarían la sesión.
type Session = { accessToken: string; user: User }
let refreshing: Promise<Session> | null = null
export const refreshSession = () =>
  (refreshing ??= api.post<Session>('/auth/refresh').then((r) => {
    setAccessToken(r.data.accessToken)
    return r.data
  }).finally(() => { refreshing = null }))

api.interceptors.response.use(undefined, async (err: AxiosError) => {
  const cfg = err.config as (typeof err.config & { _retry?: boolean }) | undefined
  if (err.response?.status === 401 && cfg && !cfg._retry && !cfg.url?.startsWith('/auth/')) {
    cfg._retry = true
    try {
      await refreshSession()
      return api(cfg)
    } catch { /* sin sesión: cae al rechazo original */ }
  }
  return Promise.reject(err)
})

export type ApiError = { message: string; code?: string; fields: Record<string, string> }
export function apiError(e: unknown): ApiError {
  const d = (e as AxiosError<{ error?: string; code?: string; details?: { field: string; message: string }[] }>).response?.data
  const fields: Record<string, string> = {}
  d?.details?.forEach((x) => { fields[x.field] ??= x.message })
  return { message: d?.error ?? 'No se pudo conectar con el servidor', code: d?.code, fields }
}
