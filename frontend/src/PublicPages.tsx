import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { useBusinessName } from './businessName'
import { STATUS_LABEL, fmtDateTime } from './status'

/** Marco de las páginas públicas (sin sesión): logo y nombre del taller. */
function PublicCard({ title, children }: { title: string; children: ReactNode }) {
  const name = useBusinessName()
  return (
    <main className="card wide">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <img className="auth-logo" style={{ margin: 0 }} src="/logo.png" alt="" />
        <b>{name}</b>
      </div>
      <h1>{title}</h1>
      {children}
    </main>
  )
}

type Catalogs = {
  brands: { id: number; name: string }[]
  types: { id: number; name: string }[]
  models: { id: number; name: string; brandId: number; toolTypeId: number }[]
}

// ---------- Pedir una reparación sin cuenta ----------

/** Solicitud desde la web: nada se registra hasta confirmar desde el correo (así el email queda asociado a su dueño). */
export function PublicRequest() {
  const [cat, setCat] = useState<Catalogs | null>(null)
  const [brandId, setBrandId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [modelId, setModelId] = useState('')
  const [free, setFree] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Catalogs>('/public/catalogs').then((r) => { setCat(r.data); if (!r.data.models.length) setFree(true) }).catch(() => setFree(true)) }, [])

  const brandModels = cat?.models.filter((m) => String(m.brandId) === brandId) ?? []
  const types = cat?.types.filter((t) => brandModels.some((m) => m.toolTypeId === t.id)) ?? []
  const models = brandModels.filter((m) => String(m.toolTypeId) === typeId)
  const f = error?.fields ?? {}

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    const body: Record<string, string | number> = { ...d }
    if (!free) { delete body.type; delete body.brand; delete body.model; body.modelId = Number(modelId) }
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k]
    try { setDone((await api.post<{ message: string }>('/public/requests', body)).data.message) } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }

  if (done) {
    return (
      <PublicCard title="Revise su correo">
        <p className="ok big">{done}</p>
        <p>Abra el mensaje y pulse <b>Confirmar mi solicitud</b>. Hasta entonces no se registra nada. Si no lo ve, mire en la carpeta de correo no deseado.</p>
        <p><Link to="/login">Ir al inicio</Link></p>
      </PublicCard>
    )
  }
  return (
    <PublicCard title="Pedir una reparación">
      <p className="muted">Cuéntenos qué le pasa a su herramienta. No necesita crear una cuenta: le enviaremos un correo para confirmar la solicitud y para consultar su estado.</p>
      <form onSubmit={submit}>
        <label>Nombre<input name="name" required maxLength={150} aria-invalid={!!f.name} />{f.name && <small className="error">{f.name}</small>}</label>
        <label>Email<input name="email" type="email" required autoComplete="email" aria-invalid={!!f.email} />{f.email && <small className="error">{f.email}</small>}</label>
        <label>Teléfono (opcional)<input name="phone" maxLength={40} autoComplete="tel" /></label>

        <h2>Herramienta</h2>
        {cat && !free ? (
          <>
            <label>Marca
              <select value={brandId} required onChange={(e) => { setBrandId(e.target.value); setTypeId(''); setModelId('') }}>
                <option value="">Elegir…</option>
                {cat.brands.filter((b) => cat.models.some((m) => m.brandId === b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label>Tipo de herramienta
              <select value={typeId} required disabled={!brandId} onChange={(e) => { setTypeId(e.target.value); setModelId('') }}>
                <option value="">Elegir…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Modelo
              <select value={modelId} required disabled={!typeId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Elegir…</option>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <p className="muted">¿No está en la lista? <button type="button" className="link" onClick={() => setFree(true)}>Escribirlo a mano</button></p>
          </>
        ) : (
          <>
            <label>Tipo (taladro, amoladora…)<input name="type" required maxLength={80} aria-invalid={!!f.type} />{f.type && <small className="error">{f.type}</small>}</label>
            <label>Marca<input name="brand" required maxLength={80} aria-invalid={!!f.brand} />{f.brand && <small className="error">{f.brand}</small>}</label>
            <label>Modelo<input name="model" required maxLength={80} aria-invalid={!!f.model} />{f.model && <small className="error">{f.model}</small>}</label>
            {cat?.models.length ? <p className="muted"><button type="button" className="link" onClick={() => setFree(false)}>Elegir del listado</button></p> : null}
          </>
        )}
        <label>Número de serie (opcional)<input name="serialNumber" maxLength={80} /></label>

        <h2>¿Qué le pasa?</h2>
        <label>Avería<textarea name="declaredFault" rows={4} required minLength={3} maxLength={2000} placeholder="No enciende, hace ruido, pierde potencia…" />{f.declaredFault && <small className="error">{f.declaredFault}</small>}</label>
        <label>Observaciones (opcional)<textarea name="notes" rows={3} maxLength={2000} /></label>

        {/* Campo trampa contra robots: oculto para las personas. */}
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

        {error && !Object.keys(f).length && <p className="error">{error.message}</p>}
        <button disabled={busy || (!free && !modelId)}>Enviar solicitud</button>
      </form>
      <p><Link to="/consulta">Consultar una reparación</Link> · <Link to="/login">Ya tengo cuenta</Link></p>
    </PublicCard>
  )
}

// ---------- Confirmación desde el correo ----------

export function PublicConfirm() {
  const token = useSearchParams()[0].get('token') ?? ''
  const [res, setRes] = useState<{ number: string; already: boolean } | null>(null)
  const [error, setError] = useState(token ? '' : 'Enlace incompleto.')
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true); setError('')
    try { setRes((await api.post<{ number: string; already: boolean }>('/public/requests/confirm', { token })).data) } catch (e) { setError(apiError(e).message) } finally { setBusy(false) }
  }
  if (res) {
    return (
      <PublicCard title={res.already ? 'Solicitud ya confirmada' : 'Solicitud registrada'}>
        <p className="ok big">Su número de resguardo es <b>{res.number}</b>.</p>
        <p>Le hemos enviado un correo con un enlace para consultar el estado. <b>Traiga la herramienta al taller</b> para que la recibamos y la revisemos.</p>
        <p>Si crea su cuenta con este mismo correo verá todas sus reparaciones y podrá aprobar los presupuestos: <Link to="/register">Crear cuenta</Link></p>
      </PublicCard>
    )
  }
  return (
    <PublicCard title="Confirmar solicitud">
      <p>Pulse el botón para confirmar que usted pidió esta reparación.</p>
      {error && <p className="error">{error}</p>}
      <button disabled={busy || !token} onClick={confirm}>Confirmar mi solicitud</button>
    </PublicCard>
  )
}

// ---------- Consulta (sin cuenta) ----------

type Status = {
  number: string; status: string; receivedAt: string; declaredFault: string; quoteWaiting: boolean; expiresAt: string
  tool: { type: string; brand: string; model: string }
  timeline: { status: string; at: string }[]
  business: { name: string; phone: string }
}

function StatusView({ token }: { token: string }) {
  const [s, setS] = useState<Status | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get<Status>(`/public/status/${encodeURIComponent(token)}`).then((r) => setS(r.data)).catch((e) => setError(apiError(e).message)) }, [token])
  if (error) return <PublicCard title="Consulta"><p className="error">{error}</p><p><Link to="/consulta">Pedir un enlace nuevo</Link></p></PublicCard>
  if (!s) return <PublicCard title="Consulta"><p>Cargando…</p></PublicCard>
  return (
    <PublicCard title={`Reparación ${s.number}`}>
      <p><span className="badge big">{STATUS_LABEL[s.status] ?? s.status}</span></p>
      <p>{s.tool.type} {s.tool.brand} {s.tool.model}</p>
      <p className="muted">Avería indicada: {s.declaredFault}</p>
      {s.quoteWaiting && (
        <div className="callout">
          <p>Hay un <b>presupuesto esperando su respuesta</b>. Para verlo, aprobarlo o rechazarlo debe iniciar sesión con su usuario (si no tiene, cree la cuenta con este mismo correo).</p>
          <div className="row"><Link className="btn" to="/login">Iniciar sesión</Link><Link to="/register">Crear cuenta</Link></div>
        </div>
      )}
      <h2>Seguimiento</h2>
      <ol className="timeline">{s.timeline.map((t, i) => <li key={i}><b>{STATUS_LABEL[t.status] ?? t.status}</b> <small>{fmtDateTime(t.at)}</small></li>)}</ol>
      <p className="muted">{s.business.name}{s.business.phone && ` · ${s.business.phone}`}. Este enlace vence el {fmtDateTime(s.expiresAt)}.</p>
    </PublicCard>
  )
}

export function PublicLookup() {
  const token = useSearchParams()[0].get('token')
  const [error, setError] = useState<ApiError | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  if (token) return <StatusView token={token} />
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { setMsg((await api.post<{ message: string }>('/public/lookup', Object.fromEntries(new FormData(e.currentTarget)))).data.message) } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }
  return (
    <PublicCard title="Consultar una reparación">
      <p className="muted">Indique el número de resguardo y el correo con el que se registró. Le enviaremos un enlace temporal para ver el estado.</p>
      {msg ? <p className="ok big">{msg}</p> : (
        <form onSubmit={submit}>
          <label>Número de resguardo<input name="receipt" required maxLength={60} placeholder="REP-2026-000123" /></label>
          <label>Email<input name="email" type="email" required autoComplete="email" /></label>
          {error && <p className="error">{error.message}</p>}
          <button disabled={busy}>Enviarme el enlace</button>
        </form>
      )}
      <p><Link to="/solicitar">Pedir una reparación</Link> · <Link to="/login">Ya tengo cuenta</Link></p>
    </PublicCard>
  )
}
