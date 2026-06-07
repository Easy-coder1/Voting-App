import './style.css'
import { insforge } from './js/insforge.js'

// Simple auth state listener to redirect appropriately
document.addEventListener('DOMContentLoaded', async () => {
    const { data: currentUserData } = await insforge.auth.getCurrentUser()
    
    // Check if we are on the landing page and have a session
    if (currentUserData?.user && window.location.pathname === '/') {
        const user = currentUserData.user
        // Fetch role from profile using maybeSingle (doesn't throw on no rows)
        const { data: profile } = await insforge.database
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()
            
        if (profile?.role === 'admin') {
            window.location.href = '/pages/admin/dashboard.html'
        } else if (profile?.role === 'member') {
            window.location.href = '/pages/member/dashboard.html'
        }
        // If no profile yet, stay on landing page — user can click Login
    }
})
