import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  // Warning only — the app renders a notice on the login page instead of crashing,
  // so the project can still build without credentials.
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env and fill in your Supabase project values.',
  )
}

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const ASSETS_BUCKET = 'project-assets'
export const PUBLISH_BUCKET = 'published'
