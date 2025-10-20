'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Detail = {
  id: string                // invoice id
  number: string            // invoice number
  due_date: string | null
  balance: number
  bucket: 'Current (0-30)' | '31-60' | '61-90' | '91+' | 'Paid/Zero' | string
}

type BucketGroup = {
  label: string
  total: number
  count: number
  rows: Detail[]
}

type Hotel = { id: string; name: string }
type InvoiceMeta = { id: string; hotel_id: string | null; company_name: string | null }

function money(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toISOString().slice(0, 10) } catch { return d }
}

const BUCKET_ORDER = ['Current (0-30)', '31-60', '61-90', '91+']

export default function AgingReportPage() {
  const [details, setDetails] = useState<Detail[]>([])
  const [invoiceMeta, setInvoiceMeta] = useState<Record<string, InvoiceMeta>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Hotel filter
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [hotelId, setHotelId] = useState<'all' | string>('all')

  // NEW: membership
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])

  // ---- Load hotels + membership once
  useEffect(() => {
    ;(async () => {
      try {
        const [{ data: hs }, { data: mh }, { data: authUser }] = await Promise.all([
          supabase.from('hotels').select('id,name').order('name'),
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])

        const hotelsRows = (hs ?? []) as Hotel[]
        setHotels(hotelsRows)

        const uid = authUser.user?.id
        const members = (mh ?? []) as { user_id: string; hotel_id: string }[]
        const mine = uid ? members.filter(m => m.user_id === uid).map(m => m.hotel_id) : []

        // If user has explicit memberships, restrict to those; else all hotels
        setMyHotelIds(mine.length ? mine : hotelsRows.map(h => h.id))
      } catch {
        // Non-fatal; the rest of the page can still render
      }
    })()
  }, [])

  // ---- Load aging detail and invoice meta
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        // 1) details from RPC
        const { data, error } = await supabase.rpc('aging_report_detail')
        if (error) throw error
        const rows = (data ?? []) as Detail[]
        setDetails(rows)

        // 2) fetch per-invoice company + hotel for those invoice ids
        const ids = rows.map(r => r.id)
        let meta: Record<string, InvoiceMeta> = {}
        if (ids.length) {
          const { data: invs, error: invErr } = await supabase
            .from('invoices')
            .select('id, hotel_id, companies(name)')
            .in('id', ids)
          if (invErr) throw invErr
          for (const r of invs ?? []) {
            meta[r.id] = {
              id: r.id,
              hotel_id: r.hotel_id ?? null,
              company_name: (r as any).companies?.name ?? null,
            }
          }
        }
        setInvoiceMeta(meta)
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load aging report')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ---- Apply hotel filter + membership restriction
  const filtered = useMemo(() => {
    let base = details

    // Membership guard: if we have any hotel ids, limit to them
    if (myHotelIds.length) {
      base = base.filter(d => {
        const hid = invoiceMeta[d.id]?.hotel_id ?? ''
        return myHotelIds.includes(hid)
      })
    }

    // Explicit hotel filter
    if (hotelId !== 'all') {
      base = base.filter(d => invoiceMeta[d.id]?.hotel_id === hotelId)
    }

    return base
  }, [details, invoiceMeta, hotelId, myHotelIds])

  // ---- Bucket summary (top table stays the same)
  const groups = useMemo<BucketGroup[]>(() => {
    const map = new Map<string, BucketGroup>()
    for (const row of filtered) {
      if (row.bucket === 'Paid/Zero') continue
      if (!map.has(row.bucket)) map.set(row.bucket, { label: row.bucket, total: 0, count: 0, rows: [] })
      const g = map.get(row.bucket)!
      g.rows.push(row)
      g.total += Number(row.balance) || 0
      g.count += 1
    }
    return [...map.values()].sort((a, b) => {
      const ia = BUCKET_ORDER.indexOf(a.label)
      const ib = BUCKET_ORDER.indexOf(b.label)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  }, [filtered])

  const grandTotal = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups])
  const grandCount = useMemo(() => groups.reduce((s, g) => s + g.count, 0), [groups])

  function toggle(label: string) {
    setOpen(prev => ({ ...prev, [label]: !prev[label] }))
  }

  // ---- Company breakdown across ALL buckets
  type CompanyRow = {
    company: string
    count: number
    b0_30: number
    b31_60: number
    b61_90: number
    b91p: number
    total: number
  }

  const byCompanyAllBuckets = useMemo<CompanyRow[]>(() => {
    const agg = new Map<string, CompanyRow>()
    for (const r of filtered) {
      if (r.bucket === 'Paid/Zero') continue
      const meta = invoiceMeta[r.id]
      const name = meta?.company_name || '(no company)'
      if (!agg.has(name)) {
        agg.set(name, { company: name, count: 0, b0_30: 0, b31_60: 0, b61_90: 0, b91p: 0, total: 0 })
      }
      const a = agg.get(name)!
      a.count += 1
      const amt = Number(r.balance) || 0
      if (r.bucket === 'Current (0-30)') a.b0_30 += amt
      else if (r.bucket === '31-60') a.b31_60 += amt
      else if (r.bucket === '61-90') a.b61_90 += amt
      else if (r.bucket === '91+') a.b91p += amt
      a.total += amt
    }
    const rows = [...agg.values()]
    rows.sort((x, y) => y.total - x.total || x.company.localeCompare(y.company))
    return rows
  }, [filtered, invoiceMeta])

  // ---- For each bucket, company totals (when expanding)
  function companyTotalsForBucket(label: string) {
    const agg = new Map<string, { company: string; count: number; total: number }>()
    const g = groups.find(x => x.label === label)
    if (!g) return []
    for (const r of g.rows) {
      const name = invoiceMeta[r.id]?.company_name || '(no company)'
      if (!agg.has(name)) agg.set(name, { company: name, count: 0, total: 0 })
      const a = agg.get(name)!
      a.count += 1
      a.total += Number(r.balance) || 0
    }
    const rows = [...agg.values()]
    rows.sort((x, y) => y.total - x.total || x.company.localeCompare(y.company))
    return rows
  }

  function exportCsv() {
    const headers = ['Invoice','Company','Hotel','Bucket','Due Date','Balance']
    const lines: string[] = [headers.join(',')]
    for (const r of filtered) {
      if (r.bucket === 'Paid/Zero') continue
      const meta = invoiceMeta[r.id]
      lines.push([
        `"${r.number.replace(/"/g, '""')}"`,
        `"${(meta?.company_name ?? '').replace(/"/g, '""')}"`,
        `"${hotels.find(h => h.id === meta?.hotel_id)?.name ?? ''}"`,
        r.bucket,
        fmtDate(r.due_date),
        (Number(r.balance) || 0).toFixed(2)
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'aging_report_detail.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Only show accessible hotels in the dropdown
  const visibleHotels = useMemo(
    () => hotels.filter(h => myHotelIds.length === 0 || myHotelIds.includes(h.id)),
    [hotels, myHotelIds]
  )

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Aging Report</h1>
        <Link href="/invoices" className="rounded border bg-white px-3 py-2 text-sm">Back to Invoices</Link>
      </div>

      {/* Hotel filter */}
      <div className="flex flex-wrap gap-2">
        <select
          className="border rounded p-2 text-sm"
          value={hotelId}
          onChange={(e) => setHotelId(e.target.value as any)}
        >
          <option value="all">All hotels</option>
          {visibleHotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {error && <p className="text-red-600">Error: {error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && !error && (
        <>
          {/* ===== Mobile: bucket summary cards ===== */}
          <div className="space-y-3 md:hidden">
            {groups.map(g => (
              <div key={g.label} className="border rounded-xl bg-white">
                <div className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{g.label}</div>
                    <div className="text-xs text-gray-500">{g.count} invoices</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-gray-500">Total</div>
                    <div className="font-medium">{money(g.total)}</div>
                  </div>
                </div>
                <div className="px-3 pb-3">
                  <button
                    className="underline text-xs"
                    onClick={() => toggle(g.label)}
                  >
                    {open[g.label] ? 'Hide details' : 'Show details'}
                  </button>
                </div>

                {/* Per-bucket company totals (mobile) */}
                {open[g.label] && (
                  <div className="px-3 pb-3">
                    {companyTotalsForBucket(g.label).length === 0 ? (
                      <div className="text-sm text-gray-500">No data.</div>
                    ) : (
                      <div className="space-y-2">
                        {companyTotalsForBucket(g.label).map(row => (
                          <div key={row.company} className="border rounded-lg p-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{row.company}</div>
                              <div className="text-xs text-gray-500">{row.count} inv</div>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-sm">
                              <span className="text-gray-600">Amount</span>
                              <b>{money(row.total)}</b>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Mobile grand totals */}
            <div className="border rounded-xl bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-gray-600">All buckets</div>
                <div className="text-xs text-gray-500">{grandCount} invoices</div>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-medium">Grand total</span>
                <b>{money(grandTotal)}</b>
              </div>
            </div>
          </div>

          {/* ===== Desktop bucket summary table (original) ===== */}
          <div className="border rounded overflow-hidden hidden md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Bucket</th>
                  <th className="p-2 text-right">Count</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Expand</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.label} className="border-t">
                    <td className="p-2">{g.label}</td>
                    <td className="p-2 text-right">{g.count}</td>
                    <td className="p-2 text-right">{money(g.total)}</td>
                    <td className="p-2 text-right">
                      <button className="underline text-xs" onClick={() => toggle(g.label)}>
                        {open[g.label] ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-medium bg-gray-50">
                  <td className="p-2">Total</td>
                  <td className="p-2 text-right">{grandCount}</td>
                  <td className="p-2 text-right">{money(grandTotal)}</td>
                  <td className="p-2"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ===== Mobile: company breakdown (all buckets) ===== */}
          <section className="md:hidden">
            <div className="font-semibold mb-2">Company breakdown (all buckets)</div>
            {byCompanyAllBuckets.length === 0 ? (
              <div className="border rounded p-3 text-sm text-gray-500 bg-white">No open invoices.</div>
            ) : (
              <div className="space-y-2">
                {byCompanyAllBuckets.map(r => (
                  <div key={r.company} className="border rounded-xl bg-white p-3">
                    <div className="flex items-start justify-between">
                      <div className="font-medium">{r.company}</div>
                      <div className="text-xs text-gray-500">{r.count} inv</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">0–30</div>
                        <div className="font-medium">{money(r.b0_30)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">31–60</div>
                        <div className="font-medium">{money(r.b31_60)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">61–90</div>
                        <div className="font-medium">{money(r.b61_90)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">90+</div>
                        <div className="font-medium">{money(r.b91p)}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Total</span>
                      <b>{money(r.total)}</b>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ===== Desktop: company breakdown table (original) ===== */}
          <section className="border rounded hidden md:block">
            <div className="p-3 bg-gray-50 font-semibold">Company breakdown (all buckets)</div>
            <div className="p-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Company</th>
                    <th className="p-2 text-right">Open invoices</th>
                    <th className="p-2 text-right">0–30</th>
                    <th className="p-2 text-right">31–60</th>
                    <th className="p-2 text-right">61–90</th>
                    <th className="p-2 text-right">90+</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byCompanyAllBuckets.map(r => (
                    <tr key={r.company} className="border-t">
                      <td className="p-2">{r.company}</td>
                      <td className="p-2 text-right">{r.count}</td>
                      <td className="p-2 text-right">{money(r.b0_30)}</td>
                      <td className="p-2 text-right">{money(r.b31_60)}</td>
                      <td className="p-2 text-right">{money(r.b61_90)}</td>
                      <td className="p-2 text-right">{money(r.b91p)}</td>
                      <td className="p-2 text-right">{money(r.total)}</td>
                    </tr>
                  ))}
                  {byCompanyAllBuckets.length === 0 && (
                    <tr><td colSpan={7} className="p-2 text-gray-500">No open invoices.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ===== Desktop per-bucket expansion (original) ===== */}
          {groups.map(g => {
            if (!open[g.label]) return null
            const rows = companyTotalsForBucket(g.label)
            return (
              <div key={g.label} className="border rounded hidden md:block">
                <div className="p-3 bg-gray-50 font-semibold">
                  {g.label} — {g.count} invoices · {money(g.total)}
                </div>
                <div className="p-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr>
                        <th className="p-2 text-left">Company</th>
                        <th className="p-2 text-right">Open invoices</th>
                        <th className="p-2 text-right">Total ({g.label})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.company} className="border-t">
                          <td className="p-2">{r.company}</td>
                          <td className="p-2 text-right">{r.count}</td>
                          <td className="p-2 text-right">{money(r.total)}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={3} className="p-2 text-gray-500">No data.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Export */}
          <button onClick={exportCsv} className="rounded bg-black text-white px-3 py-2 text-sm">
            Export detailed CSV
          </button>
        </>
      )}
    </main>
  )
}
