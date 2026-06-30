import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isMisconfigured = !supabaseUrl || !supabaseAnonKey

if (isMisconfigured) {
  console.error(
    'CONFIGURATION ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. ' +
    'Add them to .env.local (local dev) or the Vercel project settings → Environment Variables.'
  )
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-key'
)

function normalizeUser(user) {
  if (!user) return null
  return {
    ...user,
    name: user.user_metadata?.full_name || user.user_metadata?.name || null,
  }
}

/** Drop-in replacement for the old InsForge getCurrentUser() shape. */
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  return { data: user ? { user: normalizeUser(user) } : null, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

/** Subscribe to postgres_changes on one or more public tables. */
export function subscribeToTableChanges(tables, callback) {
  let channel = supabase.channel(`changes-${tables.join('-')}`)
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      callback
    )
  }
  channel.subscribe()
  return channel
}
