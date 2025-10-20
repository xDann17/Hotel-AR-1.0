'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // If a session already exists, go straight to the dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/')
    })
  }, [router])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)

    const redirectTo = `${window.location.origin}/` // land on dashboard
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })

    setBusy(false)
    if (error) setErr(error.message)
    else setSent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#ff6f7a]">
      <div className="w-full max-w-md rounded-2xl shadow-lg bg-white p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-gray-600 mt-1">
            We’ll email you a magic link to access your dashboard.
          </p>
        </div>

        {sent ? (
          <div className="space-y-3">
            <p className="text-green-700">
              Check <b>{email}</b> for your sign-in link. It may take a minute and can land in spam.
            </p>
            <button
              className="w-full rounded-lg bg-[#11143a] text-white py-3 text-sm"
              onClick={() => setSent(false)}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-sm mb-1">Work email</label>
              <input
                type="email"
                placeholder="you@company.com"
                className="w-full border rounded-lg p-3"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            {err && <p className="text-red-600 text-sm">{err}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[#11143a] text-white py-3 text-sm font-medium disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}

        <p className="text-xs text-gray-500 mt-6">
          By continuing you agree to receive a one-time sign-in link at the email provided.
        </p>
      </div>
    </main>
  )
}
