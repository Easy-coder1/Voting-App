import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  const msg = 'CONFIGURATION ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. ' +
              'Please add them in your Vercel project settings under Environment Variables.';
  console.error(msg);
  // Display a visible error banner on the page instead of silently failing
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;padding:12px 20px;font-weight:bold;text-align:center;font-family:sans-serif;';
    banner.textContent = '⚠️ App configuration error: Supabase environment variables are not set. Contact the administrator.';
    document.body.prepend(banner);
  });
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-key'
)
