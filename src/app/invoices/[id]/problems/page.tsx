'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

/* ---------- ACCESS GATE (manager/admin only) ---------- */
type AppRole = 'front_desk' | 'manager' | 'admin' | 'staff'
function useGateForInvoiceProblems() {
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/login'; return }
      const { data: r } = await supabase.rpc('get_my_role')
      const role = (r ?? 'staff') as AppRole
      const allowed = role === 'manager' || role === 'admin'
      if (!allowed && !ignore) window.location.href = '/#'
    })()
    return () => { ignore = true }
  }, [])
}
/* ------------------------------------------------------ */

type Problem = {
  id: string
  invoice_id: string
  title: string | null
  note: string | null
  status: 'open' | 'investigating' | 'resolved'
  created_by: string | null
  created_at: string
  updated_at: string | null
}

type ProblemFile = {
  id: string
  problem_id: string
  file_name: string
  storage_path: string
  public_url: string | null
  created_at: string
}

type InvoiceLite = { id: string; number: string | null }

export default function InvoiceProblemsPage() {
  useGateForInvoiceProblems() // apply gate

  const router = useRouter()
  const params = useParams() as { id?: string }
  const invoiceId = params?.id ?? ''

  const [invoice, setInvoice] = useState<InvoiceLite | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [filesByProblem, setFilesByProblem] = useState<Record<string, ProblemFile[]>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // new problem form
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'open' | 'investigating' | 'resolved'>('open')
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState<FileList | null>(null)

  useEffect(() => {
    if (!invoiceId) return
    ;(async () => {
      setLoading(true); setErr(null); setMsg(null)
      try {
        // 1) invoice header
        const { data: inv, error: iErr } = await supabase
          .from('invoices')
          .select('id, number')
          .eq('id', invoiceId)
          .single()
        if (iErr) throw iErr
        setInvoice(inv as InvoiceLite)

        // 2) problems for this invoice
        const { data: probs, error: pErr } = await supabase
          .from('invoice_problems')
          .select('id, invoice_id, title, note, status, created_by, created_at, updated_at')
          .eq('invoice_id', invoiceId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
        if (pErr) throw pErr
        const ps = (probs ?? []) as Problem[]
        setProblems(ps)

        // 3) files grouped by problem
        if (ps.length) {
          const ids = ps.map(p => p.id)
          const { data: files, error: fErr } = await supabase
            .from('invoice_problem_files')
            .select('id, problem_id, file_name, storage_path, public_url, created_at')
            .in('problem_id', ids)
            .order('created_at', { ascending: true })
          if (fErr) throw fErr
          const by: Record<string, ProblemFile[]> = {}
          for (const f of (files ?? []) as ProblemFile[]) {
            if (!by[f.problem_id]) by[f.problem_id] = []
            by[f.problem_id].push(f)
          }
          setFilesByProblem(by)
        } else {
          setFilesByProblem({})
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load problems')
      } finally {
        setLoading(false)
      }
    })()
  }, [invoiceId])

  async function refresh() {
    // quick re-load of just problems + files
    try {
      const { data: probs, error: pErr } = await supabase
        .from('invoice_problems')
        .select('id, invoice_id, title, note, status, created_by, created_at, updated_at')
        .eq('invoice_id', invoiceId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (pErr) throw pErr
      const ps = (probs ?? []) as Problem[]
      setProblems(ps)

      if (ps.length) {
        const ids = ps.map(p => p.id)
        const { data: files, error: fErr } = await supabase
          .from('invoice_problem_files')
          .select('id, problem_id, file_name, storage_path, public_url, created_at')
          .in('problem_id', ids)
          .order('created_at', { ascending: true })
        if (fErr) throw fErr
        const by: Record<string, ProblemFile[]> = {}
        for (const f of (files ?? []) as ProblemFile[]) {
          if (!by[f.problem_id]) by[f.problem_id] = []
          by[f.problem_id].push(f)
        }
        setFilesByProblem(by)
      } else {
        setFilesByProblem({})
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to refresh')
    }
  }

  async function createProblem(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setMsg(null)
    if (!title.trim() && !note.trim() && (!files || files.length === 0)) {
      setErr('Please add a title, a note, or at least one file.')
      return
    }

    try {
      // 1) insert problem
      const { data: inserted, error: insErr } = await supabase
        .from('invoice_problems')
        .insert({
          invoice_id: invoiceId,
          title: title.trim() || null,
          note: note.trim() || null,
          status,
        })
        .select('id')
        .single()
      if (insErr) throw insErr
      const problemId = inserted!.id as string

      // 2) upload files (if any)
      if (files && files.length > 0) {
        setUploading(true)
        const bucket = 'problem-files'
        for (const f of Array.from(files)) {
          const path = `invoices/${invoiceId}/${problemId}/${Date.now()}_${sanitizeFileName(f.name)}`
          const { error: upErr } = await supabase.storage.from(bucket).upload(path, f, { upsert: true })
          if (upErr) throw upErr

          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)

          const { error: recErr } = await supabase
            .from('invoice_problem_files')
            .insert({
              problem_id: problemId,
              file_name: f.name,
              storage_path: path,
              public_url: pub?.publicUrl ?? null,
            })
          if (recErr) throw recErr
        }
      }

      setTitle(''); setNote(''); setStatus('open'); setFiles(null)
      setMsg('Entry added')
      await refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save')
    } finally {
      setUploading(false)
    }
  }

  async function updateStatus(problemId: string, newStatus: Problem['status']) {
    setErr(null); setMsg(null)
    const { error } = await supabase
      .from('invoice_problems')
      .update({ status: newStatus })
      .eq('id', problemId)
      .is('deleted_at', null)
    if (error) { setErr(error.message); return }
    setMsg('Status updated')
    await refresh()
  }

  async function softDeleteProblem(problemId: string) {
    if (!confirm('Delete this entry? Files remain in storage unless manually removed.')) return
    setErr(null); setMsg(null)
    const { error } = await supabase
      .from('invoice_problems')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', problemId)
    if (error) { setErr(error.message); return }
    setMsg('Entry deleted')
    await refresh()
  }

  const invTitle = useMemo(() => {
    if (!invoice) return 'Invoice'
    return invoice.number ? `Invoice #${invoice.number}` : `Invoice ${invoice.id.slice(0, 6)}`
  }, [invoice])

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Problem center</h1>
          <p className="text-sm text-gray-600 mt-1">{invTitle}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/invoices/${invoiceId}/audit`} className="border rounded px-3 py-2 text-sm bg-white">Audit log</Link>
          <Link href="/invoices" className="border rounded px-3 py-2 text-sm bg-white">Back to Invoices</Link>
        </div>
      </div>

      {err && <p className="text-red-600">{err}</p>}
      {msg && <p className="text-green-700">{msg}</p>}

      <section className="border rounded-2xl bg-white p-4">
        <h2 className="font-semibold mb-3">Add entry / note</h2>
        <form onSubmit={createProblem} className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded p-2"
              placeholder="Short summary"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border rounded p-2 min-h-[90px]"
              placeholder="Describe the issue, context, next steps…"
            />
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-sm text-gray-700">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="border rounded p-2 text-sm"
            >
              <option value="open">open</option>
              <option value="investigating">investigating</option>
              <option value="resolved">resolved</option>
            </select>

            <div className="ml-auto">
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(e.target.files)}
                className="text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={uploading}
              className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-60"
            >
              {uploading ? 'Saving…' : 'Add entry'}
            </button>
          </div>
        </form>
      </section>

      <section className="border rounded-2xl bg-white">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Entries</h2>
        </div>

        {loading ? (
          <div className="p-4">Loading…</div>
        ) : problems.length === 0 ? (
          <div className="p-4 text-gray-500">No entries yet.</div>
        ) : (
          <ul className="divide-y">
            {problems.map((p) => (
              <li key={p.id} className="p-4">
                <div className="flex items-start gap-3">
                  <StatusPill status={p.status} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{p.title || '(no title)'}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(p.created_at).toLocaleString()}
                      </div>
                    </div>
                    {p.note && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{p.note}</p>}

                    <div className="mt-2">
                      {(filesByProblem[p.id] ?? []).length === 0 ? (
                        <div className="text-xs text-gray-500">No files</div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(filesByProblem[p.id] ?? []).map((f) => (
                            <a
                              key={f.id}
                              href={f.public_url ?? '#'}
                              target="_blank"
                              className="px-2 py-1 border rounded text-xs bg-gray-50 hover:bg-gray-100"
                            >
                              {f.file_name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex gap-2 text-xs">
                      <button
                        className="underline"
                        onClick={() => updateStatus(p.id, nextStatus(p.status))}
                        title="Cycle status: open → investigating → resolved"
                      >
                        Set {nextStatus(p.status)}
                      </button>
                      <button className="underline text-red-600" onClick={() => softDeleteProblem(p.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

/* ---------- helpers ---------- */

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]/g, '_')
}

function nextStatus(s: 'open' | 'investigating' | 'resolved'): 'open' | 'investigating' | 'resolved' {
  if (s === 'open') return 'investigating'
  if (s === 'investigating') return 'resolved'
  return 'open'
}

function StatusPill({ status }: { status: 'open' | 'investigating' | 'resolved' }) {
  const color =
    status === 'open' ? 'bg-orange-100 text-orange-800' :
    status === 'investigating' ? 'bg-blue-100 text-blue-800' :
    'bg-green-100 text-green-800'
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${color} whitespace-nowrap`}>
      {status}
    </span>
  )
}
