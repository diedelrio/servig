import type { FormEvent } from 'react'
import type { ApiError } from './api'

export type Tool = {
  id: number; type: string; brand: string; model: string; serialNumber: string | null
  purchaseDate: string | null; warrantyExpiresAt: string | null; description: string | null; notes: string | null; warrantyActive: boolean
}

export function ToolForm({ tool, error, onSubmit, onCancel }: {
  tool?: Tool; error: ApiError | null; onSubmit: (d: Record<string, FormDataEntryValue>) => void; onCancel: () => void
}) {
  const f = error?.fields ?? {}
  const field = (name: keyof Tool, label: string, type = 'text', required = false) => (
    <label>{label}
      <input name={name} type={type} required={required} defaultValue={(tool?.[name] as string | null) ?? ''} aria-invalid={!!f[name]} />
      {f[name] && <small className="error">{f[name]}</small>}
    </label>
  )
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(e.currentTarget))) }
  return (
    <form className="panel grid2" onSubmit={submit}>
      {field('type', 'Tipo (taladro, amoladora…)', 'text', true)}
      {field('brand', 'Marca', 'text', true)}
      {field('model', 'Modelo', 'text', true)}
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
