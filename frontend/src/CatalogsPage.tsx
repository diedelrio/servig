import { useCallback, useEffect, useState } from 'react'
import { api, apiError } from './api'

type Named = { id: number; name: string; models: number }
type Model = { id: number; name: string; brandId: number; brand: string; toolTypeId: number; type: string; tools: number }
type Data = { brands: Named[]; types: Named[]; models: Model[] }
type Kind = 'brands' | 'types'

/** Alta, cambio de nombre y baja de marcas o tipos. */
function NamedList({ kind, title, rows, onChange, onError }: { kind: Kind; title: string; rows: Named[]; onChange: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    onError('')
    try { await fn(); done?.(); onChange() } catch (e) { onError(apiError(e).message) }
  }
  return (
    <section>
      <h2>{title} <small className="muted">({rows.length})</small></h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/catalogs/${kind}`, { name }), () => setName('')) }}>
        <input placeholder="Nombre" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name.trim()}>Agregar</button>
      </form>
      <div className="scroll"><table>
        <thead><tr><th>Nombre</th><th>Modelos</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{editing?.id === r.id
                ? <input value={editing.name} maxLength={80} autoFocus onChange={(e) => setEditing({ id: r.id, name: e.target.value })} />
                : r.name}</td>
              <td>{r.models}</td>
              <td className="actions">
                {editing?.id === r.id ? (
                  <>
                    <button className="link" onClick={() => run(() => api.put(`/catalogs/${kind}/${r.id}`, { name: editing.name }), () => setEditing(null))}>Guardar</button>
                    <button className="link" onClick={() => setEditing(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <button className="link" onClick={() => setEditing({ id: r.id, name: r.name })}>Renombrar</button>
                    <button className="link" disabled={r.models > 0} title={r.models ? 'Tiene modelos' : ''}
                      onClick={() => confirm(`¿Eliminar «${r.name}»?`) && run(() => api.delete(`/catalogs/${kind}/${r.id}`))}>Eliminar</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={3}>Sin registros</td></tr>}
        </tbody>
      </table></div>
    </section>
  )
}

function Models({ data, onChange, onError }: { data: Data; onChange: () => void; onError: (m: string) => void }) {
  const empty = { name: '', brandId: '', toolTypeId: '' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const save = async () => {
    onError('')
    const body = { name: form.name, brandId: Number(form.brandId), toolTypeId: Number(form.toolTypeId) }
    try {
      if (editing) await api.put(`/catalogs/models/${editing}`, body)
      else await api.post('/catalogs/models', body)
      setForm(empty); setEditing(null); onChange()
    } catch (e) { onError(apiError(e).message) }
  }
  const rows = data.models.filter((m) => `${m.brand} ${m.type} ${m.name}`.toLowerCase().includes(filter.toLowerCase()))
  const ok = form.name.trim() && form.brandId && form.toolTypeId
  return (
    <section>
      <h2>Modelos <small className="muted">({data.models.length})</small></h2>
      <p className="muted">Cada modelo pertenece a una marca y a un tipo de herramienta. Si lo cambias de marca o tipo, se actualizan las herramientas que lo usan.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); save() }}>
        <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
          <option value="">Marca…</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={form.toolTypeId} onChange={(e) => setForm({ ...form, toolTypeId: e.target.value })}>
          <option value="">Tipo…</option>{data.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input placeholder="Modelo" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button disabled={!ok}>{editing ? 'Guardar cambios' : 'Agregar'}</button>
        {editing && <button type="button" className="link" onClick={() => { setEditing(null); setForm(empty) }}>Cancelar</button>}
      </form>
      <input placeholder="Filtrar por marca, tipo o modelo" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ margin: '0.6rem 0', maxWidth: 360 }} />
      <div className="scroll"><table>
        <thead><tr><th>Marca</th><th>Tipo</th><th>Modelo</th><th>Herramientas</th><th /></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{m.brand}</td><td>{m.type}</td><td>{m.name}</td><td>{m.tools}</td>
              <td className="actions">
                <button className="link" onClick={() => { setEditing(m.id); setForm({ name: m.name, brandId: String(m.brandId), toolTypeId: String(m.toolTypeId) }) }}>Editar</button>
                <button className="link" disabled={m.tools > 0} title={m.tools ? 'Lo usan herramientas' : ''}
                  onClick={() => confirm(`¿Eliminar el modelo «${m.name}»?`) && api.delete(`/catalogs/models/${m.id}`).then(onChange).catch((e) => onError(apiError(e).message))}>Eliminar</button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5}>Sin registros</td></tr>}
        </tbody>
      </table></div>
    </section>
  )
}

const TABS = [['brands', 'Marcas'], ['types', 'Tipos de herramienta'], ['models', 'Modelos']] as const

export default function CatalogsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('brands')
  const [error, setError] = useState('')
  const load = useCallback(() => { api.get<Data>('/catalogs').then((r) => setData(r.data)).catch((e) => setError(apiError(e).message)) }, [])
  useEffect(load, [load])
  return (
    <section>
      <h1>Catálogos</h1>
      <p className="muted">Las herramientas se dan de alta eligiendo marca, tipo y modelo de estas listas.</p>
      <div className="row" style={{ marginBottom: '1rem' }}>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? '' : 'link'} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {error && <p className="error">{error}</p>}
      {data && tab === 'brands' && <NamedList kind="brands" title="Marcas" rows={data.brands} onChange={load} onError={setError} />}
      {data && tab === 'types' && <NamedList kind="types" title="Tipos de herramienta" rows={data.types} onChange={load} onError={setError} />}
      {data && tab === 'models' && <Models data={data} onChange={load} onError={setError} />}
    </section>
  )
}
