'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Project = { id: string; name: string; hotel_id: string }
type Exp = {
  id: string
  expense_date: string
  kind: 'materials' | 'labor' | string
  store: string | null
  description: string | null
  amount: number
  method: 'card' | 'check' | 'ach' | 'other' | string
  reference: string | null
}

type FileItem = {
  expId: string
  name: string
  size: number
  path: string
  url: string
  unmatched?: boolean
}

function fmtMoney(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

// ---------- storage helpers ----------

async function listPrefixFiles(
  bucket: ReturnType<typeof supabase.storage.from>,
  prefix: string
): Promise<string[]> {
  const clean = prefix.replace(/^\/+/, '').replace(/\/+$/, '')
  const { data: entries, error } = await bucket.list(clean, { limit: 100, offset: 0 })
  if (error || !entries) return []
  return entries
    .filter((it: any) => (it as any).type !== 'folder')
    .map((it) => `${clean}/${it.name}`)
}

async function listFilesForExpense(projectId: string, expId: string) {
  const bucket = supabase.storage.from('project-files')
  const expenseDir = `projects/${projectId}/expenses/${expId}`
  let files = await listPrefixFiles(bucket, expenseDir)

  let unmatched = false
  if (files.length === 0) {
    const rootDir = `projects/${projectId}`
    files = await listPrefixFiles(bucket, rootDir)
    unmatched = true
  }

  const items: FileItem[] = []
  for (const path of files) {
    let url = bucket.getPublicUrl(path).data.publicUrl
    if (!url || url.endsWith('/')) {
      const { data: s } = await bucket.createSignedUrl(path, 60 * 60)
      if (s?.signedUrl) url = s.signedUrl
    }
    items.push({
      expId,
      name: path.split('/').pop() || path,
      size: 0,
      path,
      url,
      unmatched,
    })
  }
  return items
}

// ---------- page ----------

export default function ProjectExpensesLogPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id

  // membership
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])
  const [accessChecked, setAccessChecked] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)

  const [project, setProject] = useState<Project | null>(null)
  const [rows, setRows] = useState<Exp[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // edit modal
  const [editing, setEditing] = useState<Exp | null>(null)
  const [editFiles, setEditFiles] = useState<FileItem[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ---- Load membership first
  useEffect(() => {
    ;(async () => {
      try {
        const [{ data: mh }, { data: auth }] = await Promise.all([
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])
        const uid = auth.user?.id
        const mine = uid
          ? (mh ?? []).filter((m: any) => m.user_id === uid).map((m: any) => m.hotel_id)
          : []
        setMyHotelIds(mine) // may be empty -> fallback handled after fetching project
      } catch (e: any) {
        // non-fatal; err message will appear later if fetch fails
      } finally {
        setAccessChecked(true)
      }
    })()
  }, [])

  // ---- load project + expenses (with access check)
  useEffect(() => {
    if (!accessChecked) return
    ;(async () => {
      setErr(null); setLoading(true)
      try {
        const { data: p, error: pErr } = await supabase
          .from('projects')
          .select('id, name, hotel_id')
          .eq('id', projectId)
          .single()
        if (pErr) throw pErr
        const proj = p as Project
        setProject(proj)

        // access rule: if user has explicit memberships, project hotel_id must be in them
        const allowed = myHotelIds.length === 0 || myHotelIds.includes(proj.hotel_id)
        setHasAccess(allowed)
        if (!allowed) {
          setRows([])
          setLoading(false)
          return
        }

        const { data: ex, error: eErr } = await supabase
          .from('project_expenses')
          .select('id, expense_date, kind, store, description, amount, method, reference')
          .eq('project_id', projectId)
          .order('expense_date', { ascending: true })
          .order('created_at', { ascending: true })
        if (eErr) throw eErr
        setRows((ex ?? []) as Exp[])
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load')
        setProject(null)
        setRows([])
      } finally {
        setLoading(false)
      }
    })()
  }, [projectId, accessChecked, myHotelIds])

  // summaries
  const totals = useMemo(() => {
    let materials = 0
    let labor = 0
    for (const r of rows) {
      const a = Number(r.amount || 0)
      if ((r.kind ?? '').toLowerCase() === 'labor') labor += a
      else materials += a
    }
    return { materials, labor, grand: materials + labor }
  }, [rows])

  // ---------- edit / delete handlers (disabled if no access) ----------

  function openEdit(row: Exp) {
    if (hasAccess === false) return
    setEditing({ ...row })
    setEditFiles(null)
    ;(async () => {
      try {
        const items = await listFilesForExpense(projectId, row.id)
        setEditFiles(items)
      } catch {
        setEditFiles([])
      }
    })()
  }

  async function saveEdit() {
    if (!editing || hasAccess === false) return
    setSaving(true); setErr(null)
    try {
      const payload = {
        expense_date: editing.expense_date,
        kind: editing.kind,
        store: editing.store,
        description: editing.description,
        amount: Number(editing.amount),
        method: editing.method,
        reference: editing.reference,
      }
      const { error } = await supabase
        .from('project_expenses')
        .update(payload)
        .eq('id', editing.id)
        .eq('project_id', projectId)
      if (error) throw error

      setRows(prev => prev.map(r => (r.id === editing.id ? { ...r, ...payload } as Exp : r)))
      setEditing(null)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRow(id: string) {
    if (hasAccess === false) return
    if (!confirm('Delete this expense?')) return
    setDeletingId(id); setErr(null)
    try {
      const { error } = await supabase
        .from('project_expenses')
        .delete()
        .eq('id', id)
        .eq('project_id', projectId)
      if (error) throw error
      setRows(prev => prev.filter(r => r.id !== id))
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      {/* Responsive header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Project Expenses Log</h1>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Link href="/projects" className="rounded border bg-white px-3 py-2 text-sm w-full sm:w-auto text-center">Back to Projects</Link>
          <Link
            href={`/projects/expenses/new?project_id=${projectId}`}
            className={`rounded px-3 py-2 text-sm w-full sm:w-auto text-center ${hasAccess === false ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-black text-white'}`}
            aria-disabled={hasAccess === false}
            onClick={(e) => { if (hasAccess === false) e.preventDefault() }}
          >
            + Add expense
          </Link>
        </div>
      </div>

      {project && (
        <div className="mb-4 text-gray-700">
          <span className="mr-2">Project:</span>
          <span className="font-medium">{project.name}</span>
          {hasAccess === false && (
            <span className="ml-3 text-sm text-red-600">(you don’t have access to this hotel)</span>
          )}
        </div>
      )}

      {err && <p className="text-red-600 mb-2">{err}</p>}

      {/* ===== Mobile list (cards) ===== */}
      <div className="md:hidden space-y-3">
        {loading && <div className="border rounded p-4 text-sm">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="border rounded p-4 text-sm text-gray-500">No expenses.</div>
        )}
        {!loading && rows.map((r) => {
          const isLabor = (r.kind ?? '').toLowerCase() === 'labor'
          const badge = isLabor ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
          return (
            <div key={r.id} className="border rounded-xl bg-white">
              <div className="p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{r.store || '—'}</div>
                  <div className="text-xs text-gray-500">{r.expense_date}</div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${badge}`}>{r.kind}</span>
              </div>

              {r.description && (
                <div className="px-3 pb-2 text-sm text-gray-700">
                  {r.description}
                </div>
              )}

              <div className="px-3 pb-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Amount</div>
                    <div className="font-medium">{fmtMoney(r.amount)}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Method</div>
                    <div className="font-medium uppercase">{r.method}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Ref</div>
                    <div className="font-medium">{r.reference || '—'}</div>
                  </div>
                </div>

                <div className="mt-2 flex justify-end gap-4">
                  <button
                    className={`underline text-xs ${hasAccess === false ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => hasAccess !== false && openEdit(r)}
                    disabled={hasAccess === false}
                  >
                    Edit
                  </button>
                  <button
                    className={`underline text-xs text-red-600 disabled:opacity-50 ${hasAccess === false ? 'cursor-not-allowed' : ''}`}
                    onClick={() => hasAccess !== false && deleteRow(r.id)}
                    disabled={deletingId === r.id || hasAccess === false}
                  >
                    {deletingId === r.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== Desktop table (original) ===== */}
      <div className="overflow-x-auto border rounded hidden md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Store</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2 text-left">Method</th>
              <th className="p-2 text-left">Ref</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={8} className="p-4">Loading…</td></tr>)}
            {!loading && rows.length === 0 && (<tr><td colSpan={8} className="p-4 text-gray-500">No expenses.</td></tr>)}
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.expense_date}</td>
                <td className="p-2 capitalize">{r.kind}</td>
                <td className="p-2">{r.store ?? ''}</td>
                <td className="p-2">{r.description ?? ''}</td>
                <td className="p-2 text-right">{fmtMoney(r.amount)}</td>
                <td className="p-2 uppercase">{r.method}</td>
                <td className="p-2">{r.reference ?? ''}</td>
                <td className="p-2">
                  <div className="flex gap-3">
                    <button
                      className={`underline text-xs ${hasAccess === false ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => hasAccess !== false && openEdit(r)}
                      disabled={hasAccess === false}
                    >
                      Edit
                    </button>
                    <button
                      className={`underline text-xs text-red-600 disabled:opacity-50 ${hasAccess === false ? 'cursor-not-allowed' : ''}`}
                      onClick={() => hasAccess !== false && deleteRow(r.id)}
                      disabled={deletingId === r.id || hasAccess === false}
                    >
                      {deletingId === r.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-4 border rounded p-3">
        <div className="flex justify-between text-sm"><span>Total materials</span><b>{fmtMoney(totals.materials)}</b></div>
        <div className="flex justify-between text-sm"><span>Total labor</span><b>{fmtMoney(totals.labor)}</b></div>
        <hr className="my-2" />
        <div className="flex justify-between font-semibold"><span>Grand total</span><b>{fmtMoney(totals.grand)}</b></div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-semibold">Edit expense</div>
              <button className="text-xl leading-none" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={editing.expense_date}
                    onChange={(e) => setEditing({ ...editing, expense_date: e.target.value })}
                    className="border rounded p-2 w-full"
                    disabled={hasAccess === false}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Type</label>
                  <select
                    value={editing.kind}
                    onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                    className="border rounded p-2 w-full capitalize"
                    disabled={hasAccess === false}
                  >
                    <option value="materials">materials</option>
                    <option value="labor">labor</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Store</label>
                  <input
                    value={editing.store ?? ''}
                    onChange={(e) => setEditing({ ...editing, store: e.target.value })}
                    className="border rounded p-2 w-full"
                    disabled={hasAccess === false}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Method</label>
                  <select
                    value={editing.method}
                    onChange={(e) => setEditing({ ...editing, method: e.target.value })}
                    className="border rounded p-2 w-full uppercase"
                    disabled={hasAccess === false}
                  >
                    <option value="card">card</option>
                    <option value="check">check</option>
                    <option value="ach">ach</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Description</label>
                <textarea
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className="border rounded p-2 w-full min-h-[88px]"
                  disabled={hasAccess === false}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editing.amount}
                    onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                    className="border rounded p-2 w-full"
                    disabled={hasAccess === false}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Reference</label>
                  <input
                    value={editing.reference ?? ''}
                    onChange={(e) => setEditing({ ...editing, reference: e.target.value })}
                    className="border rounded p-2 w-full"
                    disabled={hasAccess === false}
                  />
                </div>
              </div>

              <div>
                <div className="font-medium mb-1">Attachments</div>
                {editFiles === null ? (
                  <div className="text-sm text-gray-500">Loading files…</div>
                ) : editFiles.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    No files matched for this expense. (Files are searched at
                    <code className="mx-1 text-gray-600">
                      {` projects/${projectId}/expenses/${editing.id}/ `}
                    </code>
                    and we also look under
                    <code className="mx-1 text-gray-600">
                      {` projects/${projectId}/ `}
                    </code>
                    for unmatched uploads.)
                  </div>
                ) : (
                  <ul className="list-disc pl-5 space-y-1">
                    {editFiles.map((f) => (
                      <li key={f.path}>
                        <a href={f.url} target="_blank" className="text-blue-600 hover:underline">
                          {f.name}
                        </a>
                        {f.unmatched && (
                          <span className="ml-2 text-xs text-gray-500">(unmatched file)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button className="rounded border bg-white px-3 py-2 text-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-60"
                onClick={saveEdit}
                disabled={saving || hasAccess === false}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
