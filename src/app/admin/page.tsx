'use client'

// app/admin/page.tsx

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ⬇️ UPDATED: support three roles
type Role = 'front_desk' | 'manager' | 'admin'

type Member = { user_id: string; org_id: string; role: Role }
type UserLite = { id: string; email: string | null }
type Hotel = { id: string; name: string }
type MemberHotel = { user_id: string; hotel_id: string; role: Role }

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Add member (by email)
  const [addEmail, setAddEmail] = useState('')
  // ⬇️ DEFAULT to front_desk (was 'staff')
  const [addRole, setAddRole] = useState<Role>('front_desk')

  // All users filter
  const [userQuery, setUserQuery] = useState('')

  // Hotels
  const [hotelName, setHotelName] = useState('')
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [memberHotels, setMemberHotels] = useState<MemberHotel[]>([])
  const [loadingHotels, setLoadingHotels] = useState(true)
  const [hotelsErr, setHotelsErr] = useState<string | null>(null)

  // ---------- Helpers ----------

  function hasAccess(userId: string, hotelId: string) {
    return memberHotels.some(mh => mh.user_id === userId && mh.hotel_id === hotelId)
  }

  async function toggleAccess(userId: string, hotelId: string) {
    setErr(null); setMsg(null)
    const exists = hasAccess(userId, hotelId)
    if (exists) {
      const { error } = await supabase
        .from('member_hotels')
        .delete()
        .eq('user_id', userId)
        .eq('hotel_id', hotelId)
      if (error) { setErr(error.message); return }
      setMemberHotels(mh => mh.filter(x => !(x.user_id === userId && x.hotel_id === hotelId)))
    } else {
      const { error } = await supabase
        .from('member_hotels')
        // ⬇️ store role for hotel access as non-admin role; using 'front_desk' by default
        .insert([{ user_id: userId, hotel_id: hotelId, role: 'front_desk' }])
      if (error) { setErr(error.message); return }
      setMemberHotels(mh => [...mh, { user_id: userId, hotel_id: hotelId, role: 'front_desk' }])
    }
  }

  async function loadMembers() {
    const { data, error } = await supabase
      .from('members')
      .select('user_id, org_id, role')
    if (error) throw error
    setMembers((data ?? []) as Member[])
  }

  async function loadHotelsAndAccess() {
    setLoadingHotels(true)
    setHotelsErr(null)
    try {
      // Only show active hotels (if you ever add soft delete back, this keeps them hidden)
      const { data: hs, error: hErr } = await supabase
        .from('hotels')
        .select('id, name')
        .is('deleted_at', null)
        .order('name', { ascending: true })
      if (hErr) throw hErr
      setHotels((hs ?? []) as Hotel[])

      const { data: mh, error: mhErr } = await supabase
        .from('member_hotels')
        .select('user_id, hotel_id, role')
      if (mhErr) throw mhErr
      setMemberHotels((mh ?? []) as MemberHotel[])
    } catch (e: any) {
      setHotelsErr(e?.message ?? 'Failed to load hotels')
      setHotels([])
      setMemberHotels([])
    } finally {
      setLoadingHotels(false)
    }
  }

  /**
   * HARD DELETE via RPC (api_hard_delete_hotel)
   * - Confirms with the user
   * - Calls RPC that permanently deletes the hotel and its related data
   * - Refreshes lists
   */
  async function deleteHotel(hotelId: string, hotelName: string) {
    setErr(null); setMsg(null);

    const ok = window.confirm(
      `Permanently delete "${hotelName}"?\n\n` +
      'This will remove the hotel, its invoices, allocations, access, and (optionally) orphan payments. This cannot be undone.'
    );
    if (!ok) return;

    const { error } = await supabase.rpc('api_hard_delete_hotel', { p_hotel_id: hotelId })
    if (error) {
      setErr(`Delete failed: ${error.message}`)
      await loadHotelsAndAccess()
      return
    }

    setMsg(`Deleted hotel "${hotelName}"`)
    await loadHotelsAndAccess()
  }

  // ---------- Initial load ----------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setErr(null); setMsg(null); setLoading(true)

        // 1) check admin
        const { data: isAdm, error: adminErr } = await supabase.rpc('is_admin')
        if (adminErr) throw adminErr
        if (cancelled) return

        setIsAdmin(Boolean(isAdm))
        if (!isAdm) { setLoading(false); return }

        // 2) members
        await loadMembers()
        if (cancelled) return

        // 3) hotels & access
        await loadHotelsAndAccess()
        if (cancelled) return

        // 4) Auth users (non-blocking)
        try {
          const res = await fetch('/api/admin/users', { cache: 'no-store' })
          let json: any = null
          try { json = await res.json() } catch { json = null }
          if (!res.ok) throw new Error(json?.error || `Failed to load users (HTTP ${res.status})`)
          if (!cancelled) setUsers((json.users ?? []) as UserLite[])
        } catch (usersErr: any) {
          setErr(prev => prev ?? (usersErr?.message ?? 'Failed to load users'))
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Unexpected error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const mMap = useMemo(() => {
    const map = new Map<string, { role: Role }>()
    for (const x of members) map.set(x.user_id, { role: x.role })
    return map
  }, [members])

  function emailFor(userId: string) {
    return users.find(u => u.id === userId)?.email ?? '(no email)'
  }
  function isMember(userId: string) {
    return mMap.has(userId)
  }
  function memberRole(userId: string) {
    return mMap.get(userId)?.role
  }

  async function addMemberFromList(userEmail: string, role: Role) {
    setErr(null); setMsg(null)
    if (!userEmail) { setErr('Email is required'); return }
    // ⬇️ Your RPC must accept 'front_desk' | 'manager' | 'admin'
    const { error } = await supabase.rpc('add_member_by_email', { p_email: userEmail, p_role: role })
    if (error) { setErr(error.message); return }
    setMsg(`Added ${userEmail} as ${role}`)
    try { await loadMembers() } catch (e: any) { setErr(e?.message ?? 'Failed to refresh members') }
  }

  async function setRole(userId: string, role: Role) {
    setErr(null); setMsg(null)
    // ⬇️ Your RPC must accept 'front_desk' | 'manager' | 'admin'
    const { error } = await supabase.rpc('set_member_role', { p_user_id: userId, p_role: role })
    if (error) { setErr(error.message); return }
    setMembers(ms => ms.map(m => (m.user_id === userId ? { ...m, role } : m)))
    setMsg('Role updated')
  }

  async function invite() {
    setErr(null); setMsg(null)
    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: window.location.origin }),
    })
    let json: any = null
    try { json = await res.json() } catch { json = null }
    if (!res.ok) { setErr(json?.error ?? `Invite failed (HTTP ${res.status})`); return }
    setMsg(`Invite sent to ${email}`); setEmail('')
  }

  async function createHotel() {
    setErr(null); setMsg(null)
    if (!hotelName.trim()) { setErr('Hotel name required'); return }
    const { error } = await supabase.rpc('create_hotel', { p_name: hotelName.trim() })
    if (error) { setErr(error.message); return }
    setMsg(`Created hotel "${hotelName.trim()}"`); setHotelName('')
    await loadHotelsAndAccess()
  }

  async function addMember() {
    setErr(null); setMsg(null)
    // ⬇️ Your RPC must accept the new roles
    const { error } = await supabase.rpc('add_member_by_email', { p_email: addEmail, p_role: addRole })
    if (error) { setErr(error.message); return }
    setMsg(`Added ${addEmail} as ${addRole}`); setAddEmail('')
    try { await loadMembers() } catch (e: any) { setErr(e?.message ?? 'Failed to refresh members') }
  }

  // ---------- Render ----------

  if (loading) {
    return (
      <main className="max-w-xl mx-auto p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <a href="/#" className="rounded border bg-white px-3 py-2 text-sm">Home</a>
        </div>
        <p className="mt-2">Loading…</p>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <main className="max-w-xl mx-auto p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <a href="/#" className="rounded border bg-white px-3 py-2 text-sm">Home</a>
        </div>
        <p className="mt-2">You must be an admin to view this page.</p>
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <a href="/#" className="rounded border bg-white px-3 py-2 text-sm">Home</a>
      </div>
      {err && <p className="text-red-600">{err}</p>}
      {msg && <p className="text-green-700">{msg}</p>}

      {/* Create hotel */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">Create hotel</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={hotelName}
            onChange={(e) => setHotelName(e.target.value)}
            placeholder="Hotel name"
            className="border rounded p-2 flex-1 min-w-[220px]"
          />
          <button onClick={createHotel} className="rounded bg-black text-white px-3 py-2 text-sm">
            Create
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Admins only. Creates a property (hotel) within your org.
        </p>
      </section>

      {/* Assign hotels to members */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">Assign hotels to members</h2>

        {loadingHotels ? (
          <p className="text-gray-500 text-sm">Loading hotels…</p>
        ) : hotelsErr ? (
          <p className="text-red-600 text-sm">{hotelsErr}</p>
        ) : members.length === 0 ? (
          <p className="text-gray-500 text-sm">No members yet.</p>
        ) : hotels.length === 0 ? (
          <p className="text-gray-500 text-sm">No hotels yet. Create one above.</p>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {members.map(m => (
                <div key={m.user_id} className="border rounded-xl bg-white p-3">
                  <div className="font-medium">{emailFor(m.user_id)}</div>
                  <div className="text-xs text-gray-500 mb-2">Role: {m.role}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {hotels.map(h => {
                      const checked = hasAccess(m.user_id, h.id)
                      return (
                        <label key={h.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2">
                          <div className="text-sm">
                            <div className="font-medium">{h.name}</div>
                            <div className="text-[10px] text-gray-500">{h.id}</div>
                            <button
                              onClick={(e) => { e.preventDefault(); deleteHotel(h.id, h.name) }}
                              className="text-red-600 underline text-xs"
                              title={`Delete ${h.name}`}
                            >
                              Delete
                            </button>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAccess(m.user_id, h.id)}
                          />
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table (original) */}
            <div className="overflow-x-auto hidden md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">Member</th>
                    {hotels.map(h => (
                      <th key={h.id} className="p-2 text-left whitespace-nowrap">
                        <div className="flex items-start gap-2 flex-col">
                          <span>{h.name}</span>
                          <span className="text-[10px] text-gray-500">{h.id}</span>
                          <button
                            onClick={() => deleteHotel(h.id, h.name)}
                            className="text-red-600 underline text-xs"
                            title={`Delete ${h.name}`}
                          >
                            Delete
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.user_id} className="border-t">
                      <td className="p-2">
                        {emailFor(m.user_id)}{' '}
                        <span className="text-gray-500">({m.role})</span>
                      </td>
                      {hotels.map(h => (
                        <td key={h.id} className="p-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={hasAccess(m.user_id, h.id)}
                              onChange={() => toggleAccess(m.user_id, h.id)}
                            />
                            <span className="text-xs text-gray-600">access</span>
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Invite */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">Invite user</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
            className="border rounded p-2 flex-1 min-w-[220px]"
          />
          <button onClick={invite} className="rounded bg-black text-white px-3 py-2 text-sm">
            Send invite
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2">Sends a magic-link via Supabase Auth.</p>
      </section>

      {/* Add member (by email) */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">Add member (by email)</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="user@company.com"
            className="border rounded p-2 flex-1 min-w-[220px]"
          />
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as Role)}
            className="border rounded p-2"
          >
            {/* ⬇️ new roles */}
            <option value="front_desk">front desk</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <button onClick={addMember} className="rounded bg-black text-white px-3 py-2 text-sm">
            Add to org
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          The email must exist in Supabase Auth (invite accepted). Upserts the membership and role.
        </p>
      </section>

      {/* Members */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">Members</h2>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {members.map(m => (
            <div key={m.user_id} className="border rounded-xl bg-white p-3">
              <div className="font-medium">{emailFor(m.user_id)}</div>
              <div className="text-xs text-gray-500">User ID: {m.user_id}</div>
              <div className="mt-1 text-sm">Role: <span className="font-medium">{m.role}</span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {/* ⬇️ new role actions */}
                <button onClick={() => setRole(m.user_id, 'admin')} className="underline text-xs">
                  Make admin
                </button>
                <button onClick={() => setRole(m.user_id, 'manager')} className="underline text-xs">
                  Make manager
                </button>
                <button onClick={() => setRole(m.user_id, 'front_desk')} className="underline text-xs">
                  Make front desk
                </button>
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <div className="border rounded-xl bg-white p-3 text-center text-gray-500">No members yet.</div>
          )}
        </div>

        {/* Desktop table (original) */}
        <table className="min-w-full text-sm hidden md:table">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">User ID</th>
              <th className="p-2 text-left">Role</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.user_id} className="border-t">
                <td className="p-2">{emailFor(m.user_id)}</td>
                <td className="p-2">{m.user_id}</td>
                <td className="p-2">{m.role}</td>
                <td className="p-2">
                  <div className="flex gap-2">
                    {/* ⬇️ new role actions */}
                    <button onClick={() => setRole(m.user_id, 'admin')} className="underline text-xs">
                      Make admin
                    </button>
                    <button onClick={() => setRole(m.user_id, 'manager')} className="underline text-xs">
                      Make manager
                    </button>
                    <button onClick={() => setRole(m.user_id, 'front_desk')} className="underline text-xs">
                      Make front desk
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-center text-gray-500">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* All users (Supabase Auth) */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">All users (Supabase Auth)</h2>

        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="Search email…"
            className="border rounded p-2 text-sm w-full sm:w-80"
          />
          <span className="text-xs text-gray-500 self-center">
            Showing users from Auth; add to org if not a member.
          </span>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {users
            .filter(u =>
              !userQuery ? true : (u.email ?? '').toLowerCase().includes(userQuery.toLowerCase())
            )
            .map(u => {
              const member = isMember(u.id)
              const role = memberRole(u.id)
              return (
                <div key={u.id} className="border rounded-xl bg-white p-3">
                  <div className="font-medium">{u.email ?? '(no email)'}</div>
                  <div className="text-xs text-gray-500 break-all">User ID: {u.id}</div>
                  <div className="mt-1 text-sm">
                    Membership:{' '}
                    {member ? (
                      <span className="text-green-700">member ({role})</span>
                    ) : (
                      <span className="text-gray-500">not a member</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {member ? (
                      <>
                        {/* ⬇️ switch role actions */}
                        <button onClick={() => setRole(u.id, 'admin')} className="underline text-xs">
                          Make admin
                        </button>
                        <button onClick={() => setRole(u.id, 'manager')} className="underline text-xs">
                          Make manager
                        </button>
                        <button onClick={() => setRole(u.id, 'front_desk')} className="underline text-xs">
                          Make front desk
                        </button>
                      </>
                    ) : (
                      <>
                        {/* ⬇️ add with specific role */}
                        <button
                          onClick={() => addMemberFromList(u.email ?? '', 'front_desk')}
                          className="underline text-xs"
                          disabled={!u.email}
                          title={!u.email ? 'No email available' : ''}
                        >
                          Add as front desk
                        </button>
                        <button
                          onClick={() => addMemberFromList(u.email ?? '', 'manager')}
                          className="underline text-xs"
                          disabled={!u.email}
                          title={!u.email ? 'No email available' : ''}
                        >
                          Add as manager
                        </button>
                        <button
                          onClick={() => addMemberFromList(u.email ?? '', 'admin')}
                          className="underline text-xs"
                          disabled={!u.email}
                          title={!u.email ? 'No email available' : ''}
                        >
                          Add as admin
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          {users.length === 0 && (
            <div className="border rounded-xl bg-white p-3 text-center text-gray-500">
              No users found.
            </div>
          )}
        </div>

        {/* Desktop table (original) */}
        <table className="min-w-full text-sm hidden md:table">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">User ID</th>
              <th className="p-2 text-left">Membership</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users
              .filter(u =>
                !userQuery ? true : (u.email ?? '').toLowerCase().includes(userQuery.toLowerCase())
              )
              .map(u => {
                const member = isMember(u.id)
                const role = memberRole(u.id)
                return (
                  <tr key={u.id} className="border-t">
                    <td className="p-2">{u.email ?? '(no email)'}</td>
                    <td className="p-2">{u.id}</td>
                    <td className="p-2">
                      {member ? (
                        <span className="text-green-700">member ({role})</span>
                      ) : (
                        <span className="text-gray-500">not a member</span>
                      )}
                    </td>
                    <td className="p-2">
                      {member ? (
                        <div className="flex gap-2">
                          {/* ⬇️ switch role actions */}
                          <button onClick={() => setRole(u.id, 'admin')} className="underline text-xs">
                            Make admin
                          </button>
                          <button onClick={() => setRole(u.id, 'manager')} className="underline text-xs">
                            Make manager
                          </button>
                          <button onClick={() => setRole(u.id, 'front_desk')} className="underline text-xs">
                            Make front desk
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          {/* ⬇️ add with specific role */}
                          <button
                            onClick={() => addMemberFromList(u.email ?? '', 'front_desk')}
                            className="underline text-xs"
                            disabled={!u.email}
                            title={!u.email ? 'No email available' : ''}
                          >
                            Add as front desk
                          </button>
                          <button
                            onClick={() => addMemberFromList(u.email ?? '', 'manager')}
                            className="underline text-xs"
                            disabled={!u.email}
                            title={!u.email ? 'No email available' : ''}
                          >
                            Add as manager
                          </button>
                          <button
                            onClick={() => addMemberFromList(u.email ?? '', 'admin')}
                            className="underline text-xs"
                            disabled={!u.email}
                            title={!u.email ? 'No email available' : ''}
                          >
                            Add as admin
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
