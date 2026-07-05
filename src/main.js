import './style.css'
import { redirectPasswordRecoveryToResetPage, isPasswordRecoveryCallback } from './js/authRecovery.js'
import { supabase, getCurrentUser } from './js/supabase.js'

// Simple auth state listener to redirect appropriately
document.addEventListener('DOMContentLoaded', async () => {
    if (redirectPasswordRecoveryToResetPage()) return

    // Give the SDK a moment to rehydrate the session from localStorage on mobile
    // (localStorage writes can lag behind page navigation on slow devices)
    let currentUserData = null
    for (let i = 0; i < 10; i++) {
        const result = await getCurrentUser()
        currentUserData = result.data
        if (currentUserData?.user) break
        await new Promise(r => setTimeout(r, 200))
    }

    const preAuthPages = ['/', '/pages/login.html', '/pages/register.html']
    const authPages = ['/pages/member/dashboard.html', '/pages/admin/dashboard.html']
    const isPreAuth = preAuthPages.includes(window.location.pathname)
    const isAuthRequired = authPages.includes(window.location.pathname)
    const onResetPasswordPage = window.location.pathname === '/pages/reset-password.html'

    // Pre-auth pages: if a user is already signed in and visits the landing,
    // login, or register page, redirect them straight to their dashboard.
    // Skip during password recovery (hash tokens or dedicated reset page).
    if (currentUserData?.user && isPreAuth && !isPasswordRecoveryCallback() && !onResetPasswordPage) {
        const user = currentUserData.user
        // Fetch role from profile using maybeSingle (doesn't throw on no rows)
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

        if (profile?.role === 'admin') {
            window.location.replace('/pages/admin/dashboard.html')
        } else if (profile?.role === 'member') {
            window.location.replace('/pages/member/dashboard.html')
        }
        // If no profile yet, stay on current page — user can Login/Register
    }

    // Dashboard pages: if there is NO session (e.g. session wasn't persisted
    // on mobile, or user cleared storage), redirect back to login so the
    // dashboard doesn't appear blank or stuck.
    if (!currentUserData?.user && isAuthRequired) {
        window.location.replace('/pages/login.html')
    }
})
