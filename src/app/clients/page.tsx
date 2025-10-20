'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Company = { id: string; name: string }
type Client  = { id: string; name: string; case_worker_email: string | null }
type ClientCompany = { client_id: string; company_id: string }
type Role = 'front_desk' | 'manager' | 'admin'

export default function ClientsPage() {
  const router = useRouter()

  // --- Access gate (now resilient to missing RPCs) ---
  const [authLoading, setAuthLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const allowedRoles: Role[] = ['manager', 'admin']

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.replace('/login')
        return
      }

      try {
        // 1) Prefer role from JWT user_metadata (no RPC needed)
        const metaRole = String(data.session.user?.user_metadata?.role ?? '')
          .trim()
          .toLowerCase()

        if (metaRole === 'admin' || metaRole === 'manager' || metaRole === 'front_desk') {
          if (!cancelled) setRole(metaRole as Role)
          return
        }

        // 2) Optional: allow if is_admin() RPC works and returns true
        try {
          const { data: isAdm } = await supabase.rpc('is_admin')
          if (isAdm === true) {
            if (!cancelled) setRole('admin')
            return
          }
        } catch { /* ignore if RPC missing */ }

        // 3) Optional: try get_my_role() RPC if present
        try {
          const { data: r } = await supabase.rpc('get_my_role')
          const raw = String(r ?? '').trim().toLowerCase()
          if (raw === 'admin' || raw === 'manager' || raw === 'front_desk') {
            if (!cancelled) setRole(raw as Role)
            return
          }
        } catch { /* ignore if RPC missing */ }

        // 4) Fallback: no role info found
        if (!cancelled) setRole(null)
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [router])
  // --- End access gate ---

  const [orgId, setOrgId] = useState<string | null>(null)

  const [companies, setCompanies] = useState<Company[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [links,     setLinks]     = useState<ClientCompany[]>([])

  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState<string | null>(null)
  const [msg, setMsg]         = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)

  // new client form
  const [newName,  setNewName]  = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [pickCompanyIds, setPickCompanyIds] = useState<string[]>([])

  const [q, setQ] = useState('')

  // ---- helpers ----
  async function refreshAll() {
    const [cRes, clRes, lkRes] = await Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('clients').select('id, name, case_worker_email').order('name'),
      supabase.from('client_companies').select('client_id, company_id'),
    ])
    if (cRes.error) throw cRes.error
    if (clRes.error) throw clRes.error
    if (lkRes.error) throw lkRes.error
    setCompanies((cRes.data ?? []) as Company[])
    setClients((clRes.data ?? []) as Client[])
    setLinks((lkRes.data ?? []) as ClientCompany[])
  }

  // Load org + picklists
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true); setErr(null); setMsg(null)

        const { data: s } = await supabase.auth.getSession()
        if (!s.session) { setErr('Not signed in'); return }
        const { data: m, error: mErr } = await supabase
          .from('members')
          .select('org_id')
          .eq('user_id', s.session.user.id)
          .maybeSingle()
        if (mErr || !m) throw mErr ?? new Error('No membership')
        if (!cancelled) setOrgId(m.org_id)

        if (!cancelled) await refreshAll()
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const filteredClients = useMemo(() => {
    if (!q.trim()) return clients
    const t = q.toLowerCase()
    return clients.filter(c =>
      c.name.toLowerCase().includes(t) || (c.case_worker_email ?? '').toLowerCase().includes(t)
    )
  }, [clients, q])

  const togglePickCompany = (id: string) => {
    setPickCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function addClient() {
    if (!orgId) return
    setErr(null); setMsg(null)
    const name = newName.trim()
    if (!name) { setErr('Client name required'); return }

    // 1) Insert client
    const { data: inserted, error } = await supabase
      .from('clients')
      .insert([{ org_id: orgId, name, case_worker_email: newEmail.trim() || null }])
      .select('id')
      .single()
    if (error || !inserted) { setErr(error?.message ?? 'Insert failed'); return }

    // 2) Link to companies (if selected)
    if (pickCompanyIds.length) {
      const rows = pickCompanyIds.map(cid => ({ client_id: inserted.id, company_id: cid }))
      const { error: lErr } = await supabase.from('client_companies').insert(rows)
      if (lErr) { setErr(lErr.message); return }
    }

    try {
      await refreshAll()
    } catch (e: any) {
      setErr(e?.message ?? 'Refresh failed')
    }

    setMsg(`Added client "${name}"`)
    setNewName(''); setNewEmail(''); setPickCompanyIds([])
  }

  async function deleteClient(id: string, nameForMsg: string) {
    if (!confirm(`Delete client "${nameForMsg}"? This will remove their company links.`)) return
    setErr(null); setMsg(null)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setClients(prev => prev.filter(c => c.id !== id))
    setLinks(prev => prev.filter(l => l.client_id !== id))
    setMsg(`Deleted client "${nameForMsg}"`)
  }

  async function toggleLink(clientId: string, companyId: string) {
    const exists = links.some(l => l.client_id === clientId && l.company_id === companyId)
    setErr(null); setMsg(null)
    if (exists) {
      const { error } = await supabase
        .from('client_companies')
        .delete()
        .eq('client_id', clientId)
        .eq('company_id', companyId)
      if (error) { setErr(error.message); return }
      setLinks(prev => prev.filter(l => !(l.client_id === clientId && l.company_id === companyId)))
    } else {
      const { error } = await supabase
        .from('client_companies')
        .insert([{ client_id: clientId, company_id: companyId }])
      if (error) { setErr(error.message); return }
      setLinks(prev => [...prev, { client_id: clientId, company_id: companyId }])
    }
  }

  async function saveChanges() {
    try {
      setSaving(true)
      await refreshAll()
      setMsg('Changes saved.')
      setErr(null)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  // --- Access gate render states ---
  if (authLoading) {
    return <main className="max-w-5xl mx-auto p-6">Loading…</main>
  }
  if (!role || !allowedRoles.includes(role)) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Clients</h1>
          <a href="/#" className="rounded border bg-white px-3 py-2 text-sm">Home</a>
        </div>
        <p className="text-gray-700">You don’t have access to view this page.</p>
      </main>
    )
  }
  // --- End access gate ---

  if (loading) return <main className="max-w-5xl mx-auto p-6">Loading…</main>

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Link href="/invoices" className="rounded border bg-white px-3 py-2 text-sm">
          Back to Invoices
        </Link>
      </div>

      {err && <p className="text-red-600">{err}</p>}
      {msg && <p className="text-green-700">{msg}</p>}

      {/* Create new client */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-3">Add client</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Client name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="border rounded p-2 w-full" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">Case worker email (optional)</label>
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="border rounded p-2 w-full" />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-sm font-medium">Companies (select any)</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {companies.map(c => (
              <label key={c.id} className="inline-flex items-center gap-2 border rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={pickCompanyIds.includes(c.id)}
                  onChange={() => togglePickCompany(c.id)}
                />
                <span className="text-sm">{c.name}</span>
              </label>
            ))}
            {companies.length === 0 && <span className="text-sm text-gray-500">(no companies yet)</span>}
          </div>
        </div>

        <div className="mt-4">
          <button onClick={addClient} className="rounded bg-black text-white px-3 py-2 text-sm">
            Save client
          </button>
        </div>
      </section>

      {/* List + manage */}
      <section className="border rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Client list</h2>
          <input
            placeholder="Search name or case worker…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded p-2 text-sm w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Case worker email</th>
                <th className="p-2 text-left">Companies</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map(c => {
                const assigned = new Set(links.filter(l => l.client_id === c.id).map(l => l.company_id))
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">{c.name}</td>
                    <td className="p-2">{c.case_worker_email ?? ''}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        {companies.map(co => (
                          <label key={co.id} className="inline-flex items-center gap-1 text-xs border rounded px-2 py-1">
                            <input
                              type="checkbox"
                              checked={assigned.has(co.id)}
                              onChange={() => toggleLink(c.id, co.id)}
                            />
                            <span>{co.name}</span>
                          </label>
                        ))}
                        {companies.length === 0 && <span className="text-xs text-gray-500">(no companies)</span>}
                      </div>
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => deleteClient(c.id, c.name)}
                        className="text-red-600 underline text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}

              {filteredClients.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-gray-500">No clients.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Peace-of-mind Save button */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={saveChanges}
            disabled={saving}
            className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>
    </main>
  )
}
