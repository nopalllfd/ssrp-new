import { useAuth } from '@/store/auth'
import logoUrl from '@/assets/logo.svg'
import { Button } from '@/components/ui/button'

export function LoginPage() {
  const { signInWithGoogle, error } = useAuth()
  const missingEnv =
    !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-card-foreground">
        <div className="mb-6 flex items-center gap-3">
          <img src={logoUrl} alt="Logo Yurchat" className="size-10 shrink-0 rounded-md" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Yurchat</h1>
              <span className="rounded-full border border-border bg-accent/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Beta 1.0.0
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Screenshot editor untuk komunitas roleplay SA-MP
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              New release — masih dalam masa beta testing 1.0.0.
            </p>
          </div>
        </div>

        {missingEnv && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            Supabase belum dikonfigurasi. Isi <code>.env</code> dari{' '}
            <code>.env.example</code> lalu restart dev server.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={() => void signInWithGoogle()}
          disabled={missingEnv}
        >
          <GoogleIcon /> Sign in with Google
        </Button>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Hanya akun Google. Sesi tersimpan otomatis di browser ini.
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v3.8h5.35c-.5 2.4-2.55 3.6-5.35 3.6a5.9 5.9 0 1 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.85-2.85A9.2 9.2 0 1 0 12 21.2c5.3 0 9-3.7 9-9 0-.35-.05-.75-.15-1.1Z"
      />
    </svg>
  )
}
