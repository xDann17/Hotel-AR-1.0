import { createClient } from '@supabase/supabase-js'

// ❗ Never import this into client components.
// Used only in Next.js route handlers / server actions.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,   // service role
  { auth: { autoRefreshToken: false, persistSession: false } }
)
