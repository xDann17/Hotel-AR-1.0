'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Hotel   = { id: string; name: string }
type Company = { id: string; name: string }
type Client  = { id: string; name: string }

type Row = {
  id: string
  number: string | null
  hotel_id: string | null
  company_id: string | null
  client_id: string | null
  check_in: string | null
  check_out: string | null
  subtotal: number | null
  tax: number | null
  total: number | null
  balance: number | null
  status: 'open' | 'partial' | 'paid' | 'void' | string
  case_number?: string | null
  case_no?: string | null
  case?: string | null
}

type RowWithAgg = Row & { payments: number }

/* ---------- ACCESS GATE (manager/admin only) ---------- */
type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'
function useGateForInvoices() {
  const [allowed, setAllowed] = useState<boolean | null>(null) // null = checking

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/login'; return }

      // 1) Prefer role from JWT user_metadata (works even if RPCs fail)
      const metaRole = String(s.session.user?.user_metadata?.role ?? '')
        .trim()
        .toLowerCase() as AppRole

      if (metaRole === 'admin' || metaRole === 'manager') {
        if (!ignore) setAllowed(true)
        return
      }
      if (metaRole === 'front_desk') {
        if (!ignore) setAllowed(false)
        return
      }

      // 2) Optional: allow via is_admin() if present
      try {
        const { data: isAdm } = await supabase.rpc('is_admin')
        if (isAdm === true) {
          if (!ignore) setAllowed(true)
          return
        }
      } catch { /* ignore missing RPC */ }

      // 3) Optional: try get_my_role() if present
      try {
        const { data: r } = await supabase.rpc('get_my_role')
        const role = String(r ?? '').trim().toLowerCase() as AppRole
        const ok = role === 'manager' || role === 'admin'
        if (!ignore) setAllowed(ok)
        return
      } catch { /* ignore missing RPC */ }

      // 4) Fallback: deny
      if (!ignore) setAllowed(false)
    })()
    return () => { ignore = true }
  }, [])

  return { allowed, checked: allowed !== null }
}
/* ------------------------------------------------------ */

