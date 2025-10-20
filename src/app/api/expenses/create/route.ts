import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getMemberRoleAndHotels } from '@/lib/server-access'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

type Method = 'check' | 'ach' | 'card' | 'other'

type Payload = {
  hotel_id?: string
  expense_date?: string
  vendor_id?: string
  category_id?: string | null
  amount?: number
  method?: Method
  reference?: string | null
  notes?: string | null
}

const METHODS: Method[] = ['check', 'ach', 'card', 'other']

function invalid(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError) {
    return invalid(authError.message, 500)
  }

  if (!user) {
    return invalid('Not authenticated', 401)
  }

  let roleInfo
  try {
    roleInfo = await getMemberRoleAndHotels(user.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve permissions'
    return invalid(message, 500)
  }

  if (!roleInfo.role || !['manager', 'admin'].includes(roleInfo.role)) {
    return invalid('Forbidden', 403)
  }

  const body: Payload = await req.json()
  const hotelId = body.hotel_id
  const vendorId = body.vendor_id
  const categoryId = body.category_id ?? null
  const expenseDate = body.expense_date
  const amount = Number(body.amount)
  const method = body.method
  const reference = body.reference ?? null
  const notes = body.notes ?? null

  if (!hotelId) return invalid('hotel_id is required')
  if (!vendorId) return invalid('vendor_id is required')
  if (!expenseDate) return invalid('expense_date is required')
  if (!Number.isFinite(amount) || amount <= 0) return invalid('amount must be greater than 0')
  if (!method || !METHODS.includes(method)) return invalid('method is invalid')

  const accessibleHotels = new Set(roleInfo.hotelIds)
  if (!accessibleHotels.has(hotelId)) {
    return invalid('You do not have access to this hotel', 403)
  }

  const insert = {
    hotel_id: hotelId,
    expense_date: expenseDate,
    vendor_id: vendorId,
    category_id: categoryId,
    amount,
    method,
    reference,
    notes,
    created_by: user.id,
  }

  const { data, error } = await supabaseAdmin
    .from('expenses')
    .insert(insert)
    .select('id')
    .single<{ id: string }>()

  if (error) {
    return invalid(error.message ?? 'Failed to create expense', 500)
  }

  return NextResponse.json({ id: data.id })
}
