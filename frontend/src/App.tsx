import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './Layout'
import { ForgotPassword, Home, Login, Register, ResendVerification, ResetPassword, VerifyEmail } from './pages'
import UsersPage from './UsersPage'
import RepairsPage from './RepairsPage'
import NewRepair from './NewRepair'
import RepairDetail from './RepairDetail'
import Receipt from './Receipt'
import CustomersPage from './CustomersPage'
import CustomerDetail from './CustomerDetail'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout><Home /></AppLayout>} />
      <Route path="/admin/users" element={<AppLayout permission="user:read"><UsersPage /></AppLayout>} />
      <Route path="/customers" element={<AppLayout permission="customer:read"><CustomersPage /></AppLayout>} />
      <Route path="/customers/:id" element={<AppLayout permission="customer:read"><CustomerDetail /></AppLayout>} />
      <Route path="/repairs" element={<AppLayout permission="repair:read"><RepairsPage /></AppLayout>} />
      <Route path="/repairs/new" element={<AppLayout permission="repair:create"><NewRepair /></AppLayout>} />
      <Route path="/repairs/:id" element={<AppLayout permission="repair:read"><RepairDetail /></AppLayout>} />
      <Route path="/repairs/:id/receipt" element={<AppLayout permission="repair:read"><Receipt /></AppLayout>} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/resend-verification" element={<ResendVerification />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  )
}
