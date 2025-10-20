'use client'

/**
 * app/invoices/[id]/audit/page.tsx
 * Human-friendly audit log with names + payment reference.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

/* ---------- ACCESS GATE (manager/admin only) ---------- */
type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'
function useGateForInvoiceAudit() {
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/login'; return }
      const { data: r } = await supabase.rpc('get_my_role')
      const role = (r ?? 'staff') as AppRole
      const allowed = role === 'manager' || role === 'admin'
      if (!allowed && !ignore) window.location.href = '/#'
    })()
    return () => { ignore = true }
  }, [])
}
/* ------------------------------------------------------ */

type AuditRow = {
  id: string
  created_at: string
  action: string
  user_id: string | null
  note: string | null
  details: any | null
}

function fmtMoney(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}
function fmtDate(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString()
}

function KV({ obj }: { obj: Record<string, any> }) {
  const entries = Object.entries(obj ?? {})
  if (entries.length === 0) return null
  return (
    <div className="text-xs border rounded p-2 bg-gray-50">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-2 py-0.5">
          <div className="text-gray-600">{k}</div>
          <div className="col-span-2 break-words">
            {typeof v === 'number' ? v : typeof v === 'string' ? v : JSON.stringify(v)}
          </div>
        </div>
      ))}
    </div>
  )
}

function HumanDetails({ action, details }: { action: string; details: any }) {
  const d = (details ?? {}) as Record<string, any>
  const lines: JSX.Element[] = []

  const client = d.client_name ?? d.client_id ?? ''
  const hotel  = d.hotel_name  ?? d.hotel_id  ?? ''

  if (action === 'create_invoice') {
    lines.push(
      <p key="create">
        Created invoice <b>{d.number ?? '(no number)'}</b> for client <b>{client}</b> at hotel{' '}
        <b>{hotel}</b> — nights <b>{d.nights ?? '?'}</b>, rate <b>{fmtMoney(d.rate_night)}</b>, subtotal{' '}
        <b>{fmtMoney(d.subtotal)}</b>. Issue <b>{fmtDate(d.issue_date)}</b>, due <b>{fmtDate(d.due_date)}</b>. Case{' '}
        <b>{d.case_no ?? d.case ?? '-'}</b>.
      </p>
    )
  } else if (action === 'update_total') {
    lines.push(
      <p key="update_total">
        Updated total from <b>{fmtMoney(d.old_total)}</b> to <b>{fmtMoney(d.new_total)}</b>.
      </p>
    )
  } else if (action === 'void_invoice') {
    lines.push(<p key="void">Voided invoice. All amounts set to <b>{fmtMoney(0)}</b>.</p>)
  } else if (action === 'payment_applied') {
    lines.push(
      <p key="pay">
        Applied payment <b>{fmtMoney(d.amount)}</b> via <b>{d.method}</b>
        {d.reference ? <> (ref <b>{d.reference}</b>)</> : null} on <b>{fmtDate(d.received_date)}</b>.
      </p>
    )
  } else if (action === 'status_change') {
    lines.push(
      <p key="status">
        Status changed from <b>{d.from}</b> to <b>{d.to}</b>.
      </p>
    )
  }

  const known = new Set([
    'number','client_name','client_id','hotel_name','hotel_id','nights','rate_night','subtotal',
    'issue_date','due_date','case_no','case','old_total','new_total','amount','method',
    'reference','received_date','from','to','user_email'
  ])
  const extras: Record<string, any> = {}
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) extras[k] = v

  return (
    <div className="space-y-2">
      {lines}
      {Object.keys(extras).length > 0 && (
        <>
          <div className="text-xs text-gray-600">More details</div>
          <KV obj={extras} />
        </>
      )}
    </div>
  )
}

export default function InvoiceAuditPage() {
  useGateForInvoiceAudit() // apply gate

  const { id: invoiceId } = useParams() as { id: string }

  const [rows, setRows] = useState<AuditRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!invoiceId) return
    ;(async () => {
      setErr(null)
      setLoading(true)
      const { data, error } = await supabase
        .from('invoice_audit')
        .select('id, created_at, action, user_id, note, details')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false })
      if (error) setErr(error.message)
      setRows((data ?? []) as AuditRow[])
      setLoading(false)
    })()
  }, [invoiceId])

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoice audit</h1>
        <Link href="/invoices" className="underline text-sm">Back to invoices</Link>
      </div>

      {err && <p className="text-red-600">{err}</p>}

      {/* ===== Mobile list (cards) ===== */}
      <div className="space-y-3 md:hidden">
        {loading && <div className="border rounded p-4 text-sm">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="border rounded p-4 text-sm text-gray-500">No entries.</div>
        )}
        {!loading && rows.map((r) => {
          const email = (r.details && (r.details as any).user_email) || ''
          const badge =
            r.action === 'payment_applied' ? 'bg-emerald-100 text-emerald-700' :
            r.action === 'update_total'    ? 'bg-blue-100 text-blue-700' :
            r.action === 'void_invoice'    ? 'bg-gray-200 text-gray-700' :
            r.action === 'status_change'   ? 'bg-amber-100 text-amber-800' :
            'bg-purple-100 text-purple-700'
          return (
            <div key={r.id} className="border rounded-xl bg-white">
              <div className="p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{fmtDateTime(r.created_at)}</div>
                  <div className="text-xs text-gray-500">{email || r.user_id || ''}</div>
                  {r.note && <div className="text-xs mt-1">{r.note}</div>}
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${badge}`}>{r.action}</span>
              </div>
              <div className="px-3 pb-3">
                <HumanDetails action={r.action} details={r.details} />
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
              <th className="p-2 text-left w-48">When</th>
              <th className="p-2 text-left w-44">Action</th>
              <th className="p-2 text-left w-56">User</th>
              <th className="p-2 text-left">Note</th>
              <th className="p-2 text-left w-[52%]">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-4">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="p-4 text-gray-500">No entries.</td></tr>}
            {rows.map((r) => {
              const email = (r.details && (r.details as any).user_email) || ''
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="p-2">{r.action}</td>
                  <td className="p-2">{email || r.user_id || ''}</td>
                  <td className="p-2">{r.note ?? ''}</td>
                  <td className="p-2"><HumanDetails action={r.action} details={r.details} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}
