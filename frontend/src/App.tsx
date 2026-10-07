import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './Layout'
import { ForgotPassword, Home, Login, Register, ResendVerification, ResetPassword, VerifyEmail } from './pages'
import UsersPage from './UsersPage'
import CustomersPage from './CustomersPage'
import CustomerDetail from './CustomerDetail'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout><Home /></AppLayout>} />
      <Route path="/admin/users" element={<AppLayout permission="user:read"><UsersPage /></AppLayout>} />
      <Route path="/customers" element={<AppLayout permission="customer:read"><CustomersPage /></AppLayout>} />
      <Route path="/customers/:id" element={<AppLayout permission="customer:read"><CustomerDetail /></AppLayout>} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/resend-verification" element={<ResendVerification />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  )
}
