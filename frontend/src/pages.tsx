import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError, type ApiError } from './api'
import { useAuth } from './auth'
import Dashboard from './Dashboard'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="card">
      <h1>{title}</h1>
      {children}
    </main>
  )
}

function Field({ label, name, type = 'text', error, autoComplete }: { label: string; name: string; type?: string; error?: string; autoComplete?: string }) {
  return (
    <label>
      {label}
      <input name={name} type={type} required autoComplete={autoComplete} aria-invalid={!!error} />
      {error && <small className="error">{error}</small>}
    </label>
  )
}

/** Formulario genérico: recoge los campos, llama al endpoint y muestra errores por campo. */
function useForm(onSubmit: (data: Record<string, string>) => Promise<string | void>) {
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const msg = await onSubmit(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
      if (msg) setMessage(msg)
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }
  return { submit, error, message, busy }
}

export function Register() {
  const f = useForm(async (d) => (await api.post('/auth/register', d)).data.message)
  if (f.message) return <Card title="Revisa tu correo"><p>{f.message}</p><Link to="/login">Ir a iniciar sesión</Link></Card>
  const e = f.error?.fields ?? {}
  return (
    <Card title="Crear cuenta">
      <form onSubmit={f.submit}>
        <Field label="Nombre" name="firstName" error={e.firstName} autoComplete="given-name" />
        <Field label="Apellido" name="lastName" error={e.lastName} autoComplete="family-name" />
        <Field label="Email" name="email" type="email" error={e.email} autoComplete="email" />
        <Field label="Contraseña" name="password" type="password" error={e.password} autoComplete="new-password" />
        <Field label="Confirmar contraseña" name="confirmPassword" type="password" error={e.confirmPassword} autoComplete="new-password" />
        <small>Mínimo 10 caracteres, con letras y números.</small>
        {f.error && !Object.keys(e).length && <p className="error">{f.error.message}</p>}
        <button disabled={f.busy}>Registrarme</button>
      </form>
      <p><Link to="/login">Ya tengo cuenta</Link></p>
    </Card>
  )
}

export function VerifyEmail() {
  const token = useSearchParams()[0].get('token') ?? ''
  // Activar la cuenta exige el enlace del correo Y la contraseña del registro: así nadie puede registrar el email de otra persona.
  const f = useForm(async (d) => (await api.post('/auth/verify-email', { token, password: d.password })).data.message)
  if (!token) return <Card title="Confirmación de email"><p className="error">Enlace incompleto.</p><Link to="/resend-verification">Reenviar correo de confirmación</Link></Card>
  if (f.message) return <Card title="Cuenta activada"><p>{f.message}</p><Link to="/login">Iniciar sesión</Link></Card>
  return (
    <Card title="Confirma tu cuenta">
      <p>Para activarla, introduce la contraseña con la que te registraste.</p>
      <form onSubmit={f.submit}>
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" />
        {f.error && <p className="error">{f.error.message}</p>}
        <button disabled={f.busy}>Activar cuenta</button>
      </form>
      <p><Link to="/forgot-password">¿No la recuerdas? Recupérala y tu cuenta quedará activada</Link></p>
      {f.error?.code === 'INVALID_TOKEN' && <p><Link to="/resend-verification">Reenviar correo de confirmación</Link></p>}
    </Card>
  )
}

export function ResendVerification() {
  const f = useForm(async (d) => (await api.post('/auth/resend-verification', d)).data.message)
  return (
    <Card title="Reenviar confirmación">
      <form onSubmit={f.submit}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        {f.error && <p className="error">{f.error.message}</p>}
        {f.message && <p>{f.message}</p>}
        <button disabled={f.busy}>Reenviar</button>
      </form>
      <p><Link to="/login">Volver</Link></p>
    </Card>
  )
}

export function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const f = useForm(async (d) => { await login(d.email, d.password); nav('/') })
  if (user) return <Navigate to="/" replace />
  return (
    <Card title="Iniciar sesión">
      <form onSubmit={f.submit}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" />
        {f.error && <p className="error">{f.error.message}</p>}
        {f.error?.code === 'EMAIL_NOT_VERIFIED' && <Link to="/resend-verification">Reenviar correo de confirmación</Link>}
        <button disabled={f.busy}>Entrar</button>
      </form>
      <p><Link to="/forgot-password">¿Olvidaste tu contraseña?</Link></p>
      <p><Link to="/register">Crear cuenta</Link></p>
    </Card>
  )
}

export function ForgotPassword() {
  const f = useForm(async (d) => (await api.post('/auth/forgot-password', d)).data.message)
  return (
    <Card title="Recuperar contraseña">
      <form onSubmit={f.submit}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        {f.error && <p className="error">{f.error.message}</p>}
        {f.message && <p>{f.message}</p>}
        <button disabled={f.busy}>Enviar instrucciones</button>
      </form>
      <p><Link to="/login">Volver</Link></p>
    </Card>
  )
}

export function ResetPassword() {
  const token = useSearchParams()[0].get('token') ?? ''
  const f = useForm(async (d) => (await api.post('/auth/reset-password', { ...d, token })).data.message)
  if (f.message) return <Card title="Contraseña actualizada"><p>{f.message}</p><Link to="/login">Iniciar sesión</Link></Card>
  const e = f.error?.fields ?? {}
  return (
    <Card title="Nueva contraseña">
      <form onSubmit={f.submit}>
        <Field label="Nueva contraseña" name="password" type="password" error={e.password} autoComplete="new-password" />
        <Field label="Confirmar contraseña" name="confirmPassword" type="password" error={e.confirmPassword} autoComplete="new-password" />
        {f.error && !Object.keys(e).length && <p className="error">{f.error.message}</p>}
        <button disabled={f.busy}>Guardar</button>
      </form>
    </Card>
  )
}

export function Home() {
  const { user, can } = useAuth()
  if (user?.role === 'CLIENTE') return <Navigate to="/portal" replace />
  if (can('dashboard:read')) return <Dashboard />
  return (
    <section>
      <h1>Hola, {user?.firstName}</h1>
      <p>Sesión iniciada como <b>{user?.email}</b> ({user?.role}).</p>
    </section>
  )
}
