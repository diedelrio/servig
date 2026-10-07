import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { useAuth } from './auth'
import { ToolForm, type Tool } from './ToolForm'

type CustomerRow = { id: number; name: string; taxId: string | null; email: string | null }
type CustomerFull = CustomerRow & { tools: Tool[] }

export default function NewRepair() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<CustomerRow[]>([])
  const [customer, setCustomer] = useState<CustomerFull | null>(null)
  const [toolId, setToolId] = useState<number | null>(null)
  const [addingTool, setAddingTool] = useState(false)
  const [inWarranty, setInWarranty] = useState(false)
  const [requiresQuote, setRequiresQuote] = useState(true)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const pickTool = (c: CustomerFull, id: number) => {
    setToolId(id)
    const t = c.tools.find((x) => x.id === id)
    const w = !!t?.warrantyActive // sugerencia: se confirma con el cliente en el mostrador
    setInWarranty(w)
    setRequiresQuote(true)
  }

  const loadCustomer = (id: number, preferTool?: number) =>
    api.get<CustomerFull>(`/customers/${id}`).then((r) => {
      setCustomer(r.data)
      const pick = preferTool ?? (r.data.tools.length === 1 ? r.data.tools[0].id : null)
      if (pick) pickTool(r.data, pick)
      else setToolId(null)
    })

  // Prellenado desde la ficha del cliente: /repairs/new?customerId=..&toolId=..
  useEffect(() => {
    const cid = Number(params.get('customerId'))
    if (cid) loadCustomer(cid, Number(params.get('toolId')) || undefined).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (customer || search.trim().length < 2) { setFound([]); return }
    const t = setTimeout(() => {
      api.get<CustomerRow[]>('/customers', { params: { search } }).then((r) => setFound(r.data.slice(0, 8))).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [search, customer])

  const addTool = async (d: Record<string, FormDataEntryValue | number>) => {
    setError(null)
    try {
      const r = await api.post<Tool>('/tools', { ...d, customerId: customer!.id })
      await loadCustomer(customer!.id, r.data.id)
      setAddingTool(false)
    } catch (e) { setError(apiError(e)) }
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!toolId) { setError({ message: 'Selecciona la herramienta', fields: {} }); return }
    const d = Object.fromEntries(new FormData(e.currentTarget))
    setBusy(true)
    setError(null)
    try {
      const r = await api.post('/repairs', {
        toolId, declaredFault: d.declaredFault, visualState: d.visualState, accessories: d.accessories, notes: d.notes,
        inWarranty, requiresQuote: inWarranty ? requiresQuote : true,
      })
      const failed: string[] = []
      for (const f of files) {
        try {
          await api.post(`/repairs/${r.data.id}/attachments`, f, { headers: { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) } })
        } catch (err) { failed.push(`${f.name}: ${apiError(err).message}`) }
      }
      nav(`/repairs/${r.data.id}`, { state: { uploadErrors: failed } })
    } catch (err) {
      setError(apiError(err))
      setBusy(false)
    }
  }

  if (!can('repair:create')) return <p>Sin permiso.</p>
  const f = error?.fields ?? {}

  return (
    <section>
      <p><Link to="/repairs">← Reparaciones</Link></p>
      <h1>Nueva recepción</h1>

      <h2>1. Cliente</h2>
      {customer ? (
        <div className="panel row between">
          <span><b>{customer.name}</b> {customer.taxId && `· ${customer.taxId}`} {customer.email && `· ${customer.email}`}</span>
          <button className="link" onClick={() => { setCustomer(null); setToolId(null); setSearch('') }}>Cambiar</button>
        </div>
      ) : (
        <div className="panel">
          <input placeholder="Buscar cliente por nombre, DNI/NIF, email o teléfono" value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((c) => (
            <button key={c.id} type="button" className="link block" onClick={() => loadCustomer(c.id)}>{c.name} {c.taxId && `· ${c.taxId}`}</button>
          ))}
          {can('customer:create') && <p><small>¿Cliente nuevo? <Link to="/customers">Créalo primero en Clientes</Link>.</small></p>}
        </div>
      )}

      {customer && (
        <>
          <h2>2. Herramienta</h2>
          {customer.tools.length > 0 && (
            <div className="panel">
              {customer.tools.map((t) => (
                <label key={t.id} className="radio">
                  <input type="radio" name="tool" checked={toolId === t.id} onChange={() => pickTool(customer, t.id)} />
                  {t.type} {t.brand} {t.model} {t.serialNumber && `· S/N ${t.serialNumber}`}
                  {t.warrantyActive && <span className="badge active">Garantía vigente</span>}
                </label>
              ))}
            </div>
          )}
          {addingTool
            ? <ToolForm error={error} onCancel={() => setAddingTool(false)} onSubmit={addTool} />
            : can('tool:create') && <button type="button" className="link" onClick={() => { setAddingTool(true); setError(null) }}>+ Registrar otra herramienta</button>}
        </>
      )}

      {customer && toolId && (
        <form onSubmit={submit}>
          <h2>3. Datos de la recepción</h2>
          <div className="panel grid1">
            <label>Avería declarada por el cliente
              <textarea name="declaredFault" rows={3} required aria-invalid={!!f.declaredFault} />
              {f.declaredFault && <small className="error">{f.declaredFault}</small>}
            </label>
            <label>Estado visual al recibirla
              <textarea name="visualState" rows={2} required aria-invalid={!!f.visualState} placeholder="Golpes, rayas, piezas faltantes…" />
              {f.visualState && <small className="error">{f.visualState}</small>}
            </label>
            <label>Accesorios entregados<input name="accessories" placeholder="Maletín, batería, cargador…" /></label>
            <label>Observaciones<input name="notes" /></label>
            <label className="check"><input type="checkbox" checked={inWarranty} onChange={(e) => { setInWarranty(e.target.checked); if (!e.target.checked) setRequiresQuote(true) }} /> En garantía</label>
            {inWarranty && (
              <label className="check"><input type="checkbox" checked={!requiresQuote} onChange={(e) => setRequiresQuote(!e.target.checked)} /> Reparación de garantía sin presupuesto</label>
            )}
            {f.requiresQuote && <small className="error">{f.requiresQuote}</small>}
            <label>Fotos o documentos (JPG, PNG, WebP o PDF · máx. 10 MB)
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </label>
          </div>
          {error && !Object.keys(f).length && <p className="error">{error.message}</p>}
          <button disabled={busy}>{busy ? 'Guardando…' : 'Registrar recepción'}</button>
        </form>
      )}
    </section>
  )
}
