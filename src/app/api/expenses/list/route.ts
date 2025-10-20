import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getMemberRoleAndHotels } from '@/lib/server-access'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

type Method = 'check' | 'ach' | 'card' | 'other'

type Row = {
  id: string
  expense_date: string
  amount: number
  method: Method | string
  reference: string | null
  notes: string | null
  project_id: string | null
  vendors: { name: string | null } | null
  expense_categories: { name: string | null } | null
}

function parseMethod(value: string | null): Method | undefined {
  if (!value) return undefined
  if (value === 'check' || value === 'ach' || value === 'card' || value === 'other') return value
  return undefined
}

export async function GET(req: NextRequest) {
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

  let roleInfo
  try {
    roleInfo = await getMemberRoleAndHotels(user.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve permissions'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!roleInfo.role || !['manager', 'admin'].includes(roleInfo.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const searchParams = req.nextUrl.searchParams
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const hotelId = searchParams.get('hotelId')
  const vendorId = searchParams.get('vendorId')
  const categoryId = searchParams.get('categoryId')
  const methodParam = parseMethod(searchParams.get('method'))
  const search = searchParams.get('search')?.trim().toLowerCase() ?? ''

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing date range' }, { status: 400 })
  }

  const accessibleHotels = new Set(roleInfo.hotelIds)
  let hotelsToQuery: string[] = []

  if (hotelId && hotelId !== 'all') {
    if (!accessibleHotels.has(hotelId)) {
      return NextResponse.json({ error: 'You do not have access to that hotel' }, { status: 403 })
    }
    hotelsToQuery = [hotelId]
  } else {
    hotelsToQuery = Array.from(accessibleHotels)
  }

  if (!hotelsToQuery.length) {
    return NextResponse.json({ rows: [], hotelIds: Array.from(accessibleHotels) })
  }

  let query = supabaseAdmin
    .from('expenses')
    .select(
      `id, expense_date, amount, method, reference, notes, project_id,
       vendors(name), expense_categories(name)`
    )
    .gte('expense_date', from)
    .lte('expense_date', to)
    .in('hotel_id', hotelsToQuery)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (vendorId) {
    query = query.eq('vendor_id', vendorId)
  }

  if (categoryId) {
    query = query.eq('category_id', categoryId)
  }

  if (methodParam) {
    query = query.eq('method', methodParam)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json(
      { error: error.message ?? 'Failed to load expenses' },
      { status: 500 },
    )
  }

  const rows = (data ?? []) as Row[]

  const filtered = search
    ? rows.filter(row => {
        const haystack = [
          row.vendors?.name ?? '',
          row.expense_categories?.name ?? '',
          row.reference ?? '',
          row.notes ?? '',
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(search)
      })
    : rows

  const mapped = filtered.map(row => ({
    id: row.id,
    expense_date: row.expense_date,
    amount: Number(row.amount ?? 0),
    method: row.method,
    reference: row.reference ?? null,
    notes: row.notes ?? null,
    project_id: row.project_id ?? null,
    vendor_name: row.vendors?.name ?? null,
    category_name: row.expense_categories?.name ?? null,
  }))

  return NextResponse.json({ rows: mapped, hotelIds: Array.from(accessibleHotels) })
}
