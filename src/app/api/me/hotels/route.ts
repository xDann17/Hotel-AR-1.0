import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getMemberRoleAndHotels } from '@/lib/server-access'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const info = await getMemberRoleAndHotels(user.id)
    return NextResponse.json(info)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load member access'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
