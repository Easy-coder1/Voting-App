import { createClient } from '@insforge/sdk'

const insforgeUrl = import.meta.env.VITE_INSFORGE_URL
const insforgeAnonKey = import.meta.env.VITE_INSFORGE_ANON_KEY

if (!insforgeUrl || !insforgeAnonKey) {
  const msg = 'CONFIGURATION ERROR: VITE_INSFORGE_URL and VITE_INSFORGE_ANON_KEY are not set. ' +
              'Please add them in your Vercel project settings under Environment Variables.';
  console.error(msg);
  // Display a visible error banner on the page instead of silently failing
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;padding:12px 20px;font-weight:bold;text-align:center;font-family:sans-serif;';
    banner.textContent = '⚠️ App configuration error: InsForge environment variables are not set. Contact the administrator.';
    document.body.prepend(banner);
  });
}

export const insforge = createClient({
  baseUrl: insforgeUrl ?? 'https://placeholder.insforge.app',
  anonKey: insforgeAnonKey ?? 'placeholder-key'
})