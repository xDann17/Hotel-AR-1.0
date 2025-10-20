'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Role = 'front_desk' | 'manager' | 'admin'

type DnrRow = {
  id: string
  created_at: string
  guest_name: string
  zipcode: string | null
  city: string | null
  state: string | null
  reason: string | null
  hotel_name: string | null
  confirmation: string | null
  placed_by: string | null
  evicted: boolean | null
  attachment_path: string | null
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString()
  } catch { return d }
}

function within24h(iso: string) {
  const created = new Date(iso).getTime()
  const now = Date.now()
  return now - created < 24 * 60 * 60 * 1000
}

export default function DnrPage() {
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
        // Prefer the role stored in members
        const { data: m, error: mErr } = await supabase
          .from('members')
          .select('role')
          .eq('user_id', uid)
          .single()

        if (!mErr && m?.role) {
          const r = String(m.role).toLowerCase() as Role
          if (!cancelled) setRole((['front_desk','manager','admin'] as const).includes(r) ? r : null)
        } else {
          // Fallback: treat is_admin as 'admin', else 'front_desk'
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

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<DnrRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  async function fetchRows() {
    setLoading(true); setErr(null); setMsg(null)
    try {
      let q = supabase
        .from('dnr_entries')
        .select('*')
        .order('created_at', { ascending: false })

      if (search) {
        q = q.ilike('guest_name', `%${search}%`)
      } else {
        q = q.limit(15)
      }

      const { data, error } = await q
      if (error) throw error
      setRows((data ?? []) as DnrRow[])
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load DNR entries')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [search])

  async function openAttachment(path: string | null) {
    setDownloadUrl(null)
    if (!path) return
    const { data, error } = await supabase.storage
      .from('dnr-files')
      .createSignedUrl(path, 60 * 10) // 10 minutes
    if (!error && data?.signedUrl) setDownloadUrl(data.signedUrl)
  }

  async function deleteEntry(row: DnrRow) {
    setErr(null); setMsg(null)

    // block in UI if older than 24h (server-side RLS should enforce too)
    if (!within24h(row.created_at)) {
      setErr('This entry can no longer be deleted (older than 24 hours).')
      return
    }

    const ok = confirm(
      `Delete DNR entry for "${row.guest_name}"?\nThis cannot be undone.`
    )
    if (!ok) return

    try {
      // Try removing the attachment first (if any). If it fails, we still try to delete the row.
      if (row.attachment_path) {
        await supabase.storage.from('dnr-files').remove([row.attachment_path])
      }

      const { error } = await supabase
        .from('dnr_entries')
        .delete()
        .eq('id', row.id)

      if (error) throw error

      setMsg('DNR entry deleted.')
      // refresh
      await fetchRows()
    } catch (e: any) {
      // If RLS blocks because it's older than 24h you'll see an error here
      setErr(e?.message ?? 'Failed to delete entry')
    }
  }

  // Access gate rendering
  if (authLoading) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <p>Loading…</p>
      </main>
    )
  }
  if (!role || !allowedRoles.includes(role)) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-2">DNR</h1>
        <p className="text-gray-700">You don’t have access to this page.</p>
        <a href="/#" className="inline-block mt-3 rounded border bg-white px-3 py-2 text-sm">Home</a>
      </main>
    )
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">DNR</h1>
        <div className="flex items-center gap-2">
          {/* NEW: Back to Dashboard */}
          <a
            href="/#"
            className="rounded border bg-white px-3 py-2 text-sm"
          >
            Home
          </a>
          <a
            href="/dnr/new"
            className="rounded bg-black text-white px-3 py-2 text-sm"
          >
            + New DNR
          </a>
        </div>
      </div>

      {err && <p className="text-red-600 mb-2">{err}</p>}
      {msg && <p className="text-green-700 mb-2">{msg}</p>}

      <input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search guest name…"
        className="border rounded p-2 w-full mb-4"
      />

      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Guest name</th>
              <th className="p-2 text-left">Evicted</th>
              <th className="p-2 text-left">Date placed</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="p-4">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-gray-500">No entries.</td></tr>
            )}

            {rows.map((r) => {
              const open = openId === r.id
              const canDelete = within24h(r.created_at)
              return (
                <>
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.guest_name}</td>
                    <td className="p-2">{r.evicted ? 'Yes' : 'No'}</td>
                    <td className="p-2">{fmtDate(r.created_at)}</td>
                    <td className="p-2 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          className="px-2 py-1 rounded border"
                          onClick={async () => {
                            const next = open ? null : r.id
                            setOpenId(next)
                            if (next && r.attachment_path) {
                              await openAttachment(r.attachment_path)
                            }
                          }}
                        >
                          {open ? 'Hide' : 'View'}
                        </button>

                        <button
                          className={`px-2 py-1 rounded border ${canDelete ? '' : 'opacity-50 cursor-not-allowed'}`}
                          onClick={() => canDelete ? deleteEntry(r) : null}
                          title={canDelete ? 'Delete (available for 24 hours)' : 'Delete disabled after 24 hours'}
                          disabled={!canDelete}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>

                  {open && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={4} className="p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div><b>Guest:</b> {r.guest_name}</div>
                            <div><b>Evicted:</b> {r.evicted ? 'Yes' : 'No'}</div>
                            <div><b>Placed on:</b> {fmtDate(r.created_at)}</div>
                            <div><b>Hotel:</b> {r.hotel_name ?? ''}</div>
                            <div><b>Confirmation #:</b> {r.confirmation ?? ''}</div>
                            <div><b>ZIP:</b> {r.zipcode ?? ''}</div>
                            <div><b>City/State:</b> {(r.city ?? '') + (r.state ? `, ${r.state}` : '')}</div>
                            <div><b>Placed by:</b> {r.placed_by ?? ''}</div>
                          </div>
                          <div>
                            <div className="mb-2"><b>Reason / Notes</b></div>
                            <div className="whitespace-pre-wrap text-gray-700">{r.reason ?? ''}</div>
                            {r.attachment_path && (
                              <div className="mt-3">
                                <a
                                  className="inline-block rounded border px-3 py-2 text-sm"
                                  href={downloadUrl ?? '#'}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={async (e) => {
                                    e.preventDefault()
                                    await openAttachment(r.attachment_path)
                                    if (downloadUrl) window.open(downloadUrl, '_blank')
                                  }}
                                >
                                  Download attachment
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}
