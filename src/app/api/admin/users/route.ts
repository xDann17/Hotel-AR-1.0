import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/admin/users
export async function GET() {
  // list first 200 users; adjust as needed
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data.users.map(u => ({ id: u.id, email: u.email })) })
}
