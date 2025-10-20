'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

/* ---------- ACCESS GATE (manager/admin only) ---------- */
type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'

function normalizeRole(input: any): string {
  if (!input) return ''
  // string directly
  if (typeof input === 'string') return input.trim().toLowerCase()
  // array of results (e.g., [{ role: 'manager' }])
  if (Array.isArray(input)) {
    for (const it of input) {
      const s = normalizeRole(it)
      if (s) return s
    }
    return ''
  }
  // object: try common keys or the first string value
  if (typeof input === 'object') {
    const tryKeys = ['role', 'app_role', 'user_role', 'get_my_role']
    for (const k of tryKeys) {
      if (k in input && typeof (input as any)[k] === 'string') {
        return String((input as any)[k]).trim().toLowerCase()
      }
    }
    // fallback: first string-looking prop
    for (const v of Object.values(input as Record<string, any>)) {
      if (typeof v === 'string') return v.trim().toLowerCase()
    }
  }
  return ''
}

function useGateForPayments() {
  const [allowed, setAllowed] = useState<boolean | null>(null) // null = checking

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/login'; return }

      // 1) Admins pass immediately
      const { data: isAdm } = await supabase.rpc('is_admin')
      if (!ignore && isAdm === true) { setAllowed(true); return }

      // 2) Try get_my_role RPC (be very defensive with shapes)
      const { data: r } = await supabase.rpc('get_my_role')
      let roleStr = normalizeRole(r)

      // 3) Fallback to auth user metadata
      const { data: u } = await supabase.auth.getUser()
      const metaRole = normalizeRole(u?.user?.user_metadata?.role ?? u?.user?.app_metadata?.role)

      // Prefer explicit role from RPC; fall back to metadata if needed
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

type Hotel   = { id: string; name: string }
type Company = { id: string; name: string }

type PaymentRow = {
  id: string
  amount: number
  method: 'check' | 'ach' | 'card' | 'other' | string
  reference: string | null
  received_date: string
  customer_id: string | null
}

type Allocation = {
  payment_id: string
  invoice_id: string
  amount: number
  invoice_company_id: string | null
  invoice_hotel_id: string | null
}

function fmtMoney(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

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

export default function PaymentsPage() {
  const gate = useGateForPayments()

  if (gate.checked && gate.allowed === false) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-semibold">Payments</h1>
          <Link href="/#" className="rounded bg-white border px-3 py-2 text-sm">Home</Link>
        </div>
        <p className="text-gray-600 text-lg">You don’t have access to view this page.</p>
      </main>
    )
  }

  if (gate.allowed !== true) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Payments</h1>
        <p>Loading…</p>
      </main>
    )
  }

  return <PaymentsContent />
}

