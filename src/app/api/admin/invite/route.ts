import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const { email, redirectTo } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }

    const url =
      redirectTo ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      'http://localhost:3000'

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: url }
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: data.user?.id, email })
  } catch (e: any) {
    // Always return JSON so the client can parse it
    const msg = e?.message ?? 'Unexpected server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
