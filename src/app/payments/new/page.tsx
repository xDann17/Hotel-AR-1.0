'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '@/lib/supabase'

/* ---------- ACCESS GATE (manager/admin only) ---------- */
type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'

function normalizeRole(input: any): string {
  if (!input) return ''
  if (typeof input === 'string') return input.trim().toLowerCase()
  if (Array.isArray(input)) {
    for (const it of input) {
      const s = normalizeRole(it)
      if (s) return s
    }
    return ''
  }
  if (typeof input === 'object') {
    const tryKeys = ['role', 'app_role', 'user_role', 'get_my_role']
    for (const k of tryKeys) {
      if (k in input && typeof (input as any)[k] === 'string') {
        return String((input as any)[k]).trim().toLowerCase()
      }
    }
    for (const v of Object.values(input as Record<string, any>)) {
      if (typeof v === 'string') return v.trim().toLowerCase()
    }
  }
  return ''
}

function useGateForPayments() {
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/login'; return }

      // Admin fast path
      const { data: adm } = await supabase.rpc('is_admin')
      if (!ignore && adm === true) { setAllowed(true); return }

      // Role via RPC (robust parsing)
      const { data: r } = await supabase.rpc('get_my_role')
      let roleStr = normalizeRole(r)

      // Fallback: user/app metadata
      const { data: u } = await supabase.auth.getUser()
      const metaRole = normalizeRole(u?.user?.user_metadata?.role ?? u?.user?.app_metadata?.role)

      const finalRole = roleStr || metaRole
      const ok =
        finalRole === 'manager' ||
        finalRole === 'admin'   ||
        finalRole.startsWith('manager') ||
        finalRole.startsWith('admin')

      if (!ignore) setAllowed(ok)
    })()
    return () => { ignore = true }
  }, [])

  return { allowed, checked: allowed !== null }
}
/* ------------------------------------------------------ */

type Hotel = { id: string; name: string }
type Invoice = {
  id: string
  number: string | null
  balance: number
  hotel_id: string | null
  company_id: string | null
  client_id: string | null
  check_in: string | null
  check_out: string | null
  companies?: { name: string | null } | null
  clients?: { name: string | null } | null
}

const paySchema = z.object({
  method: z.enum(['check', 'ach', 'card', 'other']).default('check'),
  reference: z.string().optional(),
  amount: z.coerce.number().min(0.01, 'Amount must be > 0'),
  received_date: z.string().min(1, 'Required'),
  check_date: z.string().optional().nullable(),
})

type PayForm = z.infer<typeof paySchema>

export default function NewPaymentPage() {
  const gate = useGateForPayments()

  if (gate.checked && gate.allowed === false) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Record payment</h1>
        <p className="text-gray-600 text-lg">You don’t have access to view this page.</p>
      </main>
    )
  }

  if (gate.allowed !== true) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Record payment</h1>
        <p>Loading…</p>
      </main>
    )
  }

  return <NewPaymentContent />
}

