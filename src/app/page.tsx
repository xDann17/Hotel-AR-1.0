'use client'

import Link from 'next/link'
import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

type PaymentRow = {
  id: string
  amount: number
  method: string
  reference: string | null
  received_date: string
}

type AllocationJoin = {
  payment_id: string
  invoice_id: string
  amount: number | null
  invoices: {
    hotel_id: string | null
    company_id: string | null
    client_id: string | null
    check_in: string | null
    clients?: { name: string | null } | null
  } | null
}

type Hotel = { id: string; name: string }
type MemberHotel = { user_id: string; hotel_id: string }
type UserLite = { email: string | null }
type Company = { id: string; name: string }

type ClientBreakdown = {
  client_id: string | null
  client_name: string
  period: string
  amount: number
}

type DayRow = {
  day: string
  total: number
  details: {
    company_id: string | null
    hotel_id: string | null
    amount: number
    clients: ClientBreakdown[]
  }[]
}

type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'

export default function DashboardPage() {
  const [user, setUser] = useState<UserLite | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // NEW: mobile sidebar toggle
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // --- NEW: robust role detection state ---
  const [role, setRole] = useState<AppRole>('front_desk')
  const [roleReady, setRoleReady] = useState(false)
  const isAdmin = role === 'admin'
  const canSeeManagerStuff = role === 'manager' || role === 'admin'
  const canSeeAdminCenter = role === 'admin'

  const [myHotelIds, setMyHotelIds] = useState<string[]>([])

  const [cardsLoading, setCardsLoading] = useState(true)
  const [invoiceTotal, setInvoiceTotal] = useState<number | null>(null)
  const [paymentsTotal, setPaymentsTotal] = useState<number | null>(null)
  const [avgRateNight, setAvgRateNight] = useState<number | null>(null)
  const [hotelsCount, setHotelsCount] = useState<number | null>(null)

  const [range, setRange] = useState<'7' | '30'>('7')
  const [recentDays, setRecentDays] = useState<DayRow[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [openCompanyRow, setOpenCompanyRow] = useState<Record<string, boolean>>({})

  const [companies, setCompanies] = useState<Company[]>([])
  const [hotels, setHotels] = useState<Hotel[]>([])

  // -------- Role detection (deterministic & gated render) --------
  useEffect(() => {
    ;(async () => {
      try {
        setRoleReady(false)

        const { data: s } = await supabase.auth.getSession()
        const session = s.session
        setUser({ email: session?.user?.email ?? null })
        setUserId(session?.user?.id ?? null)

        // 1) Try RPC get_my_role (if defined)
        let detected: AppRole | null = null
        try {
          const { data: r } = await supabase.rpc('get_my_role')
          const val = String(r ?? '').trim().toLowerCase()
          if (val === 'admin' || val === 'manager' || val === 'front_desk' || val === 'staff') {
            detected = (val === 'staff' ? 'front_desk' : (val as AppRole))
          }
        } catch (_) {
          // ignore if RPC isn't available
        }

        // 2) Fallback to JWT user_metadata.role
        if (!detected) {
          const metaRole = String(session?.user?.user_metadata?.role ?? '')
            .trim()
            .toLowerCase()
          if (metaRole === 'admin' || metaRole === 'manager' || metaRole === 'front_desk' || metaRole === 'staff') {
            detected =  (metaRole === 'staff' ? 'front_desk' : (metaRole as AppRole))
          }
        }

        // 3) Default
        setRole(detected ?? 'front_desk')
      } finally {
        setRoleReady(true)
      }
    })()
  }, [])

  const refreshMyHotels = useCallback(async () => {
    const [{ data: hs }, { data: mh }] = await Promise.all([
      supabase.from('hotels').select('id, name').order('name'),
      supabase.from('member_hotels').select('user_id,hotel_id'),
    ])
    const hotelsRows = (hs ?? []) as Hotel[]
    const memberHotels = (mh ?? []) as MemberHotel[]
    setHotels(hotelsRows)

    if (!userId) {
      setMyHotelIds(hotelsRows.map(h => h.id))
      return
    }

    const explicit = memberHotels.filter(m => m.user_id === userId).map(m => m.hotel_id)
    setMyHotelIds(explicit.length ? explicit : hotelsRows.map(h => h.id))
  }, [userId])

  useEffect(() => {
    if (userId === null) return
    refreshMyHotels()
  }, [userId, refreshMyHotels])

  // ----- CARD METRICS (membership-aware) -----
  const loadCards = useCallback(async (hotelIds: string[], admin: boolean) => {
    try {
      setCardsLoading(true)

      // Invoices
      {
        let q = supabase.from('invoices').select('total, subtotal, rate_night, hotel_id')
        const { data: invs } = await q
        const inv = (invs ?? []).filter((r: any) => admin || (r.hotel_id && hotelIds.includes(r.hotel_id)))
        const sumInvoices = inv.reduce((s, r: any) => {
          const t = Number(r?.total ?? r?.subtotal ?? 0)
          return s + (Number.isFinite(t) ? t : 0)
        }, 0)
        setInvoiceTotal(sumInvoices)

        const rates = inv.map((r: any) => Number(r?.rate_night)).filter((n) => Number.isFinite(n))
        setAvgRateNight(rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0)
      }

      // Payments
      {
        const { data: allocs } = await supabase
          .from('allocations')
          .select('amount, invoices!inner(hotel_id)')
        const totalAllocatedToMyHotels = (allocs ?? [])
          .filter((row: any) => admin || (row.invoices?.hotel_id && hotelIds.includes(row.invoices.hotel_id)))
          .reduce((s, r: any) => s + (Number(r?.amount ?? 0) || 0), 0)
        setPaymentsTotal(totalAllocatedToMyHotels)
      }

      // Hotels count
      if (admin) {
        const { count } = await supabase.from('hotels').select('*', { count: 'exact', head: true })
        setHotelsCount(count ?? 0)
      } else {
        setHotelsCount(hotelIds.length)
      }
    } finally {
      setCardsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!roleReady) return
    if (myHotelIds.length === 0 && !isAdmin) return
    loadCards(myHotelIds, isAdmin)
  }, [loadCards, myHotelIds, isAdmin, roleReady])

  useEffect(() => {
    ;(async () => {
      const { data: cs } = await supabase.from('companies').select('id, name').order('name')
      setCompanies((cs ?? []) as Company[])
    })()
  }, [])

  function monthYear(d: string | null) {
    if (!d) return ''
    const dt = new Date(`${d}T00:00:00`)
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(dt)
  }

  const loadRecent = useCallback(
    async (currentRange: '7' | '30', hotelIds: string[]) => {
      try {
        setRecentLoading(true)
        const days = currentRange === '7' ? 7 : 30
        const startISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

        const { data: pays, error: pErr } = await supabase
          .from('payments')
          .select('id, amount, method, reference, received_date')
          .gte('received_date', startISO)
          .order('received_date', { ascending: false })

        if (pErr || !pays?.length) {
          setRecentDays([])
          return
        }

        const paymentIds = pays.map((p) => p.id)

        const { data: allocs } = await supabase
          .from('allocations')
          .select('payment_id, invoice_id, amount, invoices!inner(hotel_id, company_id, client_id, check_in, clients(name))')
          .in('payment_id', paymentIds)

        const a = (allocs ?? []) as AllocationJoin[]

        const touchesMyHotel = new Set<string>()
        for (const row of a) {
          const hId = row.invoices?.hotel_id ?? null
          if (hId && hotelIds.includes(hId)) touchesMyHotel.add(row.payment_id)
        }

        const byDayTotal = new Map<string, number>()
        for (const p of pays as PaymentRow[]) {
          if (!touchesMyHotel.has(p.id)) continue
          byDayTotal.set(p.received_date, (byDayTotal.get(p.received_date) ?? 0) + Number(p.amount || 0))
        }

        type PerClientMap = Map<string, ClientBreakdown>
        const detailByDay = new Map<string, Map<string, { amount: number; clients: PerClientMap }>>()

        for (const row of a) {
          const inv = row.invoices
          if (!inv) continue
          const hotelId = inv.hotel_id ?? null
          if (!hotelId || !hotelIds.includes(hotelId)) continue

          const payment = (pays as PaymentRow[]).find((p) => p.id === row.payment_id)
          if (!payment) continue
          const day = payment.received_date

          const compId = inv.company_id ?? null
          const topKey = `${compId ?? 'null'}__${hotelId ?? 'null'}`

          if (!detailByDay.has(day)) detailByDay.set(day, new Map())
          const byTop = detailByDay.get(day)!
          if (!byTop.has(topKey)) byTop.set(topKey, { amount: 0, clients: new Map() })
          const bucket = byTop.get(topKey)!

          const inc = Number(row.amount ?? 0)
          bucket.amount += inc

          const cId = inv.client_id ?? null
          const cName = inv.clients?.name ?? '(no client)'
          const period = monthYear(inv.check_in)
          const cKey = `${cId ?? 'null'}__${period || 'unknown'}`
          const existing = bucket.clients.get(cKey) ?? {
            client_id: cId,
            client_name: cName,
            period: period || '',
            amount: 0,
          }
          existing.amount += inc
          bucket.clients.set(cKey, existing)
        }

        const rows: DayRow[] = Array.from(byDayTotal.entries())
          .map(([day, total]) => {
            const byTop = detailByDay.get(day) ?? new Map()
            const details = Array.from(byTop.entries()).map(([k, payload]) => {
              const [company_id, hotel_id] = k.split('__')
              return {
                company_id: company_id === 'null' ? null : company_id,
                hotel_id: hotel_id === 'null' ? null : hotel_id,
                amount: payload.amount,
                clients: Array.from(payload.clients.values()),
              }
            })
            return { day, total, details }
          })
          .sort((a, b) => (a.day < b.day ? 1 : -1))

        setRecentDays(rows)
      } finally {
        setRecentLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!roleReady) return
    if (myHotelIds.length === 0) return
    loadRecent(range, myHotelIds)
  }, [range, myHotelIds, loadRecent, roleReady])

  useEffect(() => {
    if (userId === null) return

    const ch = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        loadCards(myHotelIds, isAdmin)
        loadRecent(range, myHotelIds)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'allocations' }, () => {
        loadRecent(range, myHotelIds)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hotels' }, async () => {
        await refreshMyHotels()
        loadCards(myHotelIds, isAdmin)
        loadRecent(range, myHotelIds)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_hotels' }, async () => {
        await refreshMyHotels()
        loadCards(myHotelIds, isAdmin)
        loadRecent(range, myHotelIds)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [userId, range, myHotelIds, refreshMyHotels, loadRecent, loadCards, isAdmin])

  const email = user?.email ?? ''

  const companyName = (id: string | null) =>
    companies.find((c) => c.id === id)?.name ?? '(no company)'
  const hotelName = (id: string | null) =>
    hotels.find((h) => h.id === id)?.name ?? '(no hotel)'

  // --- while role is being resolved, avoid flashing privileged links ---
  if (!roleReady) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      {/* Top bar */}
      <header className="h-14 bg-white border-b flex items-center justify-between px-3 md:px-6">
        {/* Hamburger (mobile) */}
        <button
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md border text-gray-700"
          aria-label="Open menu"
          onClick={() => setSidebarOpen(true)}
        >
          <span className="i-hamburger">☰</span>
        </button>

        <div className="ml-2 md:ml-0 text-sm text-gray-700 truncate">{email}</div>

        <div className="flex items-center gap-2">
          <Link
            href="/me"
            className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            My Account
          </Link>
          <div className="w-8 h-8 rounded-full bg-gray-200" />
        </div>
      </header>

      <div className="flex relative">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar (drawer on mobile, static on md+) */}
        <aside
          className={[
            'fixed z-50 md:z-auto md:static top-14 md:top-0 left-0 w-[260px] min-h-[calc(100vh-56px)] md:min-h-[calc(100vh-56px)]',
            'bg-[#0b1437] text-white p-6 transition-transform duration-200 ease-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            'md:translate-x-0',
          ].join(' ')}
          aria-label="Sidebar"
        >
          {/* Close button on mobile */}
          <div className="md:hidden flex justify-end -mt-2 -mr-2 mb-2">
            <button
              className="w-8 h-8 rounded-md border border-white/20 text-white"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          <div className="text-[11px] tracking-widest uppercase text-gray-300 mb-4">
            Your productivity
          </div>

          <nav className="space-y-2">
            {canSeeManagerStuff && <SidebarLink href="/invoices" label="AR Management" />}
            {canSeeManagerStuff && <SidebarLink href="/expenses" label="Hotel Expenses Management" />}
            <SidebarLink href="/dnr" label="DNR List" />
            {canSeeManagerStuff && <SidebarLink href="/projects" label="Project Management" />}
            {canSeeAdminCenter && <SidebarLink href="/admin" label="Admin Center" />}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 p-4 md:p-6 md:ml-0 ml-0">
          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card title="Number of Sales" value={cardsLoading ? null : fmtMoney(invoiceTotal ?? 0)} icon="$" />
            <Card title="Sales Revenue" value={cardsLoading ? null : fmtMoney(paymentsTotal ?? 0)} icon="💳" />
            <Card
              title="Average Price"
              value={
                cardsLoading
                  ? null
                  : (avgRateNight ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
              }
              icon="🏷️"
            />
            <Card
              title="Operations"
              value={cardsLoading ? null : (hotelsCount ?? 0).toLocaleString()}
              sub={isAdmin ? 'across all hotels' : 'across your hotels'}
              icon="🏨"
            />
          </div>

          {/* Recent payments */}
          <section className="mt-6 bg-white rounded-2xl border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3">
              <h3 className="font-semibold text-lg">Recent payments</h3>
              <div className="flex gap-2">
                <TabButton active={range === '7'} onClick={() => setRange('7')}>
                  Last 7 days
                </TabButton>
                <TabButton active={range === '30'} onClick={() => setRange('30')}>
                  Last 30 days
                </TabButton>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <Th className="w-10"></Th>
                    <Th>Day</Th>
                    <Th className="text-right">Total payments</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {recentLoading && (
                    <tr>
                      <td colSpan={4} className="p-4">Loading…</td>
                    </tr>
                  )}

                  {!recentLoading && recentDays.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-gray-500">
                        No payments found in the last {range} days.
                      </td>
                    </tr>
                  )}

                  {recentDays.map((d) => {
                    const open = openDay === d.day
                    return (
                      <React.Fragment key={`day-${d.day}`}>
                        <tr className="border-t">
                          <td className="p-3">
                            <button
                              onClick={() => setOpenDay(open ? null : d.day)}
                              className="w-6 h-6 rounded-full border flex items-center justify-center"
                              aria-label={open ? 'Collapse' : 'Expand'}
                            >
                              <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                            </button>
                          </td>
                          <td className="p-3">{d.day}</td>
                          <td className="p-3 text-right">{fmtMoney(d.total)}</td>
                          <td className="p-3"></td>
                        </tr>

                        {open && (
                          <tr className="bg-gray-50/60">
                            <td></td>
                            <td colSpan={3} className="py-2">
                              {d.details.length === 0 ? (
                                <div className="px-6 py-3 text-gray-500">
                                  No allocations recorded for accessible hotels.
                                </div>
                              ) : (
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="text-gray-500">
                                      <Th>Company</Th>
                                      <Th>Hotel</Th>
                                      <Th className="text-right">Amount</Th>
                                      <Th className="text-right">Details</Th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.details
                                      .sort((a, b) => b.amount - a.amount)
                                      .map((row, i) => {
                                        const key = `${d.day}|${row.company_id ?? 'null'}|${row.hotel_id ?? 'null'}`
                                        const isOpen = !!openCompanyRow[key]
                                        return (
                                          <React.Fragment key={`comp-${key}-${i}`}>
                                            <tr className="border-t">
                                              <td className="p-3">{companyName(row.company_id)}</td>
                                              <td className="p-3">{hotelName(row.hotel_id)}</td>
                                              <td className="p-3 text-right">{fmtMoney(row.amount)}</td>
                                              <td className="p-3 text-right">
                                                <button
                                                  className="underline text-xs"
                                                  onClick={() =>
                                                    setOpenCompanyRow(prev => ({ ...prev, [key]: !prev[key] }))
                                                  }
                                                >
                                                  {isOpen ? 'Hide' : 'Show'}
                                                </button>
                                              </td>
                                            </tr>

                                            {isOpen && row.clients.length > 0 && (
                                              <tr className="bg-white/70">
                                                <td colSpan={4} className="p-3 pt-1">
                                                  <ul className="list-disc pl-6">
                                                    {row.clients
                                                      .sort((a, b) => b.amount - a.amount)
                                                      .map((c, idx) => (
                                                        <li key={`${key}|client-${c.client_id ?? 'null'}|${c.period}|${idx}`}>
                                                          <span className="font-medium">{c.client_name}</span>{' '}
                                                          {c.period} {fmtMoney(c.amount)} paid
                                                        </li>
                                                      ))}
                                                  </ul>
                                                </td>
                                              </tr>
                                            )}
                                          </React.Fragment>
                                        )
                                      })}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

/* ---------- UI helpers ---------- */

function SidebarLink({ href, label }: { href: string; label: string }) {
  const isDisabled = href === '#'
  const base = 'block px-3 py-2 rounded-lg text-sm hover:bg-white/10 transition'
  return isDisabled ? (
    <span className={`${base} opacity-60 cursor-not-allowed`}>{label}</span>
  ) : (
    <Link className={base} href={href}>
      {label}
    </Link>
  )
}

function Card({
  title,
  value,
  sub,
  icon,
}: {
  title: string
  value: string | number | null
  sub?: string
  icon?: string
}) {
  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg">
          {icon ?? '—'}
        </div>
        <div className="flex-1">
          <div className="text-sm text-gray-500">{title}</div>
          <div className="text-xl font-semibold">{value === null ? '—' : value}</div>
          {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'px-3 py-1.5 rounded-full bg-[#0b1437] text-white text-xs'
          : 'px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-xs'
      }
    >
      {children}
    </button>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`p-3 text-left font-medium ${className}`}>{children}</th>
}

function fmtMoney(v: number) {
  return (Number(v) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
