import { createClient } from '@insforge/sdk'

const insforgeUrl = import.meta.env.VITE_INSFORGE_URL
const insforgeAnonKey = import.meta.env.VITE_INSFORGE_ANON_KEY

const isConfigMissing = !insforgeUrl || !insforgeAnonKey

if (isConfigMissing) {
  console.error(
    'CONFIGURATION ERROR: VITE_INSFORGE_URL and VITE_INSFORGE_ANON_KEY are not set. ' +
    'Add them to .env.local (local dev) or the Vercel project settings → Environment Variables.'
  )
}

// Always expose this flag so downstream code (auth, dashboard) can check at runtime
export const isMisconfigured = isConfigMissing

export const insforge = createClient({
  baseUrl: insforgeUrl ?? 'https://placeholder.insforge.app',
  anonKey: insforgeAnonKey ?? 'placeholder-key'
})
