'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Hotel = { id: string; name: string }
type Project = {
  id: string
  hotel_id: string
  name: string
  contractor: string | null
  start_date: string | null
  end_date: string | null
}
type ExpenseAgg = {
  project_id: string
  materials: number
  labor: number
}

type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'
function useGateForProjects() {
  const [allowed, setAllowed] = useState<boolean | null>(null) // null = checking
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/login'; return }

      // admins allowed immediately
      const { data: isAdm } = await supabase.rpc('is_admin')
      if (!ignore && isAdm === true) { setAllowed(true); return }

      // managers also allowed
      const { data: r } = await supabase.rpc('get_my_role')
      const roleStr = String(r ?? '').trim().toLowerCase()
      const ok = 
      roleStr === 'manager' ||
       roleStr === 'admin' ||
       roleStr === ''
      if (!ignore) setAllowed(ok)
    })()
    return () => { ignore = true }
  }, [])
  return { allowed, checked: allowed !== null }
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

export default function ProjectsPage() {
  const gate = useGateForProjects() // 🔐 apply access gate

  // lookups + access
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])

  // filters
  const today = new Date()
  const [year, setYear] = useState<number>(today.getFullYear())
  const [month, setMonth] = useState<number | 'all'>('all')
  const [hotelId, setHotelId] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')

  // data
  const [rows, setRows] = useState<Project[]>([])
  const [aggs, setAggs] = useState<Map<string, ExpenseAgg>>(new Map())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // ---- load hotels + membership
  useEffect(() => {
    if (gate.allowed !== true) return
    ;(async () => {
      setErr(null)
      try {
        const [{ data: hs }, { data: mh }, { data: authUser }] = await Promise.all([
          supabase.from('hotels').select('id,name').order('name'),
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])
        const hotelsRows = (hs ?? []) as Hotel[]
        setHotels(hotelsRows)

        // derive membership (if none recorded, fall back to all hotels)
        const uid = authUser.user?.id
        const members = (mh ?? []) as { user_id: string; hotel_id: string }[]
        const mine = uid ? members.filter(m => m.user_id === uid).map(m => m.hotel_id) : []
        setMyHotelIds(mine.length ? mine : hotelsRows.map(h => h.id))

        // if an inaccessible hotel was preselected somehow, snap back to 'all'
        if (hotelId !== 'all' && !mine.includes(String(hotelId))) {
          setHotelId('all')
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load hotels')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.allowed])

  // ---- fetch projects + aggregate expenses
  useEffect(() => {
    if (gate.allowed !== true) return
    ;(async () => {
      setLoading(true); setErr(null); setMsg(null)
      try {
        const from = startOfMonth(year, typeof month === 'number' ? month : 1)
        const to   = endOfMonth(year, typeof month === 'number' ? month : 12)

        let q = supabase
          .from('projects')
          .select('id, hotel_id, name, contractor, start_date, end_date')
          .gte('start_date', `${year}-01-01`)
          .lte('start_date', `${year}-12-31`)
          .order('start_date', { ascending: false })
          .order('created_at', { ascending: false })

        if (month !== 'all') {
          q = q.gte('start_date', from).lte('start_date', to)
        }

        if (hotelId !== 'all') {
          q = q.eq('hotel_id', hotelId)
        } else if (myHotelIds.length) {
          q = q.in('hotel_id', myHotelIds)
        }

        const { data: ps, error: pErr } = await q
        if (pErr) throw pErr

        const s = search.trim().toLowerCase()
        const filtered = (ps ?? []).filter((p: any) => {
          const hay = `${p.name ?? ''} ${p.contractor ?? ''}`.toLowerCase()
          return !s || hay.includes(s)
        }) as Project[]

        setRows(filtered)

        const ids = filtered.map(p => p.id)
        const aggMap = new Map<string, ExpenseAgg>()
        if (ids.length) {
          const { data: ex, error: eErr } = await supabase
            .from('project_expenses')
            .select('project_id, kind, amount, expense_date')
            .in('project_id', ids)
            .gte('expense_date', from)
            .lte('expense_date', to)
          if (eErr) throw eErr

          for (const row of ex ?? []) {
            const pid = row.project_id as string
            const kind = String(row.kind || '').toLowerCase()
            const amount = Number(row.amount || 0)
            const cur = aggMap.get(pid) ?? { project_id: pid, materials: 0, labor: 0 }
            if (kind === 'labor') cur.labor += amount
            else cur.materials += amount
            aggMap.set(pid, cur)
          }
        }
        setAggs(aggMap)
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load projects')
        setRows([])
        setAggs(new Map())
      } finally {
        setLoading(false)
      }
    })()
  }, [gate.allowed, year, month, hotelId, myHotelIds, search])

  async function deleteProject(p: Project) {
    if (!confirm(`Delete project "${p.name}"? This will remove its logged expenses.`)) return
    setErr(null); setMsg(null)
    try {
      const { error: de } = await supabase.from('project_expenses').delete().eq('project_id', p.id)
      if (de) throw de
      const { error } = await supabase.from('projects').delete().eq('id', p.id)
      if (error) throw error
      setMsg('Project deleted')
      setRows(prev => prev.filter(x => x.id !== p.id))
      setAggs(prev => {
        const m = new Map(prev)
        m.delete(p.id)
        return m
      })
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to delete project')
    }
  }

  const totals = useMemo(() => {
    let projects = rows.length
    let materials = 0
    let labor = 0
    for (const p of rows) {
      const a = aggs.get(p.id)
      materials += a?.materials ?? 0
      labor += a?.labor ?? 0
    }
    return { projects, materials, labor, all: materials + labor }
  }, [rows, aggs])

  const years = useMemo(() => {
    const thisY = new Date().getFullYear()
    const arr: number[] = []
    for (let y = thisY + 1; y >= thisY - 6; y--) arr.push(y)
    return arr
  }, [])

  // ---- show friendly message for unauthorized users
  if (gate.checked && gate.allowed === false) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-semibold">Project Management</h1>
          <Link href="/#" className="rounded bg-white border px-3 py-2 text-sm">Home</Link>
        </div>
        <p className="text-gray-600 text-lg">You don’t have access to view this page.</p>
      </main>
    )
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Project Management</h1>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* LEFT actions */}
        <aside className="space-y-2">
          <Link href="/#" className="block rounded bg-white border px-3 py-2 text-sm text-left">Home</Link>
          <Link href="/projects/new" className="block rounded bg-black text-white px-3 py-2 text-sm text-left">+ New Project</Link>
        </aside>

        {/* RIGHT content */}
        <section>
          {err && <p className="text-red-600 mb-2">{err}</p>}
          {msg && <p className="text-green-700 mb-2">{msg}</p>}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value as any)}
              className="border rounded p-2"
            >
              <option value="all">All hotels</option>
              {hotels.map(h => {
                const allowed = myHotelIds.includes(h.id)
                return (
                  <option key={h.id} value={h.id} disabled={!allowed}>
                    {h.name}{!allowed ? ' (no access)' : ''}
                  </option>
                )
              })}
            </select>

            <select value={year} onChange={e => setYear(Number(e.target.value))} className="border rounded p-2">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <select value={month} onChange={e => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="border rounded p-2">
              <option value="all">All months</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' })}
                </option>
              ))}
            </select>

            <input
              placeholder="Search project / contractor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border rounded p-2 w-full sm:w-[260px]"
            />
          </div>

          {/* ===== Mobile list (cards) ===== */}
          <div className="space-y-3 md:hidden">
            {loading && (
              <div className="border rounded p-4 text-sm">Loading…</div>
            )}
            {!loading && rows.length === 0 && (
              <div className="border rounded p-4 text-sm text-gray-500">No projects.</div>
            )}
            {!loading && rows.map(p => {
              const a = aggs.get(p.id)
              const mat = a?.materials ?? 0
              const lab = a?.labor ?? 0
              return (
                <div key={p.id} className="border rounded-xl bg-white">
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-gray-500">
                          {p.start_date || '—'} {p.end_date ? `→ ${p.end_date}` : ''}
                        </div>
                        {p.contractor && (
                          <div className="text-xs text-gray-600 mt-1">Contractor: {p.contractor}</div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Materials</div>
                        <div className="font-medium">{fmtMoney(mat)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Labor</div>
                        <div className="font-medium">{fmtMoney(lab)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Total</div>
                        <div className="font-medium">{fmtMoney(mat + lab)}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex justify-end">
                      <RowMenu
                        onAddExpenseHref={`/projects/expenses/new?projectId=${p.id}`}
                        onLogHref={`/projects/expenses/${p.id}/log`}
                        onDelete={() => deleteProject(p)}
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
                  <th className="p-2 text-left">Project</th>
                  <th className="p-2 text-left">Started</th>
                  <th className="p-2 text-left">Finished</th>
                  <th className="p-2 text-right">Materials</th>
                  <th className="p-2 text-right">Labor</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-left">Contractor / Employee</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={8} className="p-4">Loading…</td></tr>)}
                {!loading && rows.length === 0 && (<tr><td colSpan={8} className="p-4 text-gray-500">No projects.</td></tr>)}
                {rows.map(p => {
                  const a = aggs.get(p.id)
                  const mat = a?.materials ?? 0
                  const lab = a?.labor ?? 0
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{p.start_date ?? ''}</td>
                      <td className="p-2">{p.end_date ?? ''}</td>
                      <td className="p-2 text-right">{fmtMoney(mat)}</td>
                      <td className="p-2 text-right">{fmtMoney(lab)}</td>
                      <td className="p-2 text-right">{fmtMoney(mat + lab)}</td>
                      <td className="p-2">{p.contractor ?? ''}</td>
                      <td className="p-2">
                        <RowMenu
                          onAddExpenseHref={`/projects/expenses/new?projectId=${p.id}`}
                          onLogHref={`/projects/expenses/${p.id}/log`}
                          onDelete={() => deleteProject(p)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 border rounded p-3">
            <div className="flex justify-between text-sm"><span>Projects (current filters)</span><b>{totals.projects}</b></div>
            <div className="flex justify-between text-sm"><span>Total materials</span><b>{fmtMoney(totals.materials)}</b></div>
            <div className="flex justify-between text-sm"><span>Total labor</span><b>{fmtMoney(totals.labor)}</b></div>
            <hr className="my-2" />
            <div className="flex justify-between text-sm"><span>Grand total</span><b>{fmtMoney(totals.all)}</b></div>
          </div>
        </section>
      </div>
    </main>
  )
}

function RowMenu({
  onAddExpenseHref,
  onLogHref,
  onDelete,
}: {
  onAddExpenseHref: string
  onLogHref: string
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="px-2 py-1 rounded border text-sm" onClick={() => setOpen(o => !o)}>⋮</button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-48 bg-white border rounded shadow text-sm z-10"
          onMouseLeave={() => setOpen(false)}
        >
          <Link href={onAddExpenseHref} className="block px-3 py-2 hover:bg-gray-50"
                onClick={() => setOpen(false)}>
            Add expense
          </Link>
          <Link href={onLogHref} className="block px-3 py-2 hover:bg-gray-50"
                onClick={() => setOpen(false)}>
            Expenses log
          </Link>
          <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  onClick={() => { setOpen(false); onDelete() }}>
            Delete project
          </button>
        </div>
      )}
    </div>
  )
}