function NewPaymentContent() {
  const router = useRouter()

  const [hotels, setHotels] = useState<Hotel[]>([])
  const [hotelId, setHotelId] = useState<string>('') // '' = all hotels
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // --- NEW extra filters (match invoices page style) ---
  const [invSearch, setInvSearch] = useState('')
  const [year, setYear] = useState<number | 'all'>('all')
  const [month, setMonth] = useState<number | 'all'>('all')
  const [companyId, setCompanyId] = useState<string | 'all'>('all')
  // -----------------------------------------------------

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PayForm>({
    resolver: zodResolver(paySchema),
    defaultValues: {
      method: 'check',
      reference: '',
      amount: 0,
      received_date: new Date().toISOString().slice(0, 10),
      check_date: null,
    },
  })

  const watchAmount = watch('amount') || 0
  const watchMethod = watch('method')

  // Lookups: hotels (exclude soft-deleted)
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setErr(null)

      try {
        const { error: hErr, data: hs } = await supabase
          .from('hotels')
          .select('id, name')
          .is('deleted_at', null)
          .order('name', { ascending: true })
        if (hErr) throw hErr

        setHotels((hs ?? []) as Hotel[])
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load hotels')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Load invoices with optional hotel filter (exclude soft-deleted invoices)
  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        let q = supabase
          .from('invoices')
          .select(`
            id,
            number,
            balance,
            hotel_id,
            company_id,
            client_id,
            check_in,
            check_out,
            companies(name),
            clients(name)
          `)
          .is('deleted_at', null)
          .neq('status', 'paid')
          .gt('balance', 0)
          .order('check_in', { ascending: true })

        if (hotelId) q = q.eq('hotel_id', hotelId)

        const { data, error } = await q
        if (error) throw error

        setInvoices((data ?? []) as Invoice[])
        setAlloc({})
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load invoices')
      }
    })()
  }, [hotelId])

  // Build helpers
  const byId = useMemo(() => {
    const m = new Map<string, Invoice>()
    for (const inv of invoices) m.set(inv.id, inv)
    return m
  }, [invoices])

  // Years list (for dropdown)
  const years = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const arr: number[] = []
    for (let y = thisYear + 1; y >= thisYear - 6; y--) arr.push(y)
    return arr
  }, [])

  // Companies present in the loaded invoices (for dropdown)
  const companiesForFilter = useMemo(() => {
    const seen = new Map<string, string>()
    for (const inv of invoices) {
      if (inv.company_id && (inv.companies?.name ?? '').trim()) {
        seen.set(inv.company_id, (inv.companies?.name ?? '').trim())
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [invoices])

  function startOfMonth(year: number, month1_12: number) {
    return `${year}-${String(month1_12).padStart(2, '0')}-01`
  }
  function endOfMonth(year: number, month1_12: number) {
    const last = new Date(year, month1_12, 0)
    const y = last.getFullYear()
    const m = String(last.getMonth() + 1).padStart(2, '0')
    const d = String(last.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // Filtered list (search, year, month, company, hotel already upstream)
  const filteredInvoices = useMemo(() => {
    let list = invoices

    // Year/month by check-in date
    const ymd = (d: string | null) => {
        if (!d) return { y: NaN, m: NaN }

        const parts = d.split('-').map((n) => Number(n))
        return { y: parts[0], m: parts[1] }
      }

      if (year !== 'all' && month === 'all') {

        list = list.filter((inv) => inv.check_in && ymd(inv.check_in).y == year)
      } else if (year !== 'all' && month !== 'all') {

        list = list.filter((inv) => {
            if (!inv.check_in) return false
            const { y, m } = ymd(inv.check_in)
            return y === year && m === month
        })
    } else if (year === 'all' && month !== 'all') {

        list = list.filter((inv) => inv.check_in && ymd(inv.check_in).m == month)
    }

    // Company filter
    if (companyId !== 'all') {
      list = list.filter((inv) => inv.company_id === companyId)
    }

    // Text search across number + names
    const s = invSearch.trim().toLowerCase()
    if (s) {
      list = list.filter((inv) => {
        const num = (inv.number ?? inv.id).toLowerCase()
        const cName = (inv.clients?.name ?? '').toLowerCase()
        const coName = (inv.companies?.name ?? '').toLowerCase()
        return num.includes(s) || cName.includes(s) || coName.includes(s)
      })
    }

    return list
  }, [invoices, invSearch, year, month, companyId])

  const allocatedTotal = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0),
    [alloc]
  )
  const remaining = Math.max(0, (watchAmount || 0) - allocatedTotal)

  function setAllocFor(id: string, value: string) {
    const raw = Number(value)
    let num = Number.isFinite(raw) ? raw : 0
    const bal = byId.get(id)?.balance ?? 0
    if (num < 0) num = 0
    if (num > bal) num = bal
    setAlloc(prev => ({ ...prev, [id]: num }))
  }

  function clearAllocations() {
    setAlloc({})
  }
  function allocateRemainingTo(id: string) {
    const bal = byId.get(id)?.balance ?? 0
    const current = alloc[id] ?? 0
    const room = Math.max(0, bal - current)
    if (room <= 0 || remaining <= 0) return
    const add = Math.min(room, remaining)
    setAlloc(prev => ({ ...prev, [id]: Number((current + add).toFixed(2)) }))
  }

  const referenceLabel = useMemo(() => {
    switch (watchMethod) {
      case 'check': return 'Reference (Check #)'
      case 'card': return 'Reference (Last 4 / Auth #)'
      case 'ach': return 'Reference (ACH id)'
      default: return 'Reference'
    }
  }, [watchMethod])

  function fmtDate(d: string | null) {
    if (!d) return ''
    const dt = new Date(`${d}T00:00:00`)
    return dt.toLocaleDateString()
  }

  async function onSubmit(values: PayForm) {
    if (allocatedTotal > values.amount + 1e-6) {
      alert('Allocated more than payment amount.')
      return
    }

    if (values.method === 'check' && !values.reference?.trim()) {
      if (!confirm('No check reference provided. Continue?')) return
    }
    if (values.method === 'card' && values.reference && !/^\d{4}$/.test(values.reference.trim())) {
      if (!confirm('Card reference is not 4 digits. Continue?')) return
    }

    const { data: rpc, error: pErr } = await supabase
      .rpc('api_insert_payment', {
        p_method: values.method,
        p_reference: values.reference ?? '',
        p_amount: values.amount,
        p_received_date: values.received_date,
        p_check_date: values.check_date || null,
      })
      .single()

    if (pErr || !rpc?.id) {
      setErr(pErr?.message || 'Payment insert failed (RLS)')
      return
    }
    const newPaymentId: string = rpc.id

    const rows = Object.entries(alloc)
      .map(([invoice_id, amt]) => ({
        payment_id: newPaymentId,
        invoice_id,
        amount: Number(amt) || 0,
      }))
      .filter((r) => r.amount > 0)

    if (rows.length > 0) {
      const { error: aErr } = await supabase.from('allocations').insert(rows)
      if (aErr) {
        setErr('Allocation failed: ' + aErr.message)
        return
      }
    }

    router.replace('/invoices')
  }

  if (loading) return <main className="max-w-3xl mx-auto p-6">Loading…</main>
  if (err) return <main className="max-w-3xl mx-auto p-6 text-red-600">Error: {err}</main>

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Record payment</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Method</label>
            <select {...register('method')} className="w-full border rounded p-2">
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">{referenceLabel}</label>
            <input {...register('reference')} className="w-full border rounded p-2" placeholder="Check # / ACH id / Last 4" />
          </div>

          <div>
            <label className="block text-sm font-medium">Received date</label>
            <input type="date" {...register('received_date')} className="w-full border rounded p-2" />
            {errors.received_date && <p className="text-red-600 text-sm">{errors.received_date.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium">Check date</label>
            <input type="date" {...register('check_date')} className="w-full border rounded p-2" />
          </div>

          <div>
            <label className="block text-sm font-medium">Amount</label>
            <input
              type="number" step="0.01" min={0.01} inputMode="decimal"
              {...register('amount')} className="w-full border rounded p-2" placeholder="0.00"
            />
            {errors.amount && <p className="text-red-600 text-sm">{errors.amount.message}</p>}
          </div>
        </div>

        {/* Filters (same spirit as invoices page) */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <label className="text-sm">Hotel</label>
              <select value={hotelId} onChange={(e) => setHotelId(e.target.value)} className="border rounded p-2">
                <option value="">All hotels</option>
                {hotels.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <input
              className="border rounded p-2 flex-1"
              placeholder="Search number / company / client…"
              value={invSearch}
              onChange={(e) => setInvSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={year}
              onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="border rounded p-2"
            >
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <select
              value={month}
              onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="border rounded p-2"
            >
              <option value="all">All months</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' })}
                </option>
              ))}
            </select>

            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value as any)}
              className="border rounded p-2"
            >
              <option value="all">All companies</option>
              {companiesForFilter
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="border rounded">
          <div className="p-3 font-semibold bg-gray-50">Allocate to invoices</div>
          <div className="p-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2">Company</th>
                  <th className="text-left p-2">Client</th>
                  <th className="text-left p-2">Check-in</th>
                  <th className="text-left p-2">Check-out</th>
                  <th className="text-left p-2">Inv #</th>
                  <th className="text-right p-2">Balance</th>
                  <th className="text-right p-2">Allocate</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => {
                  const v = alloc[inv.id] ?? 0
                  const co = inv.companies?.name ?? ''
                  const cl = inv.clients?.name ?? ''
                  return (
                    <tr key={inv.id} className="border-t">
                      <td className="p-2">{co}</td>
                      <td className="p-2">{cl}</td>
                      <td className="p-2">{fmtDate(inv.check_in)}</td>
                      <td className="p-2">{fmtDate(inv.check_out)}</td>
                      <td className="p-2">{inv.number || inv.id.slice(0,6)}</td>
                      <td className="p-2 text-right">${Number(inv.balance || 0).toFixed(2)}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number" step="0.01" min="0" max={inv.balance}
                          value={v === 0 ? '' : v}
                          onChange={(e) => setAllocFor(inv.id, e.target.value)}
                          className="w-32 border rounded p-1 text-right"
                        />
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() => allocateRemainingTo(inv.id)}
                          title="Allocate remaining amount to this invoice"
                        >
                          Allocate remaining
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-3 text-center text-gray-500">No open invoices.</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
              <div className="ml-auto flex gap-6">
                <div>Allocated: <b>${allocatedTotal.toFixed(2)}</b></div>
                <div>Remaining: <b>${remaining.toFixed(2)}</b></div>
              </div>
              <button type="button" className="text-xs underline" onClick={clearAllocations}>
                Clear allocations
              </button>
            </div>

            {allocatedTotal > (watchAmount || 0) && (
              <p className="text-red-600 text-sm mt-2">You allocated more than the payment amount.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={isSubmitting} className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-60">
            {isSubmitting ? 'Saving…' : 'Save payment'}
          </button>
          <button type="button" onClick={() => router.back()} className="underline text-sm">Cancel</button>
        </div>
      </form>
    </main>
  )
}
