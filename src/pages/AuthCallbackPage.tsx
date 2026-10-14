import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Skeleton } from '@/components/ui/misc'

/**
 * OAuth callback landing page. Supabase parses the tokens from the URL
 * (detectSessionInUrl); we just wait for the session and route onward.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const callbackError = hash.get('error_description') ?? hash.get('error')
    if (callbackError) {
      setError(callbackError)
      return
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_IN' && session) {
        navigate('/', { replace: true })
      }
    })

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled && data.session) navigate('/', { replace: true })
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Login failed')
      })

    // Safety: if nothing happens in 8s, show a retry link.
    const timeout = window.setTimeout(() => {
      if (!cancelled) setError((prev) => prev ?? 'Login timed out. Please try again.')
    }, 8000)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      window.clearTimeout(timeout)
    }
  }, [navigate])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
      {error ? (
        <>
          <p className="text-sm text-destructive">{error}</p>
          <a href="/login" className="text-sm text-foreground underline">
            Back to login
          </a>
        </>
      ) : (
        <>
          <Skeleton className="size-8 rounded-full" />
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </>
      )}
    </div>
  )
}
