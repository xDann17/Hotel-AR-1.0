'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Project = { id: string; name: string; hotel_id: string }
type MemberHotel = { user_id: string; hotel_id: string }

const BUCKET = 'project-files'

export default function NewProjectExpensePage() {
  const router = useRouter()
  const params = useSearchParams()
  // support both ?project_id=… and ?projectId=…
  const qProjectId = params.get('project_id') ?? params.get('projectId') ?? undefined

  // membership
  const [myHotelIds, setMyHotelIds] = useState<string[]>([])

  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | ''>(qProjectId ?? '')
  const [hotelId, setHotelId] = useState<string>('') // derived from selected project (for path)
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().slice(0,10))
  const [kind, setKind] = useState<'materials'|'labor'>('materials')
  const [store, setStore] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [method, setMethod] = useState<'card'|'check'|'ach'|'other'>('card')
  const [reference, setReference] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // hold files until we know the expense id, then upload into that folder
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null)

  const refLabel = useMemo(() => {
    switch (method) {
      case 'card': return 'Card last 4'
      case 'check': return 'Check #'
      default: return 'Reference (optional)'
    }
  }, [method])

  // Load membership first, then projects; filter projects by accessible hotel_ids
  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        const [{ data: mh }, { data: auth }] = await Promise.all([
          supabase.from('member_hotels').select('user_id,hotel_id'),
          supabase.auth.getUser(),
        ])
        const uid = auth.user?.id
        const members = (mh ?? []) as MemberHotel[]
        const mine = uid ? members.filter(m => m.user_id === uid).map(m => m.hotel_id) : []

        // If no explicit membership rows exist, fall back to all hotel ids present in projects fetch (handled later)
        setMyHotelIds(mine)
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load access')
      }
    })()
  }, [])

  // Load projects and filter by myHotelIds (if empty, we show all — same pattern as other pages)
  useEffect(() => {
    ;(async () => {
      setErr(null)
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('id, name, hotel_id')
          .order('created_at', { ascending: false })
        if (error) throw error

        const all = (data ?? []) as Project[]

        // If we have membership rows, filter by them; otherwise allow all.
        const filtered = myHotelIds.length ? all.filter(p => myHotelIds.includes(p.hotel_id)) : all
        setProjects(filtered)

        if (qProjectId) {
          const found = filtered.find(p => p.id === qProjectId)
          if (found) {
            setHotelId(found.hotel_id)
          } else {
            setMsg('You do not have access to the selected project.')
          }
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load projects')
      }
    })()
  }, [qProjectId, myHotelIds])

  useEffect(() => {
    const p = projects.find(p => p.id === projectId)
    setHotelId(p?.hotel_id ?? '')
  }, [projectId, projects])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) { setErr('Select a project'); return }
    const selected = projects.find(p => p.id === projectId)
    // submit-time guard: project must be in accessible set
    if (!selected) { setErr('You do not have access to this project'); return }
    if (!amount || amount <= 0) { setErr('Amount must be greater than 0'); return }
    setErr(null); setMsg(null)
    setUploading(true)

    try {
      // 1) Insert expense to obtain id
      const payload = {
        project_id: projectId,
        expense_date: expenseDate,
        kind,
        store,
        description,
        amount: Number(amount),
        method,
        reference: reference || null,
      }
      const { data: inserted, error } = await supabase
        .from('project_expenses')
        .insert(payload)
        .select('id, project_id')
        .single()
      if (error) throw error

      const expenseId = inserted!.id as string

      // 2) Upload any selected files into the per-expense folder
      if (pendingFiles && pendingFiles.length > 0) {
        const base = `projects/${projectId}/expenses/${expenseId}`
        for (const f of Array.from(pendingFiles)) {
          const path = `${base}/${f.name}`
          const up = await supabase.storage.from(BUCKET).upload(path, f, {
            cacheControl: '3600',
            upsert: true,
          })
          if (up.error) throw up.error
        }
      }

      setMsg('Expense saved')
      router.push(`/projects/expenses/${inserted.project_id}/log`)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save expense')
    } finally {
      setUploading(false)
    }
  }

  // store files (don’t upload yet)
  function onChooseFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    setPendingFiles(ev.target.files)
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">New Project Expense</h1>

      <div className="flex gap-2 mb-4">
        <Link href="/#" className="rounded border bg-white px-3 py-2 text-sm">Dashboard</Link>
        <Link href="/projects" className="rounded border bg-white px-3 py-2 text-sm">Back to Projects</Link>
      </div>

      {err && <p className="text-red-600 mb-2">{err}</p>}
      {msg && <p className="text-green-700 mb-2">{msg}</p>}

      <form onSubmit={onSubmit} className="bg-white border rounded p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Project</label>
            {qProjectId ? (
              <input
                value={projects.find(p => p.id === qProjectId)?.name ?? ''}
                disabled
                className="border rounded p-2 w-full bg-gray-50"
              />
            ) : (
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="border rounded p-2 w-full"
              >
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Date</label>
            <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="border rounded p-2 w-full" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Type</label>
            <select value={kind} onChange={e => setKind(e.target.value as any)} className="border rounded p-2 w-full">
              <option value="materials">Materials</option>
              <option value="labor">Labor</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value as any)} className="border rounded p-2 w-full">
              <option value="card">Card</option>
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">{refLabel}</label>
            <input value={reference} onChange={e => setReference(e.target.value)} className="border rounded p-2 w-full" placeholder={refLabel === 'Card last 4' ? '1234' : refLabel === 'Check #' ? 'e.g. 1052' : 'optional'} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Store / Vendor</label>
            <input value={store} onChange={e => setStore(e.target.value)} className="border rounded p-2 w-full" placeholder="Home Depot, ABC Co., …" />
          </div>
          <div>
            <label className="block text-sm mb-1">Amount</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(Number(e.target.value))} className="border rounded p-2 w-full" />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="border rounded p-2 w-full" placeholder="What was purchased / work performed" />
        </div>

        <div>
          <label className="block text-sm mb-1">Attachment</label>
          <div className="text-xs text-gray-600 mb-2">Please attach the invoice/receipt if available.</div>
          <input type="file" multiple onChange={onChooseFiles} disabled={uploading || !projectId} />
        </div>

        <div className="flex items-center gap-2">
          <button type="submit" className="rounded bg-black text-white px-4 py-2 text-sm" disabled={uploading}>Save expense</button>
          <Link href="/projects" className="rounded border bg-white px-3 py-2 text-sm">Cancel</Link>
        </div>
      </form>
    </main>
  )
}
