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

export async function confirmSignOut(message = 'Are you sure you want to sign out?') {
  if (!window.confirm(message)) return false
  const { error } = await signOut()
  if (error) {
    window.alert('Could not sign out. Please try again.')
    return false
  }
  return true
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

/** Load or create the profiles row for the signed-in auth user. */
export async function ensureProfile(user) {
  if (!user?.id) {
    return { profile: null, error: { message: 'Signed in, but no user id was returned.' } }
  }

  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) return { profile: existing, error: null }

  if (fetchError) {
    return { profile: null, error: fetchError }
  }

  const fullName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'Member'

  const { data: created, error: upsertError } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        full_name: fullName,
        email: user.email || '',
        phone: user.user_metadata?.phone || null,
      },
      { onConflict: 'id' }
    )
    .select()
    .single()

  if (upsertError) return { profile: null, error: upsertError }
  return { profile: created, error: null }
}

function profileErrorMessage(error) {
  const msg = (error?.message || '').toLowerCase()
  const code = error?.code || ''

  if (msg.includes('does not exist') || code === 'PGRST205' || code === '42P01') {
    return 'The profiles table is missing. Run supabase/migrations/20260628180000_initial_schema.sql in the Supabase SQL Editor, then try again.'
  }
  if (msg.includes('row-level security') || code === '42501') {
    return 'Could not create your profile due to database permissions. Contact the administrator.'
  }
  return error?.message || 'Could not load your profile.'
}

export { profileErrorMessage }
