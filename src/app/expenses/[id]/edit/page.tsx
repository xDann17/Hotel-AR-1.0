'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Hotel = { id: string; name: string }
type Vendor = { id: string; name: string }
type Category = { id: string; name: string }

type ExpenseEdit = {
  id: string
  hotel_id: string
  expense_date: string
  vendor_id: string | null
  category_id: string | null
  amount: number
  method: 'check' | 'ach' | 'card' | 'other' | string
  reference: string | null
  notes: string | null
}

type FileItem = { name: string; path: string; signedUrl?: string }

// ---- ACCESS GATE: only manager/admin can view this page ----
type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'
function useGateForEditExpense() {
  const router = useRouter()
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { router.replace('/login'); return }
      const { data: r } = await supabase.rpc('get_my_role')
      const role = (r ?? 'staff') as AppRole
      const allowed = role === 'manager' || role === 'admin'
      if (!allowed && !ignore) router.replace('/#')
    })()
    return () => { ignore = true }
  }, [router])
}
// ------------------------------------------------------------

function fmtMoney(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export default function EditExpensePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  useGateForEditExpense() // apply gate

  // lookups
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  // form
  const [row, setRow] = useState<ExpenseEdit | null>(null)
  const [categoryNew, setCategoryNew] = useState('') // "or type new" (category only)
  const [uploading, setUploading] = useState(false)

  // attachments
  const [files, setFiles] = useState<FileItem[]>([])
  const bucket = 'expense-files'

  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // load lookups + expense
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

        const { data: e, error: eErr } = await supabase
          .from('expenses')
          .select('id, hotel_id, expense_date, vendor_id, category_id, amount, method, reference, notes')
          .eq('id', id)
          .single()
        if (eErr) throw eErr

        setRow({
          id: e.id,
          hotel_id: e.hotel_id,
          expense_date: e.expense_date,
          vendor_id: e.vendor_id,
          category_id: e.category_id,
          amount: Number(e.amount || 0),
          method: e.method,
          reference: e.reference ?? null,
          notes: e.notes ?? null,
        } as ExpenseEdit)

        // list attachments
        await refreshAttachments(e.hotel_id, e.id)
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load expense')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function refreshAttachments(hotelId: string, expenseId: string) {
    const prefix = `hotel/${hotelId}/expenses/${expenseId}`
    const { data: list, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) {
      setFiles([])
      return
    }
    const items = (list ?? []).map((f) => ({ name: f.name, path: `${prefix}/${f.name}` }))
    // create signed urls
    const withUrls: FileItem[] = []
    for (const it of items) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(it.path, 60 * 10) // 10 min
      withUrls.push({ ...it, signedUrl: data?.signedUrl })
    }
    setFiles(withUrls)
  }

  const methodLabel = useMemo(() => {
    if (!row) return 'Reference'
    switch ((row.method || '').toLowerCase()) {
      case 'card': return 'Card last 4'
      case 'check': return 'Check #'
      default: return 'Reference'
    }
  }, [row?.method])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    setErr(null); setMsg(null)

    try {
      let categoryId = row.category_id
      if (categoryNew.trim()) {
        const { data: inserted, error: cErr } = await supabase
          .from('expense_categories')
          .insert({ name: categoryNew.trim() })
          .select('id')
          .single()
        if (cErr) throw cErr
        categoryId = inserted.id
      }

      const payload = {
        hotel_id: row.hotel_id,
        expense_date: row.expense_date,
        vendor_id: row.vendor_id,
        category_id: categoryId,
        amount: Number(row.amount || 0),
        method: row.method,
        reference: row.reference,
        notes: row.notes,
      }

      const { error } = await supabase.from('expenses').update(payload).eq('id', row.id)
      if (error) throw error

      setMsg('Expense updated')
      router.push('/expenses')
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to update expense')
    }
  }

  async function onUploadFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    if (!row) return
    const filesSel = ev.target.files
    if (!filesSel || filesSel.length === 0) return
    setUploading(true); setErr(null); setMsg(null)
    try {
      const prefix = `hotel/${row.hotel_id}/expenses/${row.id}`
      for (const file of Array.from(filesSel)) {
        const path = `${prefix}/${file.name}`
        const { error } = await supabase.storage.from(bucket).upload(path, file, {
          cacheControl: '3600',
          upsert: true,
        })
        if (error) throw error
      }
      await refreshAttachments(row.hotel_id, row.id)
      setMsg('Attachment(s) uploaded')
      ev.target.value = ''
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to upload')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Edit Expense</h1>
        <div>Loading…</div>
      </main>
    )
  }

  if (!row) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Edit Expense</h1>
        <p className="text-red-600">{err ?? 'Expense not found'}</p>
        <Link href="/expenses" className="inline-block mt-3 rounded border px-3 py-2 text-sm bg-white">Back to Expenses</Link>
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Edit Expense</h1>

      <div className="flex gap-2 mb-4">
        <Link href="/expenses" className="rounded border bg-white px-3 py-2 text-sm">Back to Expenses</Link>
        <Link href="/#" className="rounded border bg-white px-3 py-2 text-sm">Dashboard</Link>
      </div>

      {err && <p className="text-red-600 mb-3">{err}</p>}
      {msg && <p className="text-green-700 mb-3">{msg}</p>}

      <form onSubmit={onSave} className="bg-white border rounded p-4 space-y-4">
        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Hotel</label>
            <select
              value={row.hotel_id}
              onChange={(e) => setRow({ ...row, hotel_id: e.target.value })}
              className="border rounded p-2 w-full"
            >
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              value={row.expense_date}
              onChange={(e) => setRow({ ...row, expense_date: e.target.value })}
              className="border rounded p-2 w-full"
            />
          </div>
        </div>

        {/* Vendor / Category */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Vendor</label>
            <select
              value={row.vendor_id ?? ''}
              onChange={(e) => setRow({ ...row, vendor_id: e.target.value || null })}
              className="border rounded p-2 w-full"
            >
              <option value="">— Select vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div className="text-xs text-gray-500 mt-1">
              To add/edit vendors, use the <Link className="underline" href="/vendors">Vendors</Link> page.
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Category</label>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-2">
              <select
                value={row.category_id ?? ''}
                onChange={(e) => setRow({ ...row, category_id: e.target.value || null })}
                className="border rounded p-2 w-full"
              >
                <option value="">— Select existing —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                value={categoryNew}
                onChange={(e) => setCategoryNew(e.target.value)}
                placeholder="or type new"
                className="border rounded p-2 w-full"
              />
            </div>
          </div>
        </div>

        {/* Amount / Method */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={row.amount}
              onChange={(e) => setRow({ ...row, amount: Number(e.target.value) })}
              className="border rounded p-2 w-full"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Method</label>
            <select
              value={row.method}
              onChange={(e) => setRow({ ...row, method: e.target.value })}
              className="border rounded p-2 w-full"
            >
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {/* Reference / Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">{methodLabel}</label>
            <input
              value={row.reference ?? ''}
              onChange={(e) => setRow({ ...row, reference: e.target.value })}
              placeholder={row.method === 'card' ? '1234' : row.method === 'check' ? 'e.g. 1052' : 'optional'}
              className="border rounded p-2 w-full"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Notes</label>
            <input
              value={row.notes ?? ''}
              onChange={(e) => setRow({ ...row, notes: e.target.value })}
              placeholder="optional"
              className="border rounded p-2 w-full"
            />
          </div>
        </div>

        {/* Attachments */}
        <div>
          <label className="block text-sm mb-1">Attachments</label>
          <div className="text-xs text-gray-600 mb-2">
            Please attach the <b>invoice</b> and the <b>receipt</b> of the paid invoice.
          </div>

          {files.length === 0 ? (
            <div className="text-sm text-gray-500 mb-2">No attachments.</div>
          ) : (
            <ul className="mb-3 space-y-1">
              {files.map((f) => (
                <li key={f.path} className="flex items-center justify-between bg-gray-50 border rounded px-2 py-1">
                  <span className="truncate mr-3">{f.name}</span>
                  {f.signedUrl ? (
                    <a
                      href={f.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-sm text-gray-400">No link</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <input type="file" multiple onChange={onUploadFiles} disabled={uploading} />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded bg-black text-white px-4 py-2 text-sm"
            disabled={uploading}
          >
            Save changes
          </button>
          <Link href="/expenses" className="rounded border bg-white px-3 py-2 text-sm">Cancel</Link>
        </div>
      </form>
    </main>
  )
}
