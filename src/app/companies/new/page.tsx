'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

type Company = {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

type Role = 'front_desk' | 'manager' | 'admin'

const Schema = z.object({
  name: z.string().min(1, 'Company name required'),
  contact_name: z.string().optional(),
  contact_email: z.string().email('Invalid email').optional().or(z.literal('')),
  contact_phone: z.string().optional(),
})
type FormValues = z.infer<typeof Schema>

export default function NewCompanyPage() {
  const router = useRouter()

  // --- Access gate additions ---
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
      const uid = data.session.user.id
      try {
        // Prefer role from members.role
        const { data: m } = await supabase
          .from('members')
          .select('role')
          .eq('user_id', uid)
          .maybeSingle()

        const raw = String(m?.role ?? '').toLowerCase()
        let r: Role | null = null
        if (raw === 'admin') r = 'admin'
        else if (raw === 'manager') r = 'manager'
        else if (raw === 'front_desk') r = 'front_desk'
        else if (raw === 'staff') r = 'manager' // backward-compat with old "staff"
        else r = null

        if (!r) {
          const { data: isAdm } = await supabase.rpc('is_admin')
          r = isAdm ? 'admin' : 'front_desk'
        }
        if (!cancelled) setRole(r)
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [router])
  // --- End access gate ---

  const [orgId, setOrgId] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } =
    useForm<FormValues>({ resolver: zodResolver(Schema) })

  async function refreshCompanies() {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, contact_name, contact_email, contact_phone')
      .order('name')
    if (error) { setErr(error.message); setCompanies([]); return }
    setCompanies((data ?? []) as Company[])
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true); setErr(null); setMsg(null)
        const { data: s } = await supabase.auth.getSession()
        if (!s.session) { router.replace('/login'); return }
        const { data: m, error } = await supabase
          .from('members')
          .select('org_id')
          .eq('user_id', s.session.user.id)
          .maybeSingle()
        if (error || !m) throw error ?? new Error('No membership')
        if (!cancelled) setOrgId(m.org_id)
        await refreshCompanies()
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [router])

  const onSubmit = async (v: FormValues) => {
    if (!orgId) return
    setErr(null); setMsg(null)
    const row = {
      org_id: orgId,
      name: v.name.trim(),
      contact_name: (v.contact_name ?? '').trim() || null,
      contact_email: (v.contact_email ?? '').trim() || null,
      contact_phone: (v.contact_phone ?? '').trim() || null,
    }
    const { error } = await supabase.from('companies').insert([row])
    if (error) { setErr(error.message); return }
    setMsg(`Created company "${row.name}"`)
    reset()
    await refreshCompanies()
  }

  // NEW: delete a company
  async function deleteCompany(company: Company) {
    if (!confirm(`Delete company "${company.name}"?`)) return
    setErr(null); setMsg(null)
    const { error } = await supabase.from('companies').delete().eq('id', company.id)
    if (error) { setErr(error.message); return }
    setMsg(`Deleted company "${company.name}"`)
    await refreshCompanies()
  }

  // --- Access gate render states ---
  if (authLoading) return <main className="max-w-3xl mx-auto p-6">Loading…</main>
  if (!role || !allowedRoles.includes(role)) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-semibold">New Company</h1>
          <a href="/#" className="rounded border bg-white px-3 py-2 text-sm">Home</a>
        </div>
        <p className="text-gray-700">You don’t have access to view this page.</p>
      </main>
    )
  }
  // --- End access gate ---

  if (loading) return <main className="max-w-3xl mx-auto p-6">Loading…</main>

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New Company</h1>
        <button onClick={() => router.back()} className="underline text-sm">Back</button>
      </div>

      {err && <p className="text-red-600">{err}</p>}
      {msg && <p className="text-green-700">{msg}</p>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Company name</label>
          <input {...register('name')} className="border rounded p-2 w-full" />
        </div>

        {errors.name && <p className="text-red-600 text-sm">{errors.name.message}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Contact name</label>
            <input {...register('contact_name')} className="border rounded p-2 w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium">Contact email</label>
            <input type="email" {...register('contact_email')} className="border rounded p-2 w-full" />
            {errors.contact_email && <p className="text-red-600 text-sm">{errors.contact_email.message}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Contact phone</label>
          <input {...register('contact_phone')} className="border rounded p-2 w-full" />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
          >
            {isSubmitting ? 'Saving…' : 'Create company'}
          </button>
        </div>
      </form>

      {/* Existing companies */}
      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">Companies</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Contact</th>
                <th className="p-2 text-left">Email</th>
                <th className="p-2 text-left">Phone</th>
                <th className="p-2"></th>{/* actions */}
              </tr>
            </thead>
            <tbody>
              {companies.map(c => (
                <tr key={c.id} className="border-t">
                  <td className="p-2">{c.name}</td>
                  <td className="p-2">{c.contact_name ?? ''}</td>
                  <td className="p-2">{c.contact_email ?? ''}</td>
                  <td className="p-2">{c.contact_phone ?? ''}</td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => deleteCompany(c)}
                      className="text-red-600 underline text-xs"
                      title="Delete company"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-center text-gray-500">No companies yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
