import type { JSX } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';

import type { Permission } from '@ifp/shared';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { AppShell } from '@/layouts/AppShell';
import { EmptyState, LoadingState, PageBody, PageHeader } from '@/components/app-ui';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from '@/pages/auth/AuthPages';
import { DashboardPage } from '@/pages/Dashboard';
import { ClientListPage } from '@/pages/clients/ClientList';
import { ClientFormPage } from '@/pages/clients/ClientForm';
import { ClientDetailPage } from '@/pages/clients/ClientDetail';
import { CaseListPage, CaseNewPage } from '@/pages/cases/CaseListNew';
import { CaseDetailPage } from '@/pages/cases/CaseDetail';
import { AuditPage, FirmSettingsPage, UsersPage } from '@/pages/admin/AdminPages';
import { ExtensionPage, FieldMapPage } from '@/pages/extension/ExtensionPages';
import { PlatformFirmsPage } from '@/pages/platform/PlatformPages';
import { PlatformOverviewPage } from '@/pages/platform/PlatformOverview';
import { PlatformLicensesPage } from '@/pages/platform/LicensesPage';

function RequireAuth({ permission, children }: { permission?: Permission; children: JSX.Element }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState label="Checking your session…" />;

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // A platform administrator reaching a firm screen is not a permissions
  // accident to explain — it is a wrong turn, usually a bookmark or a typed
  // URL. Their console is somewhere else, so take them there.
  if (permission && !can(permission) && can('platform:admin')) {
    return <Navigate to="/platform" replace />;
  }

  // UI gating only — the API independently enforces every permission.
  if (permission && !can(permission)) {
    return (
      <>
        <PageHeader title="Not available to your role" />
        <PageBody>
          <EmptyState
            icon={Lock}
            title="Your role does not include this area"
            description="Ask a firm admin if you need access. The API enforces this independently of what the interface shows."
          />
        </PageBody>
      </>
    );
  }

  return children;
}

function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <LoginPage />
                </RedirectIfAuthed>
              }
            />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />

            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              {/*
                * The case dashboard is a firm screen like any other, and now
                * says so. A platform admin lands on /platform instead —
                * RequireAuth redirects them rather than showing three zeroes.
                */}
              <Route
                path="/"
                element={
                  <RequireAuth permission="case:read">
                    <DashboardPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/clients"
                element={
                  <RequireAuth permission="client:read">
                    <ClientListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/clients/new"
                element={
                  <RequireAuth permission="client:write">
                    <ClientFormPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/clients/:id"
                element={
                  <RequireAuth permission="client:read">
                    <ClientDetailPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/clients/:id/edit"
                element={
                  <RequireAuth permission="client:write">
                    <ClientFormPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/cases"
                element={
                  <RequireAuth permission="case:read">
                    <CaseListPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/cases/new"
                element={
                  <RequireAuth permission="case:write">
                    <CaseNewPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/cases/:id"
                element={
                  <RequireAuth permission="case:read">
                    <CaseDetailPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/admin/users"
                element={
                  <RequireAuth permission="user:manage">
                    <UsersPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/firm"
                element={
                  <RequireAuth permission="firm:manage">
                    <FirmSettingsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <RequireAuth permission="audit:read">
                    <AuditPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/extension"
                element={
                  <RequireAuth permission="case:read">
                    <ExtensionPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/extension/maps/:id"
                element={
                  <RequireAuth permission="case:write">
                    <FieldMapPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/platform"
                element={
                  <RequireAuth permission="platform:admin">
                    <PlatformOverviewPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/platform/firms"
                element={
                  <RequireAuth permission="platform:admin">
                    <PlatformFirmsPage />
                  </RequireAuth>
                }
              />

              <Route
                path="/platform/licenses"
                element={
                  <RequireAuth permission="platform:admin">
                    <PlatformLicensesPage />
                  </RequireAuth>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
