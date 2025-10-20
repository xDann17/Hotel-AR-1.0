'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Hotel = { id: string; name: string }
type MemberHotel = { user_id: string; hotel_id: string }

export default function NewProjectPage() {
  const router = useRouter()

  // lookups + access
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])

  // form
  const [hotelId, setHotelId] = useState<string>('')
  const [name, setName] = useState('')
  const [contractor, setContractor] = useState('')
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState<string>('')

  // ui
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // load hotels + my access
  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        const [{ data: hs }, { data: mh }, { data: auth }] = await Promise.all([
          supabase.from('hotels').select('id,name').order('name'),
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])

        const hotelsRows = (hs ?? []) as Hotel[]
        setHotels(hotelsRows)

        const uid = auth.user?.id
        const members = (mh ?? []) as MemberHotel[]
        const mine = uid ? members.filter(m => m.user_id === uid).map(m => m.hotel_id) : []
        const accessible = mine.length ? mine : hotelsRows.map(h => h.id)
        setMyHotelIds(accessible)

        // default hotel select (first accessible)
        if (!hotelId && accessible.length) setHotelId(accessible[0])
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load hotels')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const myHotels = useMemo(
    () => hotels.filter(h => myHotelIds.includes(h.id)),
    [hotels, myHotelIds]
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setMsg(null)

    if (!hotelId) { setErr('Please choose a hotel.'); return }
    // NEW: submit-time access guard (defense-in-depth)
    if (!myHotelIds.includes(hotelId)) { setErr('You do not have access to this hotel.'); return }
    if (!name.trim()) { setErr('Project name is required.'); return }
    if (!startDate) { setErr('Start date is required.'); return }

    try {
      setSaving(true)
      const { data, error } = await supabase
        .from('projects')
        .insert({
          hotel_id: hotelId,
          name: name.trim(),
          contractor: contractor.trim() || null,
          start_date: startDate,
          end_date: endDate || null,
        })
        .select('id')
        .single()

      if (error) throw error

      setMsg('Project created')
      setTimeout(() => router.push('/projects'), 500)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">New Project</h1>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <aside className="space-y-2">
          <Link href="/#" className="block rounded bg-white border px-3 py-2 text-sm text-left">Home</Link>
          <Link href="/projects" className="block rounded bg-white border px-3 py-2 text-sm text-left">Projects</Link>
        </aside>

        <section className="bg-white border rounded p-4">
          {err && <p className="text-red-600 mb-2">{err}</p>}
          {msg && <p className="text-green-700 mb-2">{msg}</p>}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm text-gray-600">Hotel</span>
                <select
                  value={hotelId}
                  onChange={e => setHotelId(e.target.value)}
                  className="mt-1 w-full border rounded p-2"
                >
                  {myHotels.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-gray-600">Project name</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. 2025 Lobby Renovation"
                  className="mt-1 w-full border rounded p-2"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-600">Contractor / Employee</span>
                <input
                  value={contractor}
                  onChange={e => setContractor(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full border rounded p-2"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-600">Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="mt-1 w-full border rounded p-2"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-600">End date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="mt-1 w-full border rounded p-2"
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create project'}
              </button>
              <Link href="/projects" className="rounded border bg-white px-4 py-2 text-sm">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
