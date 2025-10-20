'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Role = 'front_desk' | 'manager' | 'admin' // for gating

type Hotel = { id: string; name: string }
type Vendor = { id: string; name: string }
type Category = { id: string; name: string }

function todayYMD() {
  return new Date().toISOString().slice(0, 10)
}

export default function NewExpensePage() {
  const router = useRouter()

  // --- Access gate (manager/admin only) ---
  const [authLoading, setAuthLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const allowed: Role[] = ['manager', 'admin']

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
        // Try explicit members.role first
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
        else if (raw === 'staff') r = 'manager' // backward-compat: old "staff" == manager
        else r = null

        // Fallback to old is_admin() if needed
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

  // lookups / access
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])
  const [accessLoaded, setAccessLoaded] = useState(false)

  // form
  const [hotelId, setHotelId] = useState<string>('')
  const [expenseDate, setExpenseDate] = useState<string>(todayYMD())
  const [vendorId, setVendorId] = useState<string>('')             // select-only
  const [categoryId, setCategoryId] = useState<string>('')         // existing
  const [newCategory, setNewCategory] = useState<string>('')       // “or type new”
  const [amount, setAmount] = useState<string>('')
  const [method, setMethod] = useState<'check'|'ach'|'card'|'other'>('check')
  const [reference, setReference] = useState<string>('')           // check # or last4
  const [notes, setNotes] = useState<string>('')

  const [files, setFiles] = useState<FileList | null>(null)

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        const [{ data: hs }, { data: vs }, { data: cs }] = await Promise.all([
          supabase.from('hotels').select('id,name').order('name'),
          supabase.from('vendors').select('id,name').order('name'),
          supabase.from('expense_categories').select('id,name').order('name'),
        ])
        setHotels((hs ?? []) as Hotel[])
        setVendors((vs ?? []) as Vendor[])
        setCategories((cs ?? []) as Category[])

        try {
          const res = await fetch('/api/me/hotels', { cache: 'no-store' })
          if (res.ok) {
            const json = await res.json()
            const ids = Array.isArray(json.hotelIds) ? (json.hotelIds as string[]) : []
            setMyHotelIds(ids)
            if (ids.length) setHotelId(ids[0])
          } else {
            const json = await res.json().catch(() => null)
            throw new Error(json?.error || 'Failed to load member access')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to load member access'
          setErr(message)
        } finally {
          setAccessLoaded(true)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load lookups'
        setErr(message)
        setAccessLoaded(true)
      }
    })()
  }, [])

  async function ensureCategory(): Promise<string | null> {
    if (categoryId) return categoryId
    const name = newCategory.trim()
    if (!name) return null

    const code = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'cat'


    const { data, error } = await supabase
      .from('expense_categories')
      .insert({ name, code })
      .select('id')
      .single()


    if (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505') {
          // unique violation; try to fetch existing by name
          const { data: existing } = await supabase
            .from('expense_categories')
            .select('id')
            .ilike('name', name)
            .maybeSingle()
          if (existing?.id) return existing.id as string
        }
        throw error
    }
    return data!.id as string
  }

  function referenceLabel() {
    if (method === 'card') return 'Card last 4 digits'
    if (method === 'check') return 'Check #'
    return 'Reference'
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setMsg(null)

    try {
      if (!hotelId) { setErr('Select a hotel'); return }
      if (!myHotelIds.includes(hotelId)) { setErr('You do not have access to this hotel'); return }
      if (!vendorId) { setErr('Select a vendor'); return }

      const amt = Number(amount)
      if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter a valid amount > 0'); return }

      // conditional reference rules
      if (method === 'card') {
        const l4 = reference.trim()
        if (!/^\d{4}$/.test(l4)) { setErr('Enter 4 digits for card last 4'); return }
      }
      if (method === 'check') {
        if (!reference.trim()) { setErr('Enter the check #'); return }
      }

      setSaving(true)

      const cId = await ensureCategory()

      // insert expense
      const res = await fetch('/api/expenses/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotel_id: hotelId,
          expense_date: expenseDate,
          vendor_id: vendorId,
          category_id: cId,
          amount: amt,
          method,
          reference: reference || null,
          notes: notes || null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to create expense')
      }

      const expenseId: string = json.id

      // upload files (optional)
      if (files && files.length) {
        for (const file of Array.from(files)) {
          const key = `hotel/${hotelId}/expenses/${expenseId}/${file.name}`
          const { error: upErr } = await supabase.storage.from('expense-files').upload(key, file, {
            upsert: false,
          })
          if (upErr) throw upErr
          await supabase.from('expense_files').insert({ expense_id: expenseId, storage_key: key })
        }
      }

      setMsg('Expense created')
      router.push('/expenses')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create expense'
      setErr(message)
    } finally {
      setSaving(false)
    }
  }

  // --- Access gate rendering (kept separate from your main UI) ---
  if (authLoading) return <main className="max-w-3xl mx-auto p-6">Loading…</main>
  if (!role || !allowed.includes(role)) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">New Expense</h1>
        <p className="text-gray-700">You don’t have access to create expenses.</p>
      </main>
    )
  }
  if (!accessLoaded) {
    return <main className="max-w-3xl mx-auto p-6">Loading…</main>
  }
  // --- End access gate ---

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">New Expense</h1>

      <div className="mb-4 flex gap-2">
        <Link href="/#" className="rounded bg-white border px-3 py-2 text-sm">Home</Link>
        <Link href="/expenses" className="rounded bg-white border px-3 py-2 text-sm">Back to Expenses</Link>
      </div>

      {err && <p className="text-red-600 mb-3">{err}</p>}
      {msg && <p className="text-green-700 mb-3">{msg}</p>}

      {/* Form container */}
      <form onSubmit={onSubmit} className="space-y-4 bg-white border rounded p-4">
        {/* Row 1 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Hotel</span>
            <select value={hotelId} onChange={e => setHotelId(e.target.value)} className="border rounded p-2">
              <option value="">Select…</option>
              {hotels.map(h => (
                <option key={h.id} value={h.id} disabled={!myHotelIds.includes(h.id)}>
                  {h.name}{!myHotelIds.includes(h.id) ? ' (no access)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Date</span>
            <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="border rounded p-2" />
          </label>
        </div>

        {/* Row 2: Vendor (select only) + Category (select or type new) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Vendor</span>
            <select
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
              className="border rounded p-2"
            >
              <option value="">— Select vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div className="text-xs text-gray-500">
              Need a new vendor? Go to <Link href="/vendors/new" className="underline">+ New Vendor</Link>.
            </div>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-600">Category</span>
              <select
                value={categoryId}
                onChange={e => { setCategoryId(e.target.value); setNewCategory('') }}
                className="border rounded p-2"
              >
                <option value="">— Select existing —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-600">or type new</span>
              <input
                value={newCategory}
                onChange={e => { setNewCategory(e.target.value); setCategoryId('') }}
                placeholder="New category"
                className="border rounded p-2"
              />
            </label>
          </div>
        </div>

        {/* Row 3 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Amount</span>
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="border rounded p-2" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Method</span>
            <select
              value={method}
              onChange={e => {
                const value = e.target.value
                if (value === 'check' || value === 'ach' || value === 'card' || value === 'other') {
                  setMethod(value)
                  setReference('')
                }
              }}
              className="border rounded p-2"
            >
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        {/* Row 4: Conditional reference + Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">{referenceLabel()}</span>
            <input
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder={method === 'card' ? '1234' : method === 'check' ? 'Check #' : 'Optional reference'}
              className="border rounded p-2"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Notes</span>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="border rounded p-2" />
          </label>
        </div>

        {/* Attachments */}
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">Attachments</span>
          <input type="file" multiple onChange={e => setFiles(e.target.files)} />
          <span className="text-xs text-gray-600">
            Please attach the <b>invoice</b> and the <b>receipt</b> for this expense.
          </span>
          <span className="text-xs text-gray-400">
            Stored to: <code>expense-files/hotel/&lt;hotelId&gt;/expenses/&lt;expenseId&gt;/filename</code>
          </span>
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Create expense'}
          </button>
          <Link href="/expenses" className="rounded border bg-white px-4 py-2 text-sm">Cancel</Link>
        </div>
      </form>
    </main>
  )
}
