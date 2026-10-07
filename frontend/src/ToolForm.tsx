import { useEffect, useState, type FormEvent } from 'react'
import { api, type ApiError } from './api'

export type Tool = {
  id: number; type: string; brand: string; model: string; modelId?: number | null; serialNumber: string | null
  purchaseDate: string | null; warrantyExpiresAt: string | null; description: string | null; notes: string | null; warrantyActive: boolean
}
export type Catalogs = {
  brands: { id: number; name: string }[]
  types: { id: number; name: string }[]
  models: { id: number; name: string; brandId: number; toolTypeId: number }[]
}

const FREE = 'free'

export function ToolForm({ tool, error, onSubmit, onCancel }: {
  tool?: Tool; error: ApiError | null; onSubmit: (d: Record<string, FormDataEntryValue | number>) => void; onCancel: () => void
}) {
  const f = error?.fields ?? {}
  const [cat, setCat] = useState<Catalogs | null>(null)
  const [brandId, setBrandId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [modelId, setModelId] = useState('')
  useEffect(() => {
    api.get<Catalogs>('/catalogs').then((r) => {
      setCat(r.data)
      const m = r.data.models.find((x) => x.id === tool?.modelId)
      if (m) { setBrandId(String(m.brandId)); setTypeId(String(m.toolTypeId)); setModelId(String(m.id)) }
      else if (tool) setModelId(FREE)
    }).catch(() => setModelId(FREE)) // sin catálogo disponible se escribe a mano
  }, [tool])

  const free = modelId === FREE || (cat !== null && !cat.models.length)
  const brandModels = cat?.models.filter((m) => String(m.brandId) === brandId) ?? []
  const types = cat?.types.filter((t) => brandModels.some((m) => m.toolTypeId === t.id)) ?? []
  const models = brandModels.filter((m) => String(m.toolTypeId) === typeId)

  const field = (name: keyof Tool, label: string, type = 'text', required = false) => (
    <label>{label}
      <input name={name} type={type} required={required} defaultValue={(tool?.[name] as string | null) ?? ''} aria-invalid={!!f[name]} />
      {f[name] && <small className="error">{f[name]}</small>}
    </label>
  )
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const d: Record<string, FormDataEntryValue | number> = Object.fromEntries(new FormData(e.currentTarget))
    if (!free) { delete d.type; delete d.brand; delete d.model; d.modelId = Number(modelId) }
    onSubmit(d)
  }
  return (
    <form className="panel grid2" onSubmit={submit}>
      {cat && !free && (
        <>
          <label>Marca
            <select value={brandId} required onChange={(e) => { setBrandId(e.target.value); setTypeId(''); setModelId('') }}>
              <option value="">Elegir…</option>
              {cat.brands.filter((b) => cat.models.some((m) => m.brandId === b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>Tipo de herramienta
            <select value={typeId} required disabled={!brandId} onChange={(e) => { setTypeId(e.target.value); setModelId('') }}>
              <option value="">Elegir…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Modelo
            <select value={modelId} required disabled={!typeId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">Elegir…</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {f.modelId && <small className="error">{f.modelId}</small>}
          </label>
          <p className="muted" style={{ alignSelf: 'end' }}>¿No está en la lista? <button type="button" className="link" onClick={() => setModelId(FREE)}>Escribirlo a mano</button></p>
        </>
      )}
      {free && (
        <>
          {field('type', 'Tipo (taladro, amoladora…)', 'text', true)}
          {field('brand', 'Marca', 'text', true)}
          {field('model', 'Modelo', 'text', true)}
          {cat?.models.length ? <p className="muted" style={{ alignSelf: 'end' }}><button type="button" className="link" onClick={() => setModelId('')}>Elegir del catálogo</button></p> : null}
        </>
      )}
      {field('serialNumber', 'Número de serie')}
      {field('purchaseDate', 'Fecha de compra', 'date')}
      {field('warrantyExpiresAt', 'Vencimiento de garantía', 'date')}
      {field('description', 'Descripción')}
      {field('notes', 'Observaciones')}
      {error && !Object.keys(f).length && <p className="error">{error.message}</p>}
      <div className="row"><button>Guardar</button><button type="button" className="link" onClick={onCancel}>Cancelar</button></div>
    </form>
  )
}
