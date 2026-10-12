import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './Layout'
import { ForgotPassword, Home, Login, Register, ResendVerification, ResetPassword, VerifyEmail } from './pages'
import UsersPage from './UsersPage'
import RepairsPage from './RepairsPage'
import NewRepair from './NewRepair'
import RepairDetail from './RepairDetail'
import Receipt from './Receipt'
import QuoteApproval from './QuoteApproval'
import QuoteDocument from './QuoteDocument'
import { AdminAudit, AdminEmails } from './AdminPages'
import { PortalHome, PortalList, PortalQuotePrint, PortalReceipt, PortalRepair } from './PortalPages'
import PortalRequest from './PortalRequest'
import { PublicConfirm, PublicLookup, PublicRequest } from './PublicPages'
import SystemPage, { ParamsPage } from './ConfigPage'
import CatalogsPage from './CatalogsPage'
import Profile from './Profile'
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
      <Route path="/portal" element={<AppLayout role="CLIENTE"><PortalHome /></AppLayout>} />
      <Route path="/solicitar" element={<PublicRequest />} />
      <Route path="/solicitud/confirmar" element={<PublicConfirm />} />
      <Route path="/consulta" element={<PublicLookup />} />
      <Route path="/portal/nueva" element={<AppLayout role="CLIENTE"><PortalRequest /></AppLayout>} />
      <Route path="/portal/reparaciones" element={<AppLayout role="CLIENTE"><PortalList /></AppLayout>} />
      <Route path="/perfil" element={<AppLayout><Profile /></AppLayout>} />
      <Route path="/portal/repairs/:id" element={<AppLayout role="CLIENTE"><PortalRepair /></AppLayout>} />
      <Route path="/portal/repairs/:id/receipt" element={<AppLayout role="CLIENTE"><PortalReceipt /></AppLayout>} />
      <Route path="/repairs/:id/quote/print" element={<AppLayout permission="quote:read"><QuoteDocument /></AppLayout>} />
      <Route path="/portal/repairs/:id/quote/print" element={<AppLayout role="CLIENTE"><PortalQuotePrint /></AppLayout>} />
      <Route path="/admin/emails" element={<AppLayout permission="emaillog:read"><AdminEmails /></AppLayout>} />
      <Route path="/config/catalogs" element={<AppLayout permission="settings:read"><CatalogsPage /></AppLayout>} />
      <Route path="/config/params" element={<AppLayout permission="settings:read"><ParamsPage /></AppLayout>} />
      <Route path="/config/system" element={<AppLayout permission="settings:read"><SystemPage /></AppLayout>} />
      <Route path="/admin/audit" element={<AppLayout permission="audit:read"><AdminAudit /></AppLayout>} />
      <Route path="/quote-approval" element={<QuoteApproval />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/resend-verification" element={<ResendVerification />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  )
}
