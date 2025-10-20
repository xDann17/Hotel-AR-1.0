'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Role = 'front_desk' | 'manager' | 'admin'

type Hotel = { id: string; name: string }
type Vendor = { id: string; name: string }
type Category = { id: string; name: string }

type Row = {
  id: string
  expense_date: string
  vendor_name: string | null
  category_name: string | null
  amount: number
  method: 'check' | 'ach' | 'card' | 'other' | string
  reference: string | null
  notes: string | null
  project_id: string | null
}

function fmtMoney(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
function startOfMonth(y: number, m1_12: number) {
  return `${y}-${String(m1_12).padStart(2, '0')}-01`
}
function endOfMonth(y: number, m1_12: number) {
  const last = new Date(y, m1_12, 0)
  const mm = String(last.getMonth() + 1).padStart(2, '0')
  const dd = String(last.getDate()).padStart(2, '0')
  return `${last.getFullYear()}-${mm}-${dd}`
}

export default function ExpensesPage() {
  const router = useRouter()

  // --- Access gate additions (manager/admin only) ---
  const [authLoading, setAuthLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const allowed: Role[] = ['manager', 'admin']

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.replace('/login')
        return
      }
      const uid = data.session.user.id
      try {
        const { data: m } = await supabase
          .from('members')
          .select('role')
          .eq('user_id', uid)
          .maybeSingle()

        const raw = String(m?.role ?? '').toLowerCase()
        let r: Role | null = null
        if (raw === 'admin') r = 'admin'
        else if (raw === 'manager') r = 'manager'
        else if (raw === 'front_desk') r = 'front_desk'
        else if (raw === 'staff') r = 'manager' // backward-compat with old "staff"
        else r = null

        if (!r) {
          const { data: isAdm } = await supabase.rpc('is_admin')
          r = isAdm ? 'admin' : 'front_desk'
        }
        if (!cancelled) setRole(r)
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [router])
  // --- End access gate ---

  // lookups + access
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])

  // filters
  const today = new Date()
  const [year, setYear] = useState<number>(today.getFullYear())
  const [month, setMonth] = useState<number | 'all'>(today.getMonth() + 1) // 1..12 or 'all'
  const [hotelId, setHotelId] = useState<string | 'all'>('all')
  const [vendorId, setVendorId] = useState<string | 'all'>('all')
  const [categoryId, setCategoryId] = useState<string | 'all'>('all')
  const [method, setMethod] = useState<'all'|'check'|'ach'|'card'|'other'>('all')
  const [search, setSearch] = useState('')

  // data
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // ---- load lookups + my hotel access
  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        const [{ data: hs }, { data: vs }, { data: cs }] = await Promise.all([
          supabase.from('hotels').select('id,name').order('name'),
          supabase.from('vendors').select('id,name').order('name'),
          supabase.from('expense_categories').select('id,name').order('name'),
        ])

        setHotels((hs ?? []) as Hotel[])
        setVendors((vs ?? []) as Vendor[])
        setCategories((cs ?? []) as Category[])

        // derive membership (if none recorded, fall back to all hotels)
        const [{ data: mh }, { data: authUser }] = await Promise.all([
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])
        const uid = authUser.user?.id
        const members = (mh ?? []) as { user_id: string; hotel_id: string }[]
        const mine = uid
          ? members.filter(m => m.user_id === uid).map(m => m.hotel_id)
          : []
        setMyHotelIds(mine.length ? mine : ((hs ?? []) as Hotel[]).map(h => h.id))
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load lookups')
      }
    })()
  }, [])

  // keep categories fresh when new ones are added elsewhere
  useEffect(() => {
    const ch = supabase
      .channel('expense-categories-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_categories' }, async () => {
        const { data: cs } = await supabase.from('expense_categories').select('id,name').order('name')
        setCategories((cs ?? []) as Category[])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // ---- fetch month data
  useEffect(() => {
    ;(async () => {
      setLoading(true); setErr(null)
      try {
        // handle "All months"
        const from = month === 'all' ? startOfMonth(year, 1) : startOfMonth(year, month)
        const to = month === 'all' ? endOfMonth(year, 12) : endOfMonth(year, month)

        let result: Row[] = []

        if (hotelId !== 'all') {
          // Use the RPC for a single hotel
          const { data, error } = await supabase.rpc('list_expenses_by_month', {
            p_hotel_id: hotelId,
            p_from: from,
            p_to: to,
          })
          if (error) throw error
          result = (data ?? []) as Row[]
        } else {
          // All my hotels: do a SELECT with joins
          const { data, error } = await supabase
            .from('expenses')
            .select(`
              id,
              expense_date,
              amount,
              method,
              reference,
              notes,
              project_id,
              vendors(name),
              expense_categories(name)
            `)
            .gte('expense_date', from)
            .lte('expense_date', to)
            .in('hotel_id', myHotelIds)
            .order('expense_date', { ascending: false })
            .order('created_at', { ascending: false })

          if (error) throw error
          result = (data ?? []).map((r: any) => ({
            id: r.id,
            expense_date: r.expense_date,
            vendor_name: r.vendors?.name ?? null,
            category_name: r.expense_categories?.name ?? null,
            amount: Number(r.amount || 0),
            method: r.method,
            reference: r.reference ?? null,
            notes: r.notes ?? null,
            project_id: r.project_id ?? null,
          }))
        }

        // client-side filter by vendor/category/method and search (vendor/category/ref/notes)
        const s = search.trim().toLowerCase()
        const filtered = result.filter(r => {
          const vendorOk = vendorId === 'all' || vendors.find(v => v.id === vendorId)?.name === r.vendor_name
          const catOk = categoryId === 'all' || categories.find(c => c.id === categoryId)?.name === r.category_name
          const methodOk = method === 'all' || r.method === method
          const hay = [
            r.vendor_name ?? '',
            r.category_name ?? '',
            r.reference ?? '',
            r.notes ?? '',
          ].join(' ').toLowerCase()
          const searchOk = !s || hay.includes(s)
          return vendorOk && catOk && methodOk && searchOk
        })

        setRows(filtered)
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load expenses')
        setRows([])
      } finally {
        setLoading(false)
      }
    })()
  }, [year, month, hotelId, myHotelIds, vendorId, categoryId, method, search, vendors, categories])

  // ---- totals
  const total = useMemo(() => rows.reduce((a, r) => a + Number(r.amount || 0), 0), [rows])

  // NEW: totals by category for the current filters
  const totalsByCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const key = r.category_name ?? '(uncategorized)'
      m.set(key, (m.get(key) ?? 0) + Number(r.amount || 0))
    }
    // sort desc by amount
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [rows])

  // CSV export
  function exportCsv() {
    const header = ['Date','Vendor','Category','Amount','Method','Reference','Notes']
    const lines = [header.join(',')]
    rows.forEach(r => {
      const cols = [
        r.expense_date,
        r.vendor_name ?? '',
        r.category_name ?? '',
        String(Number(r.amount || 0)),
        r.method,
        r.reference ?? '',
        (r.notes ?? '').replace(/\n/g, ' ').replace(/,/g, ';'),
      ]
      lines.push(cols.map(v => `"${v.replace(/"/g, '""')}"`).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses_${year}-${(month === 'all' ? 'all' : String(month).padStart(2,'0'))}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Years up to 2035 (descending)
  const years = useMemo(() => {
    const arr: number[] = []
    for (let y = 2035; y >= 2019; y--) arr.push(y)
    return arr
  }, [])

  // NEW: delete an expense (in-place update of the table)
  async function deleteExpense(row: Row) {
    if (!confirm(`Delete expense ${fmtMoney(row.amount)} on ${row.expense_date}?`)) return
    const { error } = await supabase.from('expenses').delete().eq('id', row.id)
    if (error) { setErr(error.message); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  // --- Access gate render states ---
  if (authLoading) return <main className="max-w-6xl mx-auto p-6">Loading…</main>
  if (!role || !allowed.includes(role)) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Hotel Expenses</h1>
          <a href="/#" className="rounded border bg-white px-3 py-2 text-sm">Home</a>
        </div>
        <p className="text-gray-700">You don’t have access to view this page.</p>
      </main>
    )
  }
  // --- End access gate ---

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Hotel Expenses</h1>

      {/* Two-column: left action rail, right content (like invoices page) */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* LEFT actions */}
        <aside className="space-y-2">
          <Link href="/#" className="block rounded bg-white border px-3 py-2 text-sm text-left">Home</Link>
          <Link href="/expenses/new" className="block rounded bg-black text-white px-3 py-2 text-sm text-left">+ New Expense</Link>
          <Link href="/vendors" className="block rounded bg-white border px-3 py-2 text-sm text-left">Vendors</Link>
        </aside>

        {/* RIGHT content */}
        <section>
          {err && <p className="text-red-600 mb-2">{err}</p>}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value as any)}
              className="border rounded p-2"
            >
              <option value="all">All hotels</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>

            <select value={year} onChange={e => setYear(Number(e.target.value))} className="border rounded p-2">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <select value={month} onChange={e => setMonth((e.target.value === 'all' ? 'all' : Number(e.target.value)))} className="border rounded p-2">
              <option value="all">All months</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' })}
                </option>
              ))}
            </select>

            <select value={vendorId} onChange={e => setVendorId(e.target.value as any)} className="border rounded p-2">
              <option value="all">All vendors</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>

            <select value={categoryId} onChange={e => setCategoryId(e.target.value as any)} className="border rounded p-2">
              <option value="all">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select value={method} onChange={e => setMethod(e.target.value as any)} className="border rounded p-2">
              <option value="all">All methods</option>
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>

            <input
              placeholder="Search vendor/category/ref/notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border rounded p-2 w-full sm:w-[260px]"
            />

            <button onClick={exportCsv} className="ml-auto rounded border bg-white px-3 py-2 text-sm">
              Export CSV
            </button>
          </div>

          {/* ===== Mobile list (cards) ===== */}
          <div className="space-y-3 md:hidden">
            {loading && (
              <div className="border rounded p-4 text-sm">Loading…</div>
            )}
            {!loading && rows.length === 0 && (
              <div className="border rounded p-4 text-sm text-gray-500">No expenses for this selection.</div>
            )}
            {!loading && rows.map(r => {
              const methodBadge =
                r.method === 'check' ? 'bg-blue-100 text-blue-700' :
                r.method === 'ach'   ? 'bg-purple-100 text-purple-700' :
                r.method === 'card'  ? 'bg-emerald-100 text-emerald-700' :
                'bg-gray-200 text-gray-700'
              return (
                <div key={r.id} className="border rounded-xl bg-white">
                  <div className="p-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{r.vendor_name || '(no vendor)'}</div>
                      <div className="text-xs text-gray-500">{r.category_name || '(uncategorized)'} • {r.expense_date}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${methodBadge}`}>{r.method}</span>
                  </div>

                  <div className="px-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Amount</div>
                        <div className="font-medium">{fmtMoney(r.amount)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Reference</div>
                        <div className="font-medium truncate">{r.reference || '—'}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Notes</div>
                        <div className="font-medium truncate">{r.notes || '—'}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <RowMenu
                        editHref={`/expenses/${r.id}/edit`}
                        onDelete={() => deleteExpense(r)}
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
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Vendor</th>
                  <th className="p-2 text-left">Category</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2 text-left">Method</th>
                  <th className="p-2 text-left">Reference</th>
                  <th className="p-2 text-left">Notes</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={8} className="p-4">Loading…</td></tr>)}
                {!loading && rows.length === 0 && (<tr><td colSpan={8} className="p-4 text-gray-500">No expenses for this month.</td></tr>)}
                {rows.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.expense_date}</td>
                    <td className="p-2">{r.vendor_name ?? '—'}</td>
                    <td className="p-2">{r.category_name ?? '—'}</td>
                    <td className="p-2 text-right">{fmtMoney(r.amount)}</td>
                    <td className="p-2 capitalize">{r.method}</td>
                    <td className="p-2">{r.reference ?? '—'}</td>
                    <td className="p-2">{r.notes ?? ''}</td>
                    <td className="p-2">
                      <RowMenu
                        editHref={`/expenses/${r.id}/edit`}
                        onDelete={() => deleteExpense(r)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 border rounded p-3">
            <h3 className="font-semibold mb-2 text-sm">Totals (current filters)</h3>
            {totalsByCategory.length === 0 ? (
              <div className="text-sm text-gray-500">No data.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-500">
                    <th className="p-2 text-left">Category</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {totalsByCategory.map(([cat, amt]) => (
                    <tr key={cat} className="border-t">
                      <td className="p-2">{cat}</td>
                      <td className="p-2 text-right">{fmtMoney(amt)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right">{fmtMoney(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

/* ---------- small menu for each row (Edit / Delete) ---------- */
function RowMenu({
  editHref,
  onDelete,
}: {
  editHref: string
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [pos, setPos] = useState<{top:number,left:number} | null>(null)
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
              <Link
                href={editHref}
                className="block px-4 py-3 hover:bg-gray-50"
                onClick={() => setOpen(false)}
              >
                Edit
              </Link>
              <button
                className="w-full text-left px-4 py-3 hover:bg-gray-50 text-red-600"
                onClick={() => { setOpen(false); onDelete() }}
              >
                Delete
              </button>
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
            <Link
              href={editHref}
              className="block px-3 py-2 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              Edit
            </Link>
            <button
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600"
              onClick={() => { setOpen(false); onDelete() }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
