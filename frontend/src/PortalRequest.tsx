import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { ToolForm } from './ToolForm'

type MyTool = { id: number; type: string; brand: string; model: string; serialNumber: string | null }

/** El cliente pide una reparación nueva: elige una de sus herramientas (o da de alta otra) y cuenta la avería. */
export default function PortalRequest() {
  const nav = useNavigate()
  const [tools, setTools] = useState<MyTool[] | null>(null)
  const [toolId, setToolId] = useState('')
  const [adding, setAdding] = useState(false)
  const [fault, setFault] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [toolError, setToolError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<MyTool[]>('/portal/tools').then((r) => { setTools(r.data); if (!r.data.length) setAdding(true) }).catch((e) => setError(apiError(e).message))
  }, [])
  useEffect(load, [load])

  const addTool = async (d: Record<string, FormDataEntryValue | number>) => {
    setToolError(null)
    try {
      const body = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''))
      const r = await api.post<MyTool>('/portal/tools', body)
      setTools((t) => [...(t ?? []), r.data]); setToolId(String(r.data.id)); setAdding(false)
    } catch (e) { setToolError(apiError(e)) }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const r = await api.post<{ id: number }>('/portal/repairs', { toolId: Number(toolId), declaredFault: fault, ...(notes.trim() ? { notes } : {}) })
      nav(`/portal/repairs/${r.data.id}`)
    } catch (err) { setError(apiError(err).message) } finally { setBusy(false) }
  }

  if (!tools) return <section><h1>Pedir una reparación</h1>{error ? <p className="error">{error}</p> : <p>Cargando…</p>}</section>
  return (
    <section>
      <h1>Pedir una reparación</h1>
      <p className="muted">Cuéntenos qué le pasa a su herramienta. Después tendrá que traerla al taller: no se repara nada sin su aprobación del presupuesto.</p>

      <h2>1. Herramienta</h2>
      {adding ? (
        <>
          <ToolForm catalogPath="/portal/catalogs" error={toolError} onSubmit={addTool} onCancel={() => setAdding(false)} />
        </>
      ) : (
        <div className="row">
          <select value={toolId} onChange={(e) => setToolId(e.target.value)} aria-label="Herramienta">
            <option value="">Elija una de sus herramientas…</option>
            {tools.map((t) => <option key={t.id} value={t.id}>{t.type} {t.brand} {t.model}{t.serialNumber ? ` · ${t.serialNumber}` : ''}</option>)}
          </select>
          <button type="button" className="link" onClick={() => { setAdding(true); setToolError(null) }}>Agregar otra herramienta</button>
        </div>
      )}

      <form onSubmit={submit}>
        <h2>2. ¿Qué le pasa?</h2>
        <label>Avería (obligatorio)
          <textarea rows={4} required minLength={3} maxLength={2000} value={fault} onChange={(e) => setFault(e.target.value)} placeholder="No enciende, hace ruido, pierde potencia…" />
        </label>
        <label>Observaciones
          <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cuándo empezó, si cree que tiene garantía, etc." />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button disabled={busy || !toolId || fault.trim().length < 3}>Enviar solicitud</button>
          <Link to="/portal">Cancelar</Link>
        </div>
      </form>
    </section>
  )
}