function PaymentsContent() {
  // filters
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  // Default to current year so Month works out of the box
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [month, setMonth] = useState<number | 'all'>('all')
  const [companyId, setCompanyId] = useState<string | 'all'>('all')
  const [hotelId, setHotelId] = useState<string | 'all'>('all')

  // lookups
  const [companies, setCompanies] = useState<Company[]>([])
  const [hotels, setHotels] = useState<Hotel[]>([])

  // data
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [allocs, setAllocs] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // lookups
  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        const [{ data: cs, error: cErr }, { data: hs, error: hErr }] = await Promise.all([
          supabase.from('companies').select('id, name').order('name'),
          supabase.from('hotels').select('id, name').order('name'),
        ])
        if (cErr) throw cErr
        if (hErr) throw hErr
        setCompanies((cs ?? []) as Company[])
        setHotels((hs ?? []) as Hotel[])
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load lookups')
      }
    })()
  }, [])

  async function fetchAll() {
    setLoading(true); setErr(null); setMsg(null)
    try {
      // Treat 'all' as current year so month filters always work
      const currentYear = new Date().getFullYear()
      const effectiveYear = year === 'all' ? currentYear : year

      // 1) payments
      let q = supabase
        .from('payments')
        .select('id, amount, method, reference, received_date, customer_id')
        .order('received_date', { ascending: false })

      if (month === 'all') {
        q = q.gte('received_date', `${effectiveYear}-01-01`).lte('received_date', `${effectiveYear}-12-31`)
      } else {
        q = q.gte('received_date', startOfMonth(effectiveYear, month)).lte('received_date', endOfMonth(effectiveYear, month))
      }

      if (search) {
        const like = `%${search}%`
        q = q.or(`reference.ilike.${like},method.ilike.${like}`)
      }

      const { data: payments, error: pErr } = await q
      if (pErr) throw pErr
      const payRows = (payments ?? []) as PaymentRow[]
      setRows(payRows)

      // 2) allocations (only those whose invoices still exist)
      const payIds = payRows.map(p => p.id)
      if (payIds.length) {
        const { data: a, error: aErr } = await supabase
          .from('allocations')
          .select(`
            payment_id,
            invoice_id,
            amount,
            invoices!inner (
              id,
              company_id,
              hotel_id
            )
          `)
          .in('payment_id', payIds)

        if (aErr) throw aErr

        const flat: Allocation[] = (a ?? []).map((row: any) => ({
          payment_id: row.payment_id,
          invoice_id: row.invoice_id,
          amount: Number(row.amount || 0),
          invoice_company_id: row.invoices?.company_id ?? null,
          invoice_hotel_id: row.invoices?.hotel_id ?? null,
        }))

        setAllocs(flat)
      } else {
        setAllocs([])
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load payments')
      setRows([])
      setAllocs([])
    } finally {
      setLoading(false)
    }
  }

  // initial + whenever filters change
  useEffect(() => { fetchAll() }, [search, year, month])

  // Active hotels
  const activeHotelIds = useMemo(() => new Set(hotels.map(h => h.id)), [hotels])

  // Map: payment -> applied sum (only allocations that point to an existing hotel)
  const appliedByPayment = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of allocs) {
      if (a.invoice_hotel_id && activeHotelIds.has(a.invoice_hotel_id)) {
        map.set(a.payment_id, (map.get(a.payment_id) ?? 0) + Number(a.amount || 0))
      }
    }
    return map
  }, [allocs, activeHotelIds])

  // Build helper index for filter checks
  const indexByPayment = useMemo(() => {
    const byPayment = new Map<string, { companies: Set<string>, hotels: Set<string> }>()
    for (const a of allocs) {
      if (!a.invoice_hotel_id || !activeHotelIds.has(a.invoice_hotel_id)) continue
      const entry = byPayment.get(a.payment_id) ?? { companies: new Set(), hotels: new Set() }
      if (a.invoice_company_id) entry.companies.add(a.invoice_company_id)
      if (a.invoice_hotel_id)   entry.hotels.add(a.invoice_hotel_id)
      byPayment.set(a.payment_id, entry)
    }
    return byPayment
  }, [allocs, activeHotelIds])

  // Filter:
  const filteredRows = useMemo(() => {
    const unrestricted = companyId === 'all' && hotelId === 'all'
    if (unrestricted) return rows

    return rows.filter(r => {
      const entry = indexByPayment.get(r.id)
      if (!entry) return false
      const companyOk = companyId === 'all' || entry.companies.has(companyId)
      const hotelOk   = hotelId   === 'all' || entry.hotels.has(hotelId)
      return companyOk && hotelOk
    })
  }, [rows, indexByPayment, companyId, hotelId])

  // summaries
  const summary = useMemo(() => {
    const s = { amount: 0, applied: 0, unapplied: 0 }
    for (const r of filteredRows) {
      const applied = appliedByPayment.get(r.id) ?? 0
      s.amount += Number(r.amount || 0)
      s.applied += applied
      s.unapplied += Math.max(0, Number(r.amount || 0) - applied)
    }
    return s
  }, [filteredRows, appliedByPayment])

  const counts = useMemo(() => {
    return {
      payments: filteredRows.length,
      withAlloc: filteredRows.filter(r => (appliedByPayment.get(r.id) ?? 0) > 0).length,
      unallocated: filteredRows.filter(r => (appliedByPayment.get(r.id) ?? 0) <= 0).length,
    }
  }, [filteredRows, appliedByPayment])

  // Robust delete
  async function deletePayment(row: PaymentRow) {
    if (!confirm(`Delete payment ${fmtMoney(row.amount)} (${row.method}${row.reference ? ` #${row.reference}` : ''})?\n\nThis will also delete its allocations.`)) {
      return
    }
    setErr(null); setMsg(null)

    const { error: aErr } = await supabase.from('allocations').delete().eq('payment_id', row.id)
    if (aErr) { setErr(aErr.message); return }

    const { error: pErr } = await supabase.from('payments').delete().eq('id', row.id)
    if (pErr) { setErr(pErr.message); return }

    await fetchAll()
    setMsg('Payment deleted')
  }

  const years = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const arr: number[] = []
    for (let y = thisYear + 1; y >= thisYear - 6; y--) arr.push(y)
    return arr
  }, [])

  return (
    <main className="max-w-6xl mx-auto p-6">
      {/* Header + actions styled like dashboard */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <div className="flex items-center gap-2">
          <Link href="/#" className="rounded-xl bg-white border px-3 py-2 text-sm hover:bg-gray-50">
            Home
          </Link>
          <Link href="/payments/new" className="rounded-xl bg-black text-white px-3 py-2 text-sm">
            + New Payment
          </Link>
          <Link href="/invoices" className="rounded-xl bg-white border px-3 py-2 text-sm hover:bg-gray-50">
            Invoices
          </Link>
        </div>
      </div>

      {err && <p className="text-red-600 mb-2">{err}</p>}
      {msg && <p className="text-green-700 mb-2">{msg}</p>}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search reference / method…"
          className="border rounded p-2 w-[320px]"
        />

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
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select
          value={hotelId}
          onChange={(e) => setHotelId(e.target.value as any)}
          className="border rounded p-2"
        >
          <option value="all">All hotels</option>
          {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {/* ===== Mobile list (cards) ===== */}
      <div className="space-y-3 md:hidden">
        {loading && (
          <div className="border rounded p-4 text-sm">Loading…</div>
        )}
        {!loading && filteredRows.length === 0 && (
          <div className="border rounded p-4 text-sm text-gray-500">No payments.</div>
        )}
        {!loading && filteredRows.map((r) => {
          const applied = appliedByPayment.get(r.id) ?? 0
          const unapplied = Math.max(0, Number(r.amount || 0) - applied)
          const badge =
            r.method === 'card'  ? 'bg-emerald-100 text-emerald-700' :
            r.method === 'ach'   ? 'bg-purple-100 text-purple-700' :
            r.method === 'check' ? 'bg-blue-100 text-blue-700' :
            'bg-gray-200 text-gray-700'
          return (
            <div key={r.id} className="border rounded-xl bg-white">
              <div className="p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{fmtMoney(r.amount)}</div>
                  <div className="text-xs text-gray-500">Received: {r.received_date}</div>
                  <div className="text-xs text-gray-500 truncate">Ref: {r.reference || '—'}</div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${badge}`}>{r.method}</span>
              </div>
              <div className="px-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Amount</div>
                    <div className="font-medium">{fmtMoney(r.amount)}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Applied</div>
                    <div className="font-medium">{fmtMoney(applied)}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Unapplied</div>
                    <div className="font-medium">{fmtMoney(unapplied)}</div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <RowMenu
                    onDelete={() => deletePayment(r)}
                    auditHref={`/payments/${r.id}/audit`}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== Desktop table (original) ===== */}
      <div className="overflow-x-auto border rounded-2xl hidden md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Received</th>
              <th className="p-2 text-left">Method</th>
              <th className="p-2 text-left">Reference</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2 text-right">Applied</th>
              <th className="p-2 text-right">Unapplied</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={7} className="p-4">Loading…</td></tr>)}
            {!loading && filteredRows.length === 0 && (<tr><td colSpan={7} className="p-4 text-gray-500">No payments.</td></tr>)}
            {filteredRows.map(r => {
              const applied = appliedByPayment.get(r.id) ?? 0
              const unapplied = Math.max(0, Number(r.amount || 0) - applied)
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.received_date}</td>
                  <td className="p-2 capitalize">{r.method}</td>
                  <td className="p-2">{r.reference ?? ''}</td>
                  <td className="p-2 text-right">{fmtMoney(r.amount)}</td>
                  <td className="p-2 text-right">{fmtMoney(applied)}</td>
                  <td className="p-2 text-right">{fmtMoney(unapplied)}</td>
                  <td className="p-2">
                    <RowMenu
                      onDelete={() => deletePayment(r)}
                      auditHref={`/payments/${r.id}/audit`}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-2xl p-3">
          <h3 className="font-semibold mb-2">Totals (current selection)</h3>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><span>Amounts</span><b>{fmtMoney(summary.amount)}</b></div>
            <div className="flex justify-between"><span>Applied</span><b>{fmtMoney(summary.applied)}</b></div>
            <div className="flex justify-between"><span>Unapplied</span><b>{fmtMoney(summary.unapplied)}</b></div>
          </div>
        </div>
        <div className="border rounded-2xl p-3">
          <h3 className="font-semibold mb-2">Counts (current selection)</h3>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><span>Payments</span><b>{counts.payments}</b></div>
            <div className="flex justify-between"><span>With allocations</span><b>{counts.withAlloc}</b></div>
            <div className="flex justify-between"><span>Unallocated</span><b>{counts.unallocated}</b></div>
          </div>
        </div>
      </div>
    </main>
  )
}

function RowMenu({
  onDelete,
  auditHref,
}: {
  onDelete: () => void
  auditHref?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const handler = () => setIsMobile(mql.matches)
    handler()
    mql.addEventListener?.('change', handler)
    return () => mql.removeEventListener?.('change', handler)
  }, [])

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n))
  }

  function toggle() {
    setOpen((o) => {
      const next = !o
      if (next && btnRef.current && !isMobile) {
        const rect = btnRef.current.getBoundingClientRect()
        const menuW = 176
        const menuH = 120
        const spaceBelow = window.innerHeight - rect.bottom
        const openUp = spaceBelow < menuH + 8
        let top = (openUp ? rect.top - menuH - 8 : rect.bottom + 8) + window.scrollY
        let left = rect.right - menuW + window.scrollX
        left = clamp(left, 8 + window.scrollX, window.scrollX + window.innerWidth - menuW - 8)
        top  = clamp(top,  window.scrollY + 8,  window.scrollY + window.innerHeight - menuH - 8)
        setPos({ top, left })
      }
      return next
    })
  }

  useEffect(() => {
    if (!open || isMobile) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, isMobile])

  return (
    <div className="relative">
      <button ref={btnRef} className="px-2 py-1 rounded border text-sm" onClick={toggle}>⋮</button>

      {/* Mobile bottom sheet */}
      {open && isMobile && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-xl shadow-2xl">
            <div className="p-2">
              <div className="mx-auto my-2 h-1.5 w-10 rounded bg-gray-300" />
              <button
                className="w-full text-left px-4 py-3 hover:bg-gray-50 text-red-600"
                onClick={() => { setOpen(false); onDelete() }}
              >
                Delete payment
              </button>
              {auditHref && (
                <Link
                  href={auditHref}
                  className="block px-4 py-3 hover:bg-gray-50"
                  onClick={() => setOpen(false)}
                >
                  Audit log
                </Link>
              )}
              <button className="w-full text-left px-4 py-3 text-gray-600 hover:bg-gray-50"
                      onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Desktop/Tablet fixed popover */}
      {open && !isMobile && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-44 bg-white border rounded shadow text-sm"
            style={{ top: pos.top, left: pos.left }}
          >
            <button
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600"
              onClick={() => { setOpen(false); onDelete() }}
            >
              Delete payment
            </button>
            {auditHref && (
              <Link
                href={auditHref}
                className="block px-3 py-2 hover:bg-gray-50"
                onClick={() => setOpen(false)}
              >
                Audit log
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
