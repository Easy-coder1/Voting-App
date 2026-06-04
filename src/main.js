import './style.css'
import { supabase } from './js/supabase.js'

// Simple auth state listener to redirect appropriately
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession()
    
    // Check if we are on the landing page and have a session
    if (session && window.location.pathname === '/') {
        // Fetch role from profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .single()
            
        if (profile?.role === 'admin') {
            window.location.href = '/pages/admin/dashboard.html'
        } else {
            window.location.href = '/pages/member/dashboard.html'
        }
    }
})
