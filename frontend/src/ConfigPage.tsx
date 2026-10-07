import { Fragment, useCallback, useEffect, useState } from 'react'
import { FaEye, FaPen, FaTrash } from 'react-icons/fa'
import { api, apiError } from './api'
import { businessNameChanged } from './businessName'

type Setting = {
  key: string; section: 'params' | 'system'; group: string; label: string; description?: string; kind: 'number' | 'text'; unit: string | null
  min: number | null; max: number | null; integer: boolean; maxLength: number | null; required: boolean
  value: string; default: string; source: 'database' | 'default'
}
type Group = { group: string; items: Setting[] }

const limits = (s: Setting) =>
  s.kind === 'number'
    ? `${s.min}–${s.max}${s.unit ? ' ' + s.unit : ''}${s.integer ? ', entero' : ''}`
    : `máx. ${s.maxLength} caracteres`

/** Una regla por fila: ver el detalle, editar el valor en la propia fila y restablecer el valor por defecto. */
function Row({ s, onSaved, onError }: { s: Setting; onSaved: () => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [detail, setDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    onError(''); setBusy(true)
    try { await fn(); done?.(); onSaved() } catch (e) { onError(`${s.label}: ${apiError(e).message}`) } finally { setBusy(false) }
  }
  const save = () => run(() => api.put(`/config/settings/${s.key}`, { value: editing }), () => { setEditing(null); if (s.key === 'business.name') businessNameChanged() })
  const long = s.kind === 'text' && (s.maxLength ?? 0) > 250
  const custom = s.source === 'database'
  return (
    <>
      <tr>
        <td><b>{s.label}</b></td>
        <td>{s.description}</td>
        <td>
          {editing === null ? (
            <span title={custom ? 'Personalizado' : 'Valor por defecto'}>{s.value || '—'}</span>
          ) : long ? (
            <textarea rows={4} value={editing} maxLength={s.maxLength ?? undefined} autoFocus onChange={(e) => setEditing(e.target.value)} />
          ) : (
            <input value={editing} maxLength={s.maxLength ?? undefined} autoFocus inputMode={s.kind === 'number' ? 'decimal' : undefined}
              style={{ width: s.kind === 'number' ? '6rem' : '100%', minWidth: '5rem' }} onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(null) }} />
          )}
        </td>
        <td>{s.unit}</td>
        <td><small>Permitido: {limits(s)} · por defecto: {s.default || '(vacío)'}</small></td>
        <td className="actions" style={{ whiteSpace: 'nowrap' }}>
          {editing === null ? (
            <>
              <button className="link" aria-label={`Ver ${s.label}`} title="Ver detalle" aria-expanded={detail} onClick={() => setDetail(!detail)}><FaEye aria-hidden /></button>
              <button className="link" aria-label={`Editar ${s.label}`} title="Editar" onClick={() => setEditing(s.value)}><FaPen aria-hidden /></button>
              <button className="link" aria-label={`Restablecer ${s.label}`} title={custom ? 'Restablecer al valor por defecto' : 'Ya tiene el valor por defecto'}
                disabled={!custom || busy} onClick={() => confirm(`¿Restablecer «${s.label}» a ${s.default || '(vacío)'}?`) && run(() => api.delete(`/config/settings/${s.key}`), () => s.key === 'business.name' && businessNameChanged())}><FaTrash aria-hidden /></button>
            </>
          ) : (
            <>
              <button disabled={busy || editing === s.value} onClick={save}>Guardar</button>
              <button className="link" onClick={() => setEditing(null)}>Cancelar</button>
            </>
          )}
        </td>
      </tr>
      {detail && (
        <tr>
          <td colSpan={6}>
            <small>
              <b>Clave:</b> <code>{s.key}</code> · <b>Valor vigente:</b> {s.value || '(vacío)'} · <b>Por defecto:</b> {s.default || '(vacío)'} ·{' '}
              <b>Origen:</b> {custom ? 'personalizado (guardado en la base)' : 'valor por defecto del entorno'}
            </small>
          </td>
        </tr>
      )}
    </>
  )
}

function Grid({ section }: { section: 'params' | 'system' }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [error, setError] = useState('')
  const load = useCallback(() => { api.get<Group[]>('/config/settings', { params: { section } }).then((r) => setGroups(r.data)).catch((e) => setError(apiError(e).message)) }, [section])
  useEffect(load, [load])
  return (
    <>
      <p className="muted">Los cambios rigen de inmediato y quedan auditados. Restablecer vuelve al valor por defecto.</p>
      {error && <p className="error">{error}</p>}
      <div className="scroll"><table className="rules">
        <colgroup><col style={{ width: '17%' }} /><col style={{ width: '31%' }} /><col style={{ width: '11%' }} /><col style={{ width: '8%' }} /><col style={{ width: '21%' }} /><col style={{ width: '12%' }} /></colgroup>
        <thead><tr><th>Regla</th><th>Descripción</th><th>Valor</th><th>Unidad</th><th>Observaciones</th><th>Acciones</th></tr></thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.group}>
              <tr className="group-row"><th colSpan={6}>{g.group}</th></tr>
              {g.items.map((s) => <Row key={s.key + s.value} s={s} onSaved={load} onError={setError} />)}
            </Fragment>
          ))}
        </tbody>
      </table></div>
    </>
  )
}

export function ParamsPage() {
  return (
    <section>
      <h1>Parámetros</h1>
      <Grid section="params" />
    </section>
  )
}

export default function SystemPage() {
  return (
    <section>
      <h1>Sistema</h1>
      <Grid section="system" />
    </section>
  )
}
