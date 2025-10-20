'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { AppRole } from '@/lib/roles'

export function useRoleGate(allowed: AppRole[]) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [allowedIn, setAllowedIn] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u?.user) { router.replace('/login'); return }
      const { data, error } = await supabase
        .from('org_members')
        .select('role')
        .eq('user_id', u.user.id)
        .maybeSingle()

      if (cancelled) return
      const role = (data?.role ?? null) as AppRole | null

      const ok = role !== null && allowed.includes(role)
      setAllowedIn(ok)
      setReady(true)

      if (!ok) {
        // Send them somewhere safe (e.g., /me)
        router.replace('/me')
      }
    })()
    return () => { cancelled = true }
  }, [allowed, router])

  return { ready, allowedIn }
}
