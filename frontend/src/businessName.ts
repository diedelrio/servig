import { useEffect, useState } from 'react'
import { api } from './api'

const EVENT = 'business-name-changed'
let cached: string | null = null

/** Avisa a las cabeceras de que el parámetro «Nombre del taller» cambió (se llama tras guardarlo). */
export const businessNameChanged = () => { cached = null; window.dispatchEvent(new Event(EVENT)) }

/** Nombre del taller (parámetro de Configuración); mientras carga, un texto neutro. */
export function useBusinessName() {
  const [name, setName] = useState(cached ?? '')
  useEffect(() => {
    const load = () => {
      if (cached) return setName(cached)
      api.get<{ name: string }>('/business').then((r) => { cached = r.data.name; setName(r.data.name) }).catch(() => {})
    }
    load()
    window.addEventListener(EVENT, load)
    return () => window.removeEventListener(EVENT, load)
  }, [])
  return name
}
