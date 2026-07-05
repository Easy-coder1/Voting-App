const RESET_PASSWORD_PATH = '/pages/reset-password.html';

/** True when the URL hash is a Supabase password-recovery callback. */
export function isPasswordRecoveryCallback() {
    if (typeof window === 'undefined') return false;
    const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
    if (!hash) return false;
    return new URLSearchParams(hash).get('type') === 'recovery';
}

/**
 * Supabase often redirects to the Site URL root (e.g. localhost:3000/) with tokens
 * in the hash. Send those links to the reset page before auth routing runs.
 * @returns {boolean} true when a redirect was started
 */
export function redirectPasswordRecoveryToResetPage() {
    if (typeof window === 'undefined') return false;
    if (!isPasswordRecoveryCallback()) return false;
    if (window.location.pathname === RESET_PASSWORD_PATH) return false;

    window.location.replace(`${RESET_PASSWORD_PATH}${window.location.hash}`);
    return true;
}

export function getPasswordResetRedirectUrl() {
    return `${window.location.origin}${RESET_PASSWORD_PATH}`;
}
