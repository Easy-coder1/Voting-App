import { supabase } from './supabase.js';

export function showAlert(type, message) {
    const container = document.getElementById('alert-container');
    const msgEl = document.getElementById('alert-message');
    
    if (!container || !msgEl) return;
    
    container.classList.remove('hidden', 'bg-red-50', 'bg-green-50');
    msgEl.classList.remove('text-red-800', 'text-green-800');
    
    if (type === 'error') {
        container.classList.add('bg-red-50');
        msgEl.classList.add('text-red-800');
    } else {
        container.classList.add('bg-green-50');
        msgEl.classList.add('text-green-800');
    }
    
    msgEl.textContent = message;
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = 'Signing in...';

            const email = document.getElementById('email-address').value;
            const password = document.getElementById('password').value;

            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error) {
                    showAlert('error', error.message);
                    btn.disabled = false;
                    btn.textContent = 'Sign in';
                    return;
                }

                // Fetch profile to determine role
                btn.textContent = 'Loading profile...';
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', data.user.id)
                    .single();

                if (profileError || !profile) {
                    // Profile may not exist yet — wait briefly and retry once
                    await new Promise(r => setTimeout(r, 1500));
                    const { data: retryProfile, error: retryError } = await supabase
                        .from('profiles')
                        .select('role')
                        .eq('id', data.user.id)
                        .single();

                    if (retryError || !retryProfile) {
                        showAlert('error', 'Your account profile could not be found. Please contact the administrator.');
                        await supabase.auth.signOut();
                        btn.disabled = false;
                        btn.textContent = 'Sign in';
                        return;
                    }

                    // Redirect based on retried profile
                    if (retryProfile.role === 'admin') {
                        window.location.href = '/pages/admin/dashboard.html';
                    } else {
                        window.location.href = '/pages/member/dashboard.html';
                    }
                    return;
                }

                // Redirect based on role
                if (profile.role === 'admin') {
                    window.location.href = '/pages/admin/dashboard.html';
                } else {
                    window.location.href = '/pages/member/dashboard.html';
                }
            } catch (err) {
                showAlert('error', 'An unexpected error occurred: ' + err.message);
                btn.disabled = false;
                btn.textContent = 'Sign in';
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = 'Registering...';
            
            const name = document.getElementById('full-name').value;
            const email = document.getElementById('email-address').value;
            const phone = document.getElementById('phone-number').value;
            const password = document.getElementById('password').value;
            
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: name,
                        phone: phone,
                    }
                }
            });
            
            if (error) {
                showAlert('error', error.message);
                btn.disabled = false;
                btn.textContent = 'Complete Registration';
            } else {
                showAlert('success', 'Registration successful! Please check your email for verification. Or login if email verification is off.');
                // Redirect to login after a short delay
                setTimeout(() => {
                    window.location.href = '/pages/login.html';
                }, 3000);
            }
        });
    }
});
