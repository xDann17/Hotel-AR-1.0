import { supabaseAdmin } from '@/lib/supabaseAdmin'

export type AppRole = 'front_desk' | 'manager' | 'admin'

type MemberRecord = {
  role: string | null
  org_id: string | null
}

function normalizeRole(role: string | null | undefined): AppRole | null {
  const raw = (role ?? '').toLowerCase()
  if (raw === 'admin') return 'admin'
  if (raw === 'manager') return 'manager'
  if (raw === 'front_desk') return 'front_desk'
  if (raw === 'staff') return 'manager'
  return null
}

export async function getMemberRoleAndHotels(userId: string): Promise<{
  role: AppRole | null
  hotelIds: string[]
  orgId: string | null
}> {
  const { data: member, error: memberErr } = await supabaseAdmin
    .from('members')
    .select('role, org_id')
    .eq('user_id', userId)
    .maybeSingle<MemberRecord>()

  if (memberErr) throw memberErr

  const role = normalizeRole(member?.role)
  const orgId = member?.org_id ?? null

  if (!role) {
    return { role: null, hotelIds: [], orgId }
  }

  if (role === 'admin') {
    const { data, error } = await supabaseAdmin
      .from('hotels')
      .select('id')
      .is('deleted_at', null)
      .order('name')

    if (error) throw error

    const hotelIds = (data ?? []).map((h: { id: string }) => h.id)
    return { role, hotelIds, orgId }
  }

  const { data, error } = await supabaseAdmin
    .from('member_hotels')
    .select('hotel_id')
    .eq('user_id', userId)

  if (error) throw error

  const hotelIds = (data ?? []).map((row: { hotel_id: string }) => row.hotel_id)
  return { role, hotelIds, orgId }
}
