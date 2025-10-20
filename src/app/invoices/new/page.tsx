'use client'

/**
 * app/invoices/new/page.tsx
 *
 * - DB computes `nights` (GENERATED) and `total` (subtotal + tax).
 * - We compute preview client-side but NEVER send `nights` or `total`.
 * - Invoice number is optional (stored as null if left blank).
 * - Client field is a searchable combobox for large lists.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '@/lib/supabase'

// ---------- Types ----------
type Hotel   = { id: string; name: string }
type Company = { id: string; name: string }
type Client  = { id: string; name: string }

const schema = z.object({
  hotel_id: z.string().uuid('Pick a hotel'),
  company_id: z.string().uuid('Pick a company'),
  client_id: z.string().uuid('Pick a client'),
  confirmation_no: z.string().optional(),
  number: z.string().optional(),       // invoice # (optional)
  case_no: z.string().optional(),

  issue_date: z.string().min(1, 'Issue date required'), // YYYY-MM-DD
  due_date:   z.string().min(1, 'Due date required'),   // YYYY-MM-DD

  check_in:  z.string().min(1, 'Check-in required'),    // YYYY-MM-DD
  check_out: z.string().min(1, 'Check-out required'),   // YYYY-MM-DD

  rate_night: z
    .union([z.string(), z.number()])
    .transform(v => (typeof v === 'string' ? Number(v) : v))
    .refine(v => Number.isFinite(v) && v >= 0, 'Rate must be a number ≥ 0'),
})

type FormValues = z.infer<typeof schema>

// ---------- Helpers ----------
function todayYMD() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function daysBetween(startYMD: string, endYMD: string) {
  if (!startYMD || !endYMD) return 0
  const start = new Date(startYMD + 'T00:00:00')
  const end   = new Date(endYMD + 'T00:00:00')
  const ms = end.getTime() - start.getTime()
  if (!Number.isFinite(ms)) return 0
  const n = Math.ceil(ms / (1000 * 60 * 60 * 24))
  return Math.max(0, n)
}

// ---------- Component ----------
export default function NewInvoicePage() {
  const router = useRouter()

  const [hotels, setHotels] = useState<Hotel[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [clients, setClients] = useState<Client[]>([])

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      hotel_id: '',
      company_id: '',
      client_id: '',
      confirmation_no: '',
      number: '',         // optional
      case_no: '',

      issue_date: todayYMD(),
      due_date: todayYMD(),

      check_in: todayYMD(),
      check_out: todayYMD(),

      rate_night: 0,
    },
  })

  // watched values for preview & client selection
  const wCheckIn   = watch('check_in')
  const wCheckOut  = watch('check_out')
  const wRateNight = watch('rate_night')
  const wClientId  = watch('client_id')

  const nights = useMemo(() => daysBetween(wCheckIn, wCheckOut), [wCheckIn, wCheckOut])
  const previewTotal = useMemo(() => {
    const rate = Number(wRateNight) || 0
    return Math.max(0, nights * rate)
  }, [nights, wRateNight])

  // --- Combobox state for Client ---
  const [clientQuery, setClientQuery] = useState('')
  const [clientListOpen, setClientListOpen] = useState(false)
  const clientBoxRef = useRef<HTMLDivElement | null>(null)

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()
    if (!q) return clients.slice(0, 8)
    return clients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [clientQuery, clients])

  // click outside to close combobox
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!clientBoxRef.current) return
      if (!clientBoxRef.current.contains(e.target as Node)) {
        setClientListOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Keep the text box in sync when client_id changes (e.g., default select)
  useEffect(() => {
    if (!wClientId) return
    const match = clients.find(c => c.id === wClientId)
    if (match) setClientQuery(match.name)
  }, [wClientId, clients])

  function chooseClient(c: Client) {
    setValue('client_id', c.id, { shouldValidate: true })
    setClientQuery(c.name)
    setClientListOpen(false)
  }

  function clearClient() {
    setValue('client_id', '' as any, { shouldValidate: true })
    setClientQuery('')
    setClientListOpen(true)
  }

  // Load dropdown data
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setErr(null)
        setLoading(true)

        const [hRes, cRes, clRes] = await Promise.all([
          // ⬇️ ONLY CHANGE: exclude soft-deleted hotels
          supabase.from('hotels').select('id, name').is('deleted_at', null).order('name', { ascending: true }),
          supabase.from('companies').select('id, name').order('name', { ascending: true }),
          supabase.from('clients').select('id, name').order('name', { ascending: true }),
        ])

        if (hRes.error) throw hRes.error
        if (cRes.error) throw cRes.error
        if (clRes.error) throw clRes.error

        if (cancelled) return

        const hs  = (hRes.data ?? []) as Hotel[]
        const cos = (cRes.data ?? []) as Company[]
        const cls = (clRes.data ?? []) as Client[]

        setHotels(hs)
        setCompanies(cos)
        setClients(cls)

        // preselect sensible defaults if empty
        if (hs.length) setValue('hotel_id', hs[0].id, { shouldValidate: true })
        if (cos.length) setValue('company_id', cos[0].id, { shouldValidate: true })
        if (cls.length) {
          setValue('client_id', cls[0].id, { shouldValidate: true })
          setClientQuery(cls[0].name)
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [setValue])

  // Submit
  const onSubmit = async (values: FormValues) => {
    try {
      setSaveErr(null)
      setSaveMsg(null)

      const subtotal = Math.max(0, Number(previewTotal) || 0) // safe guard
      const tax = 0                                       // explicit; DB total = subtotal + tax
      const balance = subtotal                            // <- IMPORTANT so new invoices show correct balance
      const status: 'open' | 'partial' | 'paid' | 'void' = 'open'

      const row = {
        hotel_id: values.hotel_id,
        company_id: values.company_id,
        client_id: values.client_id,

        confirmation_no: values.confirmation_no?.trim() || null,
        number: values.number?.trim() ? values.number.trim() : null, // optional
        case_no: values.case_no?.trim() || null,

        issue_date: values.issue_date,
        due_date: values.due_date,

        check_in: values.check_in,
        check_out: values.check_out,

        rate_night: Number(values.rate_night) || 0,

        // Let DB compute nights and total; we still send explicit monetary fields for immediate correctness
        subtotal,
        tax,
        balance,
        status,
      } as const

      const { error } = await supabase.from('invoices').insert([row])
      if (error) throw error

      setSaveMsg('Invoice created')
      router.push('/invoices')
    } catch (e: any) {
      setSaveErr(e?.message ?? 'Failed to create invoice')
    }
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold">New Invoice</h1>
        <p className="mt-2">Loading…</p>
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">New Invoice</h1>

      {err && <p className="text-red-600">{err}</p>}
      {saveErr && <p className="text-red-600">{saveErr}</p>}
      {saveMsg && <p className="text-green-700">{saveMsg}</p>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Hotel + Company */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Hotel</label>
            <select {...register('hotel_id')} className="w-full border rounded p-2">
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            {errors.hotel_id && <p className="text-red-600 text-sm">{errors.hotel_id.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium">Company</label>
            <select {...register('company_id')} className="w-full border rounded p-2">
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.company_id && <p className="text-red-600 text-sm">{errors.company_id.message}</p>}
          </div>
        </div>

        {/* Client combobox */}
        <div ref={clientBoxRef} className="relative">
          <label className="block text-sm font-medium">Client</label>

          {/* Hidden field that react-hook-form validates */}
          <input type="hidden" {...register('client_id')} />

          <div className="flex gap-2">
            <input
              value={clientQuery}
              onChange={(e) => {
                setClientQuery(e.target.value)
                // if user starts typing something else, clear selected id
                setValue('client_id', '' as any, { shouldValidate: true })
                setClientListOpen(true)
              }}
              onFocus={() => setClientListOpen(true)}
              className="w-full border rounded p-2"
              placeholder="Search clients…"
              autoComplete="off"
            />
            {clientQuery && (
              <button
                type="button"
                onClick={clearClient}
                className="px-2 text-sm border rounded"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>

          {clientListOpen && filteredClients.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded border bg-white shadow">
              {filteredClients.map(c => (
                <li
                  key={c.id}
                  className="px-3 py-2 cursor-pointer hover:bg-gray-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseClient(c)}
                >
                  {c.name}
                </li>
              ))}
            </ul>
          )}
          {errors.client_id && <p className="text-red-600 text-sm mt-1">{errors.client_id.message}</p>}
        </div>

        {/* Confirmation / Invoice # (optional) / Case # */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Confirmation #</label>
            <input {...register('confirmation_no')} className="w-full border rounded p-2" placeholder="ABC123…" />
          </div>
          <div>
            <label className="block text-sm font-medium">Invoice # (optional)</label>
            <input {...register('number')} className="w-full border rounded p-2" placeholder="INV-1007" />
          </div>
          <div>
            <label className="block text-sm font-medium">Case #</label>
            <input {...register('case_no')} className="w-full border rounded p-2" placeholder="Case id…" />
          </div>
        </div>

        {/* Issue / Due */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Issue date</label>
            <input type="date" {...register('issue_date')} className="w-full border rounded p-2" />
            {errors.issue_date && <p className="text-red-600 text-sm">{errors.issue_date.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium">Due date</label>
            <input type="date" {...register('due_date')} className="w-full border rounded p-2" />
            {errors.due_date && <p className="text-red-600 text-sm">{errors.due_date.message}</p>}
          </div>
        </div>

        {/* Check-in / Check-out / Rate */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Check-in</label>
            <input type="date" {...register('check_in')} className="w-full border rounded p-2" />
            {errors.check_in && <p className="text-red-600 text-sm">{errors.check_in.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium">Check-out</label>
            <input type="date" {...register('check_out')} className="w-full border rounded p-2" />
            {errors.check_out && <p className="text-red-600 text-sm">{errors.check_out.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium">Rate / night</label>
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              {...register('rate_night')}
              className="w-full border rounded p-2"
              placeholder="0.00"
            />
            {errors.rate_night && <p className="text-red-600 text-sm">{errors.rate_night.message}</p>}
          </div>
        </div>

        {/* Preview */}
        <div className="border rounded p-3 text-sm bg-gray-50">
          <span className="mr-6">Nights: <b>{nights}</b></span>
          <span>Preview total: <b>${previewTotal.toFixed(2)}</b></span>
          <div className="text-xs text-gray-500 mt-1">
            Total is computed in the database from subtotal + tax. Nights are generated from check-in/out.
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
          >
            {isSubmitting ? 'Saving…' : 'Save invoice'}
          </button>
          {/* NEW: Cancel button to go back to invoices */}
          <button
            type="button"
            onClick={() => router.push('/invoices')}
            className="rounded border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  )
}
