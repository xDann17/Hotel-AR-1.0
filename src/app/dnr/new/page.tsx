'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type ZipInfo = { city: string; state: string }
type Role = 'front_desk' | 'manager' | 'admin'

export default function NewDnrPage() {
  const router = useRouter()

  // --- Access gate (additions) ---
  const [authLoading, setAuthLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const allowedRoles: Role[] = ['front_desk', 'manager', 'admin']

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
        // Prefer the role from members
        const { data: m, error: mErr } = await supabase
          .from('members')
          .select('role')
          .eq('user_id', uid)
          .single()

        if (!mErr && m?.role) {
          const r = String(m.role).toLowerCase() as Role
          if (!cancelled) setRole((['front_desk','manager','admin'] as const).includes(r) ? r : null)
        } else {
          // Fallback: is_admin => admin, else treat as front_desk
          const { data: isAdm } = await supabase.rpc('is_admin')
          if (!cancelled) setRole(isAdm ? 'admin' : 'front_desk')
        }
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [router])
  // --- End access gate ---

  const [guestName, setGuestName] = useState('')
  const [zipcode, setZipcode] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [reason, setReason] = useState('')
  const [hotelName, setHotelName] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [placedBy, setPlacedBy] = useState('')
  const [evicted, setEvicted] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // Look up city/state from ZIP (US) using zippopotam.us
  async function lookupZip(z: string): Promise<ZipInfo | null> {
    try {
      if (!z || z.length < 5) return null
      const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(z)}`)
      if (!res.ok) return null
      const data = await res.json()
      const place = data?.places?.[0]
      if (!place) return null
      return { city: String(place['place name'] || ''), state: String(place['state abbreviation'] || '') }
    } catch { return null }
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      const info = await lookupZip(zipcode.trim())
      if (info) { setCity(info.city); setState(info.state) }
    }, 400)
    return () => clearTimeout(t)
  }, [zipcode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!guestName.trim()) { setErr('Guest name is required'); return }
    setErr(null); setMsg(null); setSubmitting(true)
    try {
      // 1) Create entry (without attachment)
      const { data: inserted, error } = await supabase
        .from('dnr_entries')
        .insert([{
          guest_name: guestName.trim(),
          zipcode: zipcode.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          reason: reason.trim() || null,
          hotel_name: hotelName.trim() || null,
          confirmation: confirmation.trim() || null,
          placed_by: placedBy.trim() || null,
          evicted,
          attachment_path: null,
        }])
        .select('id')
        .single()
      if (error) throw error

      const entryId = inserted!.id as string

      // 2) If file chosen, upload and patch row with path
      if (file) {
        const path = `${entryId}/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage
          .from('dnr-files')
          .upload(path, file, { upsert: false })
        if (upErr) throw upErr

        const { error: updErr } = await supabase
          .from('dnr_entries')
          .update({ attachment_path: path })
          .eq('id', entryId)
        if (updErr) throw updErr
      }

      setMsg('DNR entry created.')
      // optionally redirect:
      // window.location.href = '/dnr'
      setGuestName(''); setZipcode(''); setCity(''); setState('')
      setReason(''); setHotelName(''); setConfirmation(''); setPlacedBy('')
      setEvicted(false); setFile(null)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create DNR entry')
    } finally {
      setSubmitting(false)
    }
  }

  // Access gate render states
  if (authLoading) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <p>Loading…</p>
      </main>
    )
  }
  if (!role || !allowedRoles.includes(role)) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-2">New DNR</h1>
        <p className="text-gray-700">You don’t have access to create DNR entries.</p>
        <a href="/#" className="inline-block mt-3 rounded border bg-white px-3 py-2 text-sm">Home</a>
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">New DNR</h1>
        <a href="/dnr" className="rounded border px-3 py-2 text-sm">Back to DNR</a>
      </div>

      {err && <p className="text-red-600 mb-3">{err}</p>}
      {msg && <p className="text-green-700 mb-3">{msg}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col">
            <span className="text-sm mb-1">Guest name *</span>
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)}
                   className="border rounded p-2" placeholder="Full name" />
          </label>

          <label className="flex flex-col">
            <span className="text-sm mb-1">ZIP code</span>
            <input value={zipcode} onChange={(e) => setZipcode(e.target.value)}
                   className="border rounded p-2" placeholder="e.g. 94105" />
          </label>

          <label className="flex flex-col">
            <span className="text-sm mb-1">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)}
                   className="border rounded p-2" placeholder="Auto-filled" />
          </label>

          <label className="flex flex-col">
            <span className="text-sm mb-1">State</span>
            <input value={state} onChange={(e) => setState(e.target.value)}
                   className="border rounded p-2" placeholder="Auto-filled" />
          </label>

          <label className="flex flex-col md:col-span-2">
            <span className="text-sm mb-1">Reason / Notes</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="border rounded p-2 min-h-[120px]"
              placeholder='Please specify and attach a picture if needed.'
            />
          </label>

          <label className="flex flex-col">
            <span className="text-sm mb-1">Hotel name</span>
            <input value={hotelName} onChange={(e) => setHotelName(e.target.value)}
                   className="border rounded p-2" />
          </label>

          <label className="flex flex-col">
            <span className="text-sm mb-1">Confirmation #</span>
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
                   className="border rounded p-2" />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={evicted}
              onChange={(e) => setEvicted(e.target.checked)}
            />
            <span className="text-sm">Evicted</span>
          </label>

          <label className="flex flex-col">
            <span className="text-sm mb-1">Placed by (first name)</span>
            <input value={placedBy} onChange={(e) => setPlacedBy(e.target.value)}
                   className="border rounded p-2" placeholder="Your first name" />
          </label>

          <label className="flex flex-col md:col-span-2">
            <span className="text-sm mb-1">Attachment (optional)</span>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="text-xs text-gray-500 mt-1">Images or PDFs are fine.</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black text-white px-4 py-2 text-sm"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </form>
    </main>
  )
}
