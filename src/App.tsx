import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/store/auth'
import logoUrl from '@/assets/logo.svg'
import { LoginPage } from '@/pages/LoginPage'
import { AuthCallbackPage } from '@/pages/AuthCallbackPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { EditorPage } from '@/pages/EditorPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AiChatlogPage } from '@/pages/AiChatlogPage'
import { LoadingScreen } from '@/components/ui/misc'
import { Toaster } from '@/components/ui/toast'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
})

function FullPageSpinner() {
  return <LoadingScreen label="Restoring session…" />
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Deteksi layar sempit (perangkat mobile) berbasis lebar viewport. */
function useSmallScreen() {
  const [small, setSmall] = useState(
    () => window.matchMedia('(max-width: 768px)').matches,
  )
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return small
}

/** Halaman blokir saat aplikasi dibuka dari perangkat mobile. */
function MobileBlockedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <img src={logoUrl} alt="Logo Yurchat" className="size-16 rounded-2xl" />
      <h1 className="text-lg font-semibold">Versi mobile sedang dikembangkan</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        Yurchat belum tersedia untuk perangkat mobile. Silakan buka melalui
        laptop atau PC untuk pengalaman penuh.
      </p>
    </div>
  )
}

function MobileGate({ children }: { children: React.ReactNode }) {
  const small = useSmallScreen()
  if (small) return <MobileBlockedPage />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <MobileGate>
            <Routes>
              <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginPage />
                </PublicOnlyRoute>
              }
            />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/project/:projectId"
              element={
                <ProtectedRoute>
                  <EditorPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/ai-chatlog"
              element={
                <ProtectedRoute>
                  <AiChatlogPage />
                </ProtectedRoute>
              }
            />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Toaster />
          </MobileGate>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
