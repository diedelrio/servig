import { useCallback, useEffect, useState } from 'react'
import { api, apiError } from './api'
import { STATUS_LABEL, fmtDateTime } from './status'

type Setting = {
  section: 'params' | 'system'
  key: string; group: string; label: string; description?: string; kind: 'number' | 'text'; unit?: string
  min?: number; max?: number; integer?: boolean; maxLength?: number; required?: boolean
  value: string; default: string; source: 'database' | 'default'
}
type Group = { group: string; items: Setting[] }

function SettingRow({ s, onSaved }: { s: Setting; onSaved: () => void }) {
  const [v, setV] = useState(s.value)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setErr(''); setBusy(true)
    try { await fn(); onSaved() } catch (e) { setErr(apiError(e).message) } finally { setBusy(false) }
  }
  const long = s.kind === 'text' && (s.maxLength ?? 0) > 250
  const limits = s.kind === 'number' ? `${s.min}–${s.max}${s.unit ? ' ' + s.unit : ''}${s.integer ? ', entero' : ''}` : `máx. ${s.maxLength} caracteres`
  return (
    <div className="card" style={{ marginBottom: '0.7rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{s.label}</b>
        <span className={`badge ${s.source === 'database' ? 'active' : ''}`}>{s.source === 'database' ? 'Personalizado' : 'Valor por defecto'}</span>
      </div>
      {s.description && <p className="muted" style={{ margin: '0.25rem 0' }}>{s.description}</p>}
      <div className="row">
        {long
          ? <textarea rows={4} style={{ flex: 1, minWidth: 220 }} value={v} maxLength={s.maxLength} onChange={(e) => setV(e.target.value)} />
          : <input style={{ flex: 1, minWidth: 160, maxWidth: 360 }} value={v} maxLength={s.maxLength}
              inputMode={s.kind === 'number' ? 'decimal' : undefined} onChange={(e) => setV(e.target.value)} />}
        {s.unit && <span className="muted">{s.unit}</span>}
        <button disabled={busy || v === s.value} onClick={() => run(() => api.put(`/config/settings/${s.key}`, { value: v }))}>Guardar</button>
        {s.source === 'database' && <button className="link" disabled={busy} onClick={() => run(() => api.delete(`/config/settings/${s.key}`))}>Restablecer</button>}
      </div>
      <small className="muted">Permitido: {limits} · por defecto: {s.default || '(vacío)'}</small>
      {err && <p className="error">{err}</p>}
    </div>
  )
}

export function Params({ section }: { section: 'params' | 'system' }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [error, setError] = useState('')
  const load = useCallback(() => { api.get<Group[]>('/config/settings', { params: { section } }).then((r) => setGroups(r.data)).catch((e) => setError(apiError(e).message)) }, [section])
  useEffect(load, [load])
  return (
    <>
      <p className="muted">Los cambios rigen de inmediato y quedan auditados. «Restablecer» vuelve al valor por defecto del entorno.</p>
      {error && <p className="error">{error}</p>}
      {groups.map((g) => (
        <section key={g.group}>
          <h2>{g.group}</h2>
          {g.items.map((s) => <SettingRow key={s.key + s.value} s={s} onSaved={load} />)}
        </section>
      ))}
    </>
  )
}

type Workflow = {
  statuses: { status: string; final: boolean; overdueDays: number | null }[]
  transitions: { from: string; to: string; label: string; actors: string[]; internal: boolean; needsComment: boolean; onlyIfNoQuote: boolean; parts: string | null }[]
}
const st = (s: string) => STATUS_LABEL[s] ?? s

function WorkflowTab({ d }: { d: Workflow }) {
  return (
    <>
      <h2>Estados y plazos de atraso</h2>
      <div className="scroll"><table>
        <thead><tr><th>Estado</th><th>Código</th><th>Se considera atrasada tras</th></tr></thead>
        <tbody>{d.statuses.map((s) => (
          <tr key={s.status}><td>{st(s.status)}{s.final && <> <span className="badge">final</span></>}</td><td><small>{s.status}</small></td><td>{s.overdueDays ? `${s.overdueDays} días` : '—'}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="muted">Los plazos se editan en la pestaña Parámetros.</p>
      <h2>Transiciones permitidas</h2>
      <div className="scroll"><table>
        <thead><tr><th>Desde</th><th>Hacia</th><th>Acción</th><th>Quién</th><th>Condiciones</th></tr></thead>
        <tbody>{d.transitions.map((t, i) => (
          <tr key={i}>
            <td>{st(t.from)}</td><td>{st(t.to)}</td><td>{t.label}</td><td>{t.actors.join(', ')}</td>
            <td><small>{[t.internal && 'solo el sistema', t.needsComment && 'requiere comentario', t.onlyIfNoQuote && 'solo sin presupuesto', t.parts && `repuestos: ${t.parts}`].filter(Boolean).join(' · ') || '—'}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  )
}

type Roles = { roles: { id: number; name: string; users: number; permissions: string[] }[]; permissions: { code: string; roles: string[] }[] }
function RolesTab({ d }: { d: Roles }) {
  const names = d.roles.map((r) => r.name)
  return (
    <>
      <h2>Roles</h2>
      <div className="scroll"><table>
        <thead><tr><th>Rol</th><th>Usuarios</th><th>Permisos</th></tr></thead>
        <tbody>{d.roles.map((r) => <tr key={r.id}><td><b>{r.name}</b></td><td>{r.users}</td><td><small>{r.permissions.join(', ') || 'ninguno (solo portal del cliente)'}</small></td></tr>)}</tbody>
      </table></div>
      <h2>Matriz de permisos</h2>
      <div className="scroll"><table>
        <thead><tr><th>Permiso</th>{names.map((n) => <th key={n}>{n}</th>)}</tr></thead>
        <tbody>{d.permissions.map((p) => <tr key={p.code}><td><code>{p.code}</code></td>{names.map((n) => <td key={n}>{p.roles.includes(n) ? '✔' : ''}</td>)}</tr>)}</tbody>
      </table></div>
    </>
  )
}

type Tables = {
  tables: { table: string; rows: number; columns: { name: string; type: string; nullable: boolean; default: string | null; primaryKey: boolean; unique: boolean; references: string | null }[] }[]
  enums: { name: string; values: string[] }[]
  migrations: { name: string; appliedAt: string | null }[]
}
function TablesTab({ d }: { d: Tables }) {
  return (
    <>
      <p className="muted">Estructura real de la base de datos (solo lectura; no se muestran datos).</p>
      {d.tables.map((t) => (
        <details key={t.table} style={{ marginBottom: '0.5rem' }}>
          <summary><b>{t.table}</b> <small className="muted">· {t.columns.length} columnas · {t.rows} filas</small></summary>
          <div className="scroll"><table>
            <thead><tr><th>Columna</th><th>Tipo</th><th>Nulo</th><th>Clave</th><th>Por defecto</th></tr></thead>
            <tbody>{t.columns.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td><td><code>{c.type}</code></td><td>{c.nullable ? 'sí' : 'no'}</td>
                <td><small>{[c.primaryKey && 'PK', c.unique && 'único', c.references && `→ ${c.references}`].filter(Boolean).join(' · ')}</small></td>
                <td><small>{c.default ?? ''}</small></td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      ))}
      <h2>Enumerados</h2>
      <div className="scroll"><table>
        <thead><tr><th>Tipo</th><th>Valores</th></tr></thead>
        <tbody>{d.enums.map((e) => <tr key={e.name}><td><b>{e.name}</b></td><td><small>{e.values.join(', ')}</small></td></tr>)}</tbody>
      </table></div>
      <h2>Migraciones aplicadas</h2>
      <div className="scroll"><table>
        <thead><tr><th>Migración</th><th>Aplicada</th></tr></thead>
        <tbody>{d.migrations.map((m) => <tr key={m.name}><td>{m.name}</td><td>{m.appliedAt ? fmtDateTime(m.appliedAt) : 'pendiente'}</td></tr>)}</tbody>
      </table></div>
    </>
  )
}

type System = { params: { group: string; name: string; value: string; note?: string }[]; environment: Record<string, string | number | boolean> }
function SystemTab({ d }: { d: System }) {
  const groups = [...new Set(d.params.map((p) => p.group))]
  return (
    <>
      <p className="muted">Estos valores viven en el código: para cambiarlos hay que modificarlo y desplegar.</p>
      {groups.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className="scroll"><table>
            <tbody>{d.params.filter((p) => p.group === g).map((p) => (
              <tr key={p.name}><td>{p.name}</td><td><b>{p.value}</b>{p.note && <div><small className="muted">{p.note}</small></div>}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
      <h2>Entorno</h2>
      <div className="scroll"><table>
        <tbody>{Object.entries(d.environment).map(([k, v]) => <tr key={k}><td>{k}</td><td><b>{String(v)}</b></td></tr>)}</tbody>
      </table></div>
    </>
  )
}

const TABS = [
  ['params', 'Seguridad y funcionamiento'], ['workflow', 'Estados y flujo'], ['roles', 'Roles y permisos'],
  ['tables', 'Tablas y tipos de datos'], ['system', 'Límites fijos y entorno'],
] as const
type Tab = (typeof TABS)[number][0]

function Remote<T>({ path, render }: { path: string; render: (d: T) => React.ReactNode }) {
  const [d, setD] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get<T>(path).then((r) => setD(r.data)).catch((e) => setError(apiError(e).message)) }, [path])
  if (error) return <p className="error">{error}</p>
  return d ? <>{render(d)}</> : <p className="muted">Cargando…</p>
}

export function ParamsPage() {
  return (
    <section>
      <h1>Parámetros</h1>
      <Params section="params" />
    </section>
  )
}

export default function SystemPage() {
  const [tab, setTab] = useState<Tab>('params')
  return (
    <section>
      <h1>Sistema</h1>
      <div className="row" style={{ marginBottom: '1rem' }}>
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? '' : 'link'} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'params' && <Params section="system" />}
      {tab === 'workflow' && <Remote<Workflow> path="/config/reference/workflow" render={(d) => <WorkflowTab d={d} />} />}
      {tab === 'roles' && <Remote<Roles> path="/config/reference/roles" render={(d) => <RolesTab d={d} />} />}
      {tab === 'tables' && <Remote<Tables> path="/config/reference/tables" render={(d) => <TablesTab d={d} />} />}
      {tab === 'system' && <Remote<System> path="/config/reference/system" render={(d) => <SystemTab d={d} />} />}
    </section>
  )
}
