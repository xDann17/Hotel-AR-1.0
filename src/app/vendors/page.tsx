'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Vendor = { id: string; name: string; ein: string | null }
type MemberHotel = { user_id: string; hotel_id: string }
type Hotel = { id: string; name: string }

export default function VendorsPage() {
  // ---- membership scaffolding (loaded, not used yet)
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])
  const [hotels, setHotels] = useState<Hotel[]>([]) // optional cache, in case you want later

  const [rows, setRows] = useState<Vendor[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEin, setEditEin] = useState('')

  // ---- load membership (same pattern as other pages)
  useEffect(() => {
    ;(async () => {
      try {
        const [{ data: hs }, { data: mh }, { data: authUser }] = await Promise.all([
          supabase.from('hotels').select('id,name').order('name'),
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])

        const hotelRows = (hs ?? []) as Hotel[]
        setHotels(hotelRows)

        const uid = authUser.user?.id
        const members = (mh ?? []) as MemberHotel[]
        const mine = uid ? members.filter(m => m.user_id === uid).map(m => m.hotel_id) : []
        // fallback to all hotel ids if no explicit memberships recorded
        setMyHotelIds(mine.length ? mine : hotelRows.map(h => h.id))
      } catch {
        // non-fatal here; vendors page still works
      }
    })()
  }, [])

  async function fetchRows() {
    setLoading(true); setErr(null)
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id,name,ein')
        .order('name')
      if (error) throw error
      setRows((data ?? []) as Vendor[])
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load vendors')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(v =>
      (v.name ?? '').toLowerCase().includes(s) ||
      (v.ein ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  function startEdit(v: Vendor) {
    setEditing(v.id)
    setEditName(v.name)
    setEditEin(v.ein ?? '')
  }

  async function saveEdit(id: string) {
    setErr(null); setMsg(null)
    const name = editName.trim()
    const ein = editEin.trim() || null
    if (!name) { setErr('Name is required'); return }
    const { error } = await supabase.from('vendors').update({ name, ein }).eq('id', id)
    if (error) { setErr(error.message); return }
    setMsg('Vendor updated')
    setEditing(null)
    await fetchRows()
  }

  async function del(id: string) {
    if (!confirm('Delete this vendor? This does not remove existing expenses that reference it.')) return
    setErr(null); setMsg(null)
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setMsg('Vendor deleted')
    await fetchRows()
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <div className="flex gap-2">
          <Link href="/expenses" className="rounded bg-white border px-3 py-2 text-sm">Back to Expenses</Link>
          <Link href="/vendors/new" className="rounded bg-black text-white px-3 py-2 text-sm">+ New Vendor</Link>
        </div>
      </div>

      {err && <p className="text-red-600 mb-2">{err}</p>}
      {msg && <p className="text-green-700 mb-2">{msg}</p>}

      <div className="mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or EIN…"
          className="border rounded p-2 w-[320px]"
        />
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">EIN</th>
              <th className="p-2 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={3} className="p-4">Loading…</td></tr>)}
            {!loading && filtered.length === 0 && (<tr><td colSpan={3} className="p-4 text-gray-500">No vendors.</td></tr>)}
            {filtered.map(v => (
              <tr key={v.id} className="border-t">
                <td className="p-2">
                  {editing === v.id
                    ? <input value={editName} onChange={e => setEditName(e.target.value)} className="border rounded p-1 w-full" />
                    : v.name}
                </td>
                <td className="p-2">
                  {editing === v.id
                    ? <input value={editEin} onChange={e => setEditEin(e.target.value)} className="border rounded p-1 w-full" placeholder="##-#######" />
                    : (v.ein ?? '')}
                </td>
                <td className="p-2">
                  {editing === v.id ? (
                    <div className="flex gap-2">
                      <button className="px-2 py-1 text-sm rounded bg-black text-white" onClick={() => saveEdit(v.id)}>Save</button>
                      <button className="px-2 py-1 text-sm rounded border bg-white" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button className="px-2 py-1 text-sm rounded border bg-white" onClick={() => startEdit(v)}>Edit</button>
                      <button className="px-2 py-1 text-sm rounded border bg-white" onClick={() => del(v.id)}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
