'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type UserLite = { id: string; email: string | null }
type Hotel = { id: string; name: string }
type MemberHotel = { user_id: string; hotel_id: string }
type InvoiceLite = { id: string; number: string | null; total: number | null; balance: number | null; status: string | null }

// new: richer role type (compatible with your upcoming roles)
type Role = 'admin' | 'manager' | 'front_desk'

export default function MePage() {
  const router = useRouter()

  const [user, setUser] = useState<UserLite | null>(null)
  const [role, setRole] = useState<Role>('front_desk')

  const [hotels, setHotels] = useState<Hotel[]>([])
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])
  const [loadingHotels, setLoadingHotels] = useState(true)

  const [invoices, setInvoices] = useState<InvoiceLite[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(true)

  const [err, setErr] = useState<string | null>(null)

  // Gate: must be signed in, otherwise go to /login
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.replace('/login')
        return
      }
      const u = data.session.user
      if (!cancelled) setUser({ id: u.id, email: u.email ?? null })
    })()
    return () => { cancelled = true }
  }, [router])

  // Load role (prefer members.role; fallback to is_admin)
  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        setErr(null)
        // Try members.role first
        const { data: mRow, error: mErr } = await supabase
          .from('members')
          .select('role')
          .eq('user_id', user.id)
          .single()

        if (!mErr && mRow?.role) {
          const r = String(mRow.role).toLowerCase()
          if (r === 'admin' || r === 'manager' || r === 'front_desk') {
            setRole(r as Role)
            return
          }
        }

        // Fallback: legacy RPC (treat as admin vs front_desk)
        const { data: isAdm } = await supabase.rpc('is_admin')
        setRole(isAdm ? 'admin' : 'front_desk')
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to check role')
      }
    })()
  }, [user?.id])

  // Load hotel access
  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      setLoadingHotels(true)
      try {
        const [{ data: hs }, { data: mh }] = await Promise.all([
          supabase.from('hotels').select('id, name').is('deleted_at', null).order('name'),
          supabase.from('member_hotels').select('user_id, hotel_id'),
        ])
        const allHotels = (hs ?? []) as Hotel[]
        setHotels(allHotels)

        const explicit = (mh ?? []).filter(m => m.user_id === user.id)
        const ids = explicit.length ? explicit.map(m => (m as MemberHotel).hotel_id) : allHotels.map(h => h.id)
        setMyHotelIds(ids)
      } catch (e: any) {
        setErr(prev => prev ?? (e?.message ?? 'Failed to load hotels'))
        setHotels([])
        setMyHotelIds([])
      } finally {
        setLoadingHotels(false)
      }
    })()
  }, [user?.id])

  // Load small invoice preview
  useEffect(() => {
    ;(async () => {
      setLoadingInvoices(true)
      try {
        const { data, error } = await supabase
          .from('invoices')
          .select('id, number, total, balance, status')
          .order('created_at', { ascending: false })
          .limit(5)
        if (error) throw error
        setInvoices((data ?? []) as InvoiceLite[])
      } catch (e: any) {
        setErr(prev => prev ?? (e?.message ?? 'Failed to load invoices'))
        setInvoices([])
      } finally {
        setLoadingInvoices(false)
      }
    })()
  }, [])

  // Actions
  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // UI helpers
  const email = user?.email ?? ''
  const initials = useMemo(() => {
    if (!email) return 'U'
    const base = email.split('@')[0] || email
    return base.slice(0, 2).toUpperCase()
  }, [email])

  function fmtMoney(n: number | null | undefined) {
    const v = Number(n ?? 0)
    return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
  }

  // friendly label for role
  const roleLabel = role === 'front_desk' ? 'front desk' : role

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Account</h1>
        <div className="flex gap-2">
          <Link href="/#" className="rounded border px-3 py-2 text-sm bg-white">Home</Link>
          <Link href="/invoices" className="rounded border px-3 py-2 text-sm bg-white">View invoices</Link>
          <button onClick={signOut} className="rounded bg-black text-white px-3 py-2 text-sm">Sign out</button>
        </div>
      </div>

      {err && <p className="text-red-600">{err}</p>}

      {/* Profile Card */}
      <section className="bg-white border rounded-2xl p-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-lg font-semibold">
            {initials}
          </div>
          <div className="flex-1">
            <div className="text-lg font-medium">{email || '—'}</div>
            <div className="mt-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                ${role === 'admin'
                  ? 'bg-green-100 text-green-800'
                  : role === 'manager'
                  ? 'bg-indigo-100 text-indigo-800'
                  : 'bg-blue-100 text-blue-800'}`}
              >
                {roleLabel}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Hotel Access */}
      <section className="bg-white border rounded-2xl">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Hotel access</h2>
          <p className="text-sm text-gray-500 mt-1">These are the properties you can work with.</p>
        </div>
        <div className="p-4">
          {loadingHotels ? (
            <div className="text-sm text-gray-600">Loading hotels…</div>
          ) : myHotelIds.length === 0 ? (
            <div className="text-sm text-gray-600">No hotel access assigned.</div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {hotels
                .filter(h => myHotelIds.includes(h.id))
                .map(h => (
                  <li key={h.id} className="border rounded-xl p-3 hover:bg-gray-50 transition">
                    <div className="text-sm text-gray-500">Hotel</div>
                    <div className="font-medium">{h.name}</div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent Invoices (preview) */}
      <section className="bg-white border rounded-2xl">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Recent invoices</h2>
            <p className="text-sm text-gray-500 mt-1">A quick look at your latest activity.</p>
          </div>
          <Link href="/invoices" className="text-sm underline">Open invoices</Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Invoice</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Balance</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loadingInvoices && (
                <tr><td colSpan={4} className="p-3">Loading…</td></tr>
              )}
              {!loadingInvoices && invoices.length === 0 && (
                <tr><td colSpan={4} className="p-3 text-gray-500">No recent invoices.</td></tr>
              )}
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t">
                  <td className="p-2">
                    <Link href="/invoices" className="underline">
                      {inv.number ?? inv.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-2 text-right">{fmtMoney(inv.total)}</td>
                  <td className="p-2 text-right">{fmtMoney(inv.balance)}</td>
                  <td className="p-2 capitalize">{inv.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer note (no link) */}
      <section className="bg-white border rounded-2xl p-4">
        <p className="text-sm text-gray-600">
          If you need your access updated or have trouble signing in, contact an admin.
          Admins can manage hotels and member access.
        </p>
      </section>
    </main>
  )
}
