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

// ── STORAGE HELPERS (safe wrappers — some mobile browsers block storage) ─────
const _TOKEN_KEY   = 'insforge_access_token';
const _REFRESH_KEY = 'insforge_refresh_token';
const _USER_KEY    = 'insforge_user';

function _tryWrite(store, key, val) {
  try { store.setItem(key, val); return true; } catch { return false; }
}
function _tryRead(store, key) {
  try { return store.getItem(key); } catch { return null; }
}
function _tryRemove(store, key) {
  try { store.removeItem(key); } catch {}
}

// Feed a refresh token back into the SDK's HttpClient so it can silently
// re-issue access tokens on its own, without needing the cross-origin cookie.
function _applyRefreshToken(refreshToken) {
  try {
    // TypeScript marks `http` as private but it's just a regular JS property.
    insforge.auth['http']?.setRefreshToken?.(refreshToken);
  } catch { /* ignore if SDK internals change */ }
}

// Save the full session (access token + refresh token + user) to storage.
// sessionStorage is tried first — it's per-tab, first-party, and NEVER
// blocked by mobile Tracking Prevention. localStorage is saved as well for
// persistence across tabs / app restarts (best-effort; may be blocked).
export function saveLocalSession(accessToken, refreshToken, user) {
  const userStr = JSON.stringify(user);
  if (typeof window !== 'undefined') {
    _tryWrite(sessionStorage, _TOKEN_KEY,   accessToken);
    _tryWrite(sessionStorage, _USER_KEY,    userStr);
    _tryWrite(localStorage,   _TOKEN_KEY,   accessToken);
    _tryWrite(localStorage,   _USER_KEY,    userStr);
    if (refreshToken) {
      _tryWrite(sessionStorage, _REFRESH_KEY, refreshToken);
      _tryWrite(localStorage,   _REFRESH_KEY, refreshToken);
    }
  }
  insforge.tokenManager.saveSession({ accessToken, user });
  insforge.setAccessToken(accessToken);
  if (refreshToken) _applyRefreshToken(refreshToken);
}

// Clear the session from every storage layer.
export function clearLocalSession() {
  if (typeof window !== 'undefined') {
    _tryRemove(sessionStorage, _TOKEN_KEY);
    _tryRemove(sessionStorage, _REFRESH_KEY);
    _tryRemove(sessionStorage, _USER_KEY);
    _tryRemove(localStorage,   _TOKEN_KEY);
    _tryRemove(localStorage,   _REFRESH_KEY);
    _tryRemove(localStorage,   _USER_KEY);
  }
  insforge.setAccessToken(null);
}

// Restore session on startup (runs on every page load).
// With the refresh token restored, the SDK can silently renew expired access
// tokens by itself — no cookie required.
export function restoreLocalSession() {
  if (typeof window === 'undefined') return null;

  const accessToken   = _tryRead(sessionStorage, _TOKEN_KEY)   || _tryRead(localStorage, _TOKEN_KEY);
  const refreshToken  = _tryRead(sessionStorage, _REFRESH_KEY) || _tryRead(localStorage, _REFRESH_KEY);
  const userStr       = _tryRead(sessionStorage, _USER_KEY)    || _tryRead(localStorage, _USER_KEY);

  if (accessToken && userStr) {
    try {
      const user = JSON.parse(userStr);
      insforge.tokenManager.saveSession({ accessToken, user });
      insforge.setAccessToken(accessToken);
      if (refreshToken) _applyRefreshToken(refreshToken);
      return { accessToken, refreshToken, user };
    } catch {
      clearLocalSession();
    }
  }
  return null;
}

// Auto-restore on every page load
restoreLocalSession();

export async function waitForUser() {
    for (let i = 0; i < 10; i++) {
        const result = await insforge.auth.getCurrentUser();
        if (result.data?.user) return result;
        await new Promise(r => setTimeout(r, 200));
    }
    return await insforge.auth.getCurrentUser();
}