function fmtMoney(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function startOfMonth(year: number, month1_12: number) {
  return `${year}-${String(month1_12).padStart(2, '0')}-01`
}
function endOfMonth(year: number, month1_12: number) {
  const last = new Date(year, month1_12, 0)
  return ymd(last)
}

export default function InvoicesPage() {
  const gate = useGateForInvoices() // apply gate

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  // FIX #1: default to current year (instead of 'all')
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [month, setMonth] = useState<number | 'all'>('all')
  const [companyId, setCompanyId] = useState<string | 'all'>('all')
  const [hotelId, setHotelId] = useState<string | 'all'>('all')

  const [hotels, setHotels] = useState<Hotel[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [clients, setClients] = useState<Client[]>([])

  const [rows, setRows] = useState<RowWithAgg[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // NEW: track which invoices have problems (if table exists)
  const [problemInvoiceIds, setProblemInvoiceIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (gate.allowed !== true) return
    ;(async () => {
      setErr(null)
      try {
        const [{ data: hs, error: hErr }, { data: cs, error: cErr }, { data: cls, error: clErr }] =
          await Promise.all([
            supabase.from('hotels').select('id, name').is('deleted_at', null).order('name'),
            supabase.from('companies').select('id, name').order('name'),
            supabase.from('clients').select('id, name').order('name'),
          ])
        if (hErr) throw hErr
        if (cErr) throw cErr
        if (clErr) throw clErr
        setHotels((hs ?? []) as Hotel[])
        setCompanies((cs ?? []) as Company[])
        setClients((cls ?? []) as Client[])
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load filters')
      }
    })()
  }, [gate.allowed])

  const companyName = (id: string | null) =>
    companies.find(c => c.id === id)?.name ?? ''
  const clientName  = (id: string | null) =>
    clients.find(c => c.id === id)?.name ?? ''

  async function fetchRows() {
    setLoading(true); setErr(null)
    try {
      let q = supabase
        .from('invoices')
        .select('*')
        .is('deleted_at', null)
        .order('check_in', { ascending: false })

      // FIX #2: treat 'all' as current year for filtering (so month works)
      const currentYear = new Date().getFullYear()
      const effectiveYear = year === 'all' ? currentYear : year

      if (month === 'all') {
        q = q.gte('check_in', `${effectiveYear}-01-01`).lte('check_in', `${effectiveYear}-12-31`)
      } else {
        q = q.gte('check_in', startOfMonth(effectiveYear, month)).lte('check_in', endOfMonth(effectiveYear, month))
      }

      if (hotelId !== 'all') {
        q = q.eq('hotel_id', hotelId)
      } else if (hotels.length) {
        q = q.in('hotel_id', hotels.map(h => h.id))
      }

      if (companyId !== 'all') q = q.eq('company_id', companyId)

      const { data: base, error: bErr } = await q
      if (bErr) throw bErr

      const ids = (base ?? []).map(r => r.id)

      // NEW: Batch check if any problems exist for these invoices
      if (ids.length) {
        try {
          const { data: probs } = await supabase
            .from('invoice_problems')
            .select('invoice_id')
            .in('invoice_id', ids as any)
          const set = new Set<string>((probs ?? []).map((p: any) => String(p.invoice_id)))
          setProblemInvoiceIds(set)
        } catch {
          // If table doesn't exist or query fails, silently ignore and show no badges.
          setProblemInvoiceIds(new Set())
        }
      } else {
        setProblemInvoiceIds(new Set())
      }

      let pay = new Map<string, number>()
      if (ids.length) {
        const { data: alloc, error: aErr } = await supabase
          .from('allocations')
          .select('invoice_id, amount')
          .in('invoice_id', ids)
          .is('deleted_at', null)
        if (aErr) throw aErr
        for (const a of alloc ?? []) {
          pay.set(a.invoice_id, (pay.get(a.invoice_id) ?? 0) + Number(a.amount || 0))
        }
      }

      let merged: RowWithAgg[] = (base ?? []).map(r => ({
        ...(r as Row),
        payments: pay.get(r.id) ?? 0,
      }))

      if (search) {
        const s = search.toLowerCase()
        merged = merged.filter(r => {
          const number  = (r.number ?? '').toLowerCase()
          const status  = (r.status ?? '').toLowerCase()
          const caseAny = String(r.case_number ?? r.case_no ?? r.case ?? '').toLowerCase()
          const cName   = clientName(r.client_id).toLowerCase()
          return (
            number.includes(s) ||
            status.includes(s) ||
            caseAny.includes(s) ||
            cName.includes(s)
          )
        })
      }

      // If void, show $0
      merged = merged.map(r =>
        (r.status?.toLowerCase() === 'void')
          ? { ...r, payments: 0, balance: 0 }
          : r
      )

      setRows(merged)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load invoices')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed !== true) return
    fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.allowed, search, year, month, companyId, hotelId, hotels])

  const summary = useMemo(() => {
    const s = { total: 0, payments: 0, balance: 0 }
    for (const r of rows) {
      const total = Number(r.total || 0)
      const payments = Number(r.payments || 0)
      s.total    += total
      s.payments += payments
      s.balance  += Math.max(0, total - payments)
    }
    return s
  }, [rows])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { open: 0, partial: 0, paid: 0, void: 0 }
    for (const r of rows) {
      const k = (r.status || '').toLowerCase()
      if (k in c) c[k]++
    }
    return c
  }, [rows])

  async function allocatedSum(invoiceId: string) {
    const { data, error } = await supabase
      .from('allocations')
      .select('amount')
      .eq('invoice_id', invoiceId)
      .is('deleted_at', null)
    if (error) return 0
    return (data ?? []).reduce((s, a) => s + Number(a.amount || 0), 0)
  }

  async function updateTotal(row: RowWithAgg) {
    const initial = Number(row.total ?? row.subtotal ?? 0).toFixed(2)
    const ans = window.prompt(`New total for invoice ${row.number ?? row.id}`, initial)
    if (ans == null) return
    const newTotal = Number(ans)
    if (!Number.isFinite(newTotal) || newTotal < 0) { setErr('Please enter a valid number.'); return }

    setErr(null); setMsg(null)

    const { data: alloc, error: allocErr } = await supabase
      .from('allocations')
      .select('amount')
      .eq('invoice_id', row.id)
      .is('deleted_at', null)
    if (allocErr) { setErr(allocErr.message); return }

    const paid = (alloc ?? []).reduce((s, a) => s + Number(a.amount || 0), 0)
    const newBalance = Math.max(0, newTotal - paid)
    const newStatus =
      newTotal === 0 ? 'void'
      : paid <= 0 ? 'open'
      : paid < newTotal ? 'partial'
      : 'paid'

    const { data: updated, error } = await supabase
      .from('invoices')
      .update({ subtotal: newTotal, tax: 0, balance: newBalance, status: newStatus })
      .eq('id', row.id)
      .is('deleted_at', null)
      .select('id')

    if (error) { setErr(error.message); return }
    if (!updated || updated.length === 0) { setErr('Update didn’t apply.'); return }

    await supabase.rpc('log_invoice_event', {
      p_invoice_id: row.id,
      p_action: 'update_total',
      p_note: null,
      p_details: { old_total: Number(row.total || 0), new_total: newTotal } as any
    })

    setMsg('Total updated')
    await fetchRows()
  }

  async function voidInvoice(row: RowWithAgg) {
    const reason = window.prompt(`Void invoice ${row.number ?? row.id}. Add a note (optional):`, '')
    if (reason === null) return
    setErr(null); setMsg(null)

    const { error: delErr } = await supabase
      .from('allocations')
      .delete()
      .eq('invoice_id', row.id)
    if (delErr) { setErr(delErr.message); return }

    const { data: updated, error } = await supabase
      .from('invoices')
      .update({ status: 'void', subtotal: 0, tax: 0, balance: 0, })
      .eq('id', row.id)
      .is('deleted_at', null)
      .select('id')

    if (error) { setErr(error.message); return }
    if (!updated || updated.length === 0) { setErr('Void didn’t apply.'); return }

    setRows(prev =>
      prev.map(r =>
        r.id === row.id
          ? { ...r, status: 'void', subtotal: 0, tax: 0, total: 0, balance: 0, payments: 0 }
          : r
      )
    )

    await supabase.rpc('log_invoice_event', {
      p_invoice_id: row.id,
      p_action: 'void_invoice',
      p_note: reason || null,
      p_details: {} as any
    })

    setMsg('Invoice voided')
    await fetchRows()
  }

  const years = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const start = thisYear + 10
    const end   = thisYear - 10
    const arr: number[] = []
    for (let y = start; y >= end; y--) arr.push(y)
    return arr
  }, [])

  // ---------- Access message for non-authorized users ----------
  if (gate.checked && gate.allowed === false) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <Link href="/#" className="rounded bg-white border px-3 py-2 text-sm">Home</Link>
        </div>
        <p className="text-gray-600 text-lg">You don’t have access to view this page.</p>
      </main>
    )
  }
  // While gate is checking, keep existing skeleton flow (table shows "Loading…")
  // ---------------------------------------------------------------

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Invoices</h1>

      {/* New two-column layout: vertical action bar on the left */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* LEFT: vertical actions */}
        <aside className="space-y-2">
          <Link href="/#" className="block rounded bg-white border px-3 py-2 text-sm text-left">Home</Link>
          <Link href="/payments" className="block rounded bg-white border px-3 py-2 text-sm text-left">Payments</Link>
          <Link href="/clients" className="block rounded bg-white border px-3 py-2 text-sm text-left">New Client</Link>
          <Link href="/companies/new" className="block rounded bg-white border px-3 py-2 text-sm text-left">Create Company</Link>
          <Link href="/reports/aging" className="block rounded bg-white border px-3 py-2 text-sm text-left">Aging Reports</Link>
          <Link href="/payments/new" className="block rounded bg-white border px-3 py-2 text-sm text-left">Record payment</Link>
          <Link href="/invoices/new" className="block rounded bg-black text-white px-3 py-2 text-sm text-left">+ New Invoice</Link>
        </aside>

        {/* RIGHT: filters + table + summaries (existing content) */}
        <section>
          {err && <p className="text-red-600 mb-2">{err}</p>}
          {msg && <p className="text-green-700 mb-2">{msg}</p>}

          {/* Filters: naturally wrap on small screens */}
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search number, status, case, client…"
              className="border rounded p-2 w-full sm:w-[320px]"
            />
            <select value={year} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="border rounded p-2">
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="border rounded p-2">
              <option value="all">All months</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' })}</option>
              ))}
            </select>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value as any)} className="border rounded p-2">
              <option value="all">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={hotelId} onChange={(e) => setHotelId(e.target.value as any)} className="border rounded p-2">
              <option value="all">All hotels</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>

          {/* ===== Mobile list (cards) ===== */}
          <div className="space-y-3 md:hidden">
            {loading && (
              <div className="border rounded p-4 text-sm">Loading…</div>
            )}
            {!loading && rows.length === 0 && (
              <div className="border rounded p-4 text-sm text-gray-500">No invoices.</div>
            )}
            {!loading && rows.map((r) => {
              const caseAny = r.case_number ?? r.case_no ?? r.case ?? ''
              const total = Number(r.total || 0)
              const payments = Number(r.payments || 0)
              const liveBalance = Math.max(0, total - payments)
              const badge =
                r.status === 'paid' ? 'bg-green-100 text-green-700'
              : r.status === 'partial' ? 'bg-amber-100 text-amber-800'
              : r.status === 'void' ? 'bg-gray-200 text-gray-700'
              : 'bg-blue-100 text-blue-700'
              const hasProblem = problemInvoiceIds.has(r.id)
              return (
                <div key={r.id} className="border rounded-xl bg-white">
                  <div className="p-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{companyName(r.company_id) || '(no company)'}</div>
                      <div className="text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          {clientName(r.client_id) || '(no client)'}
                          {hasProblem && (
                            <Link href={`/invoices/${r.id}/problems`} title="Has problem(s) logged">
                              <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path d="M8.257 3.099c.765-1.36 2.721-1.36 3.486 0l6.518 11.59A2 2 0 0 1 16.518 18H3.482a2 2 0 0 1-1.743-3.31L8.257 3.1zM11 14a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm-1-2a1 1 0 0 0 1-1V8a1 1 0 1 0-2 0v3a1 1 0 0 0 1 1z"/>
                              </svg>
                            </Link>
                          )}
                        </span>
                        {caseAny ? ` • Case ${caseAny}` : ''}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge}`}>{(r.status || '').toString()}</span>
                  </div>

                  <div className="px-3 text-xs text-gray-500">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>Inv #{r.number ?? '—'}</span>
                      <span>Check-in: {r.check_in ?? '—'}</span>
                      <span>Check-out: {r.check_out ?? '—'}</span>
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Total</div>
                        <div className="font-medium">{fmtMoney(total)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Payments</div>
                        <div className="font-medium">{fmtMoney(payments)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Balance</div>
                        <div className="font-medium">{fmtMoney(liveBalance)}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex justify-end">
                      <RowMenu
                        onUpdateTotal={() => updateTotal(r)}
                        onVoid={() => voidInvoice(r)}
                        auditHref={`/invoices/${r.id}/audit`}
                        problemsHref={`/invoices/${r.id}/problems`}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ===== Desktop table (original) ===== */}
          <div className="overflow-x-auto border rounded hidden md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Company</th>
                  <th className="p-2 text-left">Client</th>
                  <th className="p-2 text-left">Case #</th>
                  <th className="p-2 text-left">Inv #</th>
                  <th className="p-2 text-left">Check-in</th>
                  <th className="p-2 text-left">Check-out</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Payments</th>
                  <th className="p-2 text-right">Balance</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={11} className="p-4">Loading…</td></tr>)}
                {!loading && rows.length === 0 && (<tr><td colSpan={11} className="p-4 text-gray-500">No invoices.</td></tr>)}
                {rows.map(r => {
                  const caseAny = r.case_number ?? r.case_no ?? r.case ?? ''
                  const total = Number(r.total || 0)
                  const payments = Number(r.payments || 0)
                  const liveBalance = Math.max(0, total - payments)
                  const hasProblem = problemInvoiceIds.has(r.id)
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{companyName(r.company_id)}</td>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1">
                          {clientName(r.client_id)}
                          {hasProblem && (
                            <Link href={`/invoices/${r.id}/problems`} title="Has problem(s) logged">
                              <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path d="M8.257 3.099c.765-1.36 2.721-1.36 3.486 0l6.518 11.59A2 2 0 0 1 16.518 18H3.482a2 2 0 0 1-1.743-3.31L8.257 3.1zM11 14a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm-1-2a1 1 0 0 0 1-1V8a1 1 0 1 0-2 0v3a1 1 0 0 0 1 1z"/>
                              </svg>
                            </Link>
                          )}
                        </span>
                      </td>
                      <td className="p-2">{String(caseAny)}</td>
                      <td className="p-2">{r.number ?? ''}</td>
                      <td className="p-2">{r.check_in ?? ''}</td>
                      <td className="p-2">{r.check_out ?? ''}</td>
                      <td className="p-2 text-right">{fmtMoney(total)}</td>
                      <td className="p-2 text-right">{fmtMoney(payments)}</td>
                      <td className="p-2 text-right">{fmtMoney(liveBalance)}</td>
                      <td className="p-2">{r.status}</td>
                      <td className="p-2">
                        <RowMenu
                          onUpdateTotal={() => updateTotal(r)}
                          onVoid={() => voidInvoice(r)}
                          auditHref={`/invoices/${r.id}/audit`}
                          problemsHref={`/invoices/${r.id}/problems`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded p-3">
              <h3 className="font-semibold mb-2">Totals (current selection)</h3>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between"><span>Total</span><b>{fmtMoney(summary.total)}</b></div>
                <div className="flex justify-between"><span>Payments</span><b>{fmtMoney(summary.payments)}</b></div>
                <div className="flex justify-between"><span>Balance</span><b>{fmtMoney(summary.balance)}</b></div>
              </div>
            </div>
            <div className="border rounded p-3">
              <h3 className="font-semibold mb-2">Counts (current selection)</h3>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between"><span>Open</span><b>{statusCounts.open}</b></div>
                <div className="flex justify-between"><span>Partial</span><b>{statusCounts.partial}</b></div>
                <div className="flex justify-between"><span>Paid</span><b>{statusCounts.paid}</b></div>
                <div className="flex justify-between"><span>Void</span><b>{statusCounts.void}</b></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function RowMenu({
  onUpdateTotal,
  onVoid,
  auditHref,
  problemsHref,
}: {
  onUpdateTotal: () => void
  onVoid: () => void
  auditHref?: string
  problemsHref?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [pos, setPos] = useState<{top:number,left:number} | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // track viewport for mobile bottom sheet
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
        const menuW = 192
        const menuH = 170
        const spaceBelow = window.innerHeight - rect.bottom
        const openUp = spaceBelow < menuH + 8
        let top = (openUp ? rect.top - menuH - 8 : rect.bottom + 8) + window.scrollY
        let left = rect.right - menuW + window.scrollX
        // clamp within viewport padding
        left = clamp(left, 8 + window.scrollX, window.scrollX + window.innerWidth - menuW - 8)
        top = clamp(top, window.scrollY + 8, window.scrollY + window.innerHeight - menuH - 8)
        setPos({ top, left })
      }
      return next
    })
  }

  // Close on scroll/resize to keep in sync (desktop popover)
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

      {/* Mobile: bottom sheet */}
      {open && isMobile && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-xl shadow-2xl">
            <div className="p-2">
              <div className="mx-auto my-2 h-1.5 w-10 rounded bg-gray-300" />
              <button className="w-full text-left px-4 py-3 hover:bg-gray-50"
                      onClick={() => { setOpen(false); onUpdateTotal() }}>
                Update total
              </button>
              <button className="w-full text-left px-4 py-3 hover:bg-gray-50"
                      onClick={() => { setOpen(false); onVoid() }}>
                Void invoice
              </button>
              {auditHref && (
                <Link href={auditHref} className="block px-4 py-3 hover:bg-gray-50"
                      onClick={() => setOpen(false)}>
                  Audit log
                </Link>
              )}
              {problemsHref && (
                <Link href={problemsHref} className="block px-4 py-3 hover:bg-gray-50"
                      onClick={() => setOpen(false)}>
                  Problem center
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

      {/* Desktop/Tablet: fixed popover near button */}
      {open && !isMobile && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-48 bg-white border rounded shadow text-sm"
            style={{ top: pos.top, left: pos.left }}
          >
            <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
                    onClick={() => { setOpen(false); onUpdateTotal() }}>
              Update total
            </button>
            <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
                    onClick={() => { setOpen(false); onVoid() }}>
              Void invoice
            </button>
            {auditHref && (
              <Link href={auditHref} className="block px-3 py-2 hover:bg-gray-50"
                    onClick={() => setOpen(false)}>
                Audit log
              </Link>
            )}
            {problemsHref && (
              <Link href={problemsHref} className="block px-3 py-2 hover:bg-gray-50"
                    onClick={() => setOpen(false)}>
                Problem center
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
