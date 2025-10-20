'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Hotel = { id: string; name: string }
type MemberHotel = { user_id: string; hotel_id: string }

export default function NewVendorPage() {
  const router = useRouter()

  // ---- membership scaffolding
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])
  const [hotels, setHotels] = useState<Hotel[]>([])

  const [name, setName] = useState('')
  const [ein, setEin] = useState('') // optional
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // load hotels + memberships
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
        setMyHotelIds(mine.length ? mine : hotelRows.map(h => h.id))
      } catch {
        // non-fatal
      }
    })()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const n = name.trim()
    if (!n) { setErr('Vendor name is required'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('vendors').insert({
        name: n,
        ein: ein.trim() || null,
      })
      if (error) throw error
      router.push('/vendors')
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create vendor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">New Vendor</h1>

      <div className="mb-4 flex gap-2">
        <Link href="/vendors" className="rounded bg-white border px-3 py-2 text-sm">Back to Vendors</Link>
      </div>

      {err && <p className="text-red-600 mb-3">{err}</p>}

      <form onSubmit={onSubmit} className="space-y-4 bg-white border rounded p-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">Name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="border rounded p-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">EIN (optional)</span>
          <input
            value={ein}
            onChange={e => setEin(e.target.value)}
            className="border rounded p-2"
            placeholder="##-#######"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Create vendor'}
        </button>
      </form>
    </main>
  )
}
