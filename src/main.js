import './style.css'
import { supabase } from './js/supabase.js'

// Simple auth state listener to redirect appropriately
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession()
    
    // Check if we are on the landing page and have a session
    if (session && window.location.pathname === '/') {
        // Fetch role from profile using maybeSingle (doesn't throw on no rows)
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle()
            
        if (profile?.role === 'admin') {
            window.location.href = '/pages/admin/dashboard.html'
        } else if (profile?.role === 'member') {
            window.location.href = '/pages/member/dashboard.html'
        }
        // If no profile yet, stay on landing page — user can click Login
    }
})
