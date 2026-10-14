import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/store/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/misc'
import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'

export function ProfilePage() {
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState(
    (user?.user_metadata?.full_name as string | undefined) ?? '',
  )
  const [saved, setSaved] = useState<string | null>(null)

  const profileQuery = useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single()
      if (error) throw new Error(error.message)
      if (data?.display_name) setDisplayName(data.display_name as string)
      return data
    },
  })

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined

  const save = async () => {
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName })
      .eq('id', user.id)
    setSaved(error ? error.message : 'Saved.')
    await supabase.auth.updateUser({ data: { full_name: displayName } })
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link to="/">
        <Button variant="ghost" size="sm">
          <ArrowLeft /> Dashboard
        </Button>
      </Link>
      <h1 className="mt-4 mb-6 text-xl font-semibold">Profile</h1>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-14 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-full bg-secondary text-lg font-semibold">
              {displayName.slice(0, 1).toUpperCase() || '?'}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{displayName || 'Unnamed'}</p>
            <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="display_name">Display name</Label>
          <Input
            id="display_name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
          />
          {profileQuery.data?.created_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Joined {formatDateTime(profileQuery.data.created_at as string)}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => void save()}>Save</Button>
            {saved && <p className="text-xs text-muted-foreground">{saved}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
