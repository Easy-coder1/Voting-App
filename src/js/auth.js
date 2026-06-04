import { supabase } from './supabase.js';

export function showAlert(type, message) {
    const container = document.getElementById('alert-container');
    const msgEl = document.getElementById('alert-message');

    if (!container || !msgEl) return;

    container.classList.remove('hidden', 'bg-red-50', 'bg-green-50', 'bg-yellow-50');
    msgEl.classList.remove('text-red-800', 'text-green-800', 'text-yellow-800');

    if (type === 'error') {
        container.classList.add('bg-red-50');
        msgEl.classList.add('text-red-800');
    } else if (type === 'warning') {
        container.classList.add('bg-yellow-50');
        msgEl.classList.add('text-yellow-800');
    } else {
        container.classList.add('bg-green-50');
        msgEl.classList.add('text-green-800');
    }

    msgEl.textContent = message;
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    // ── LOGIN ──────────────────────────────────────────────────────────────
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = 'Signing in...';

            const email = document.getElementById('email-address').value.trim();
            const password = document.getElementById('password').value;

            try {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });

                if (error) {
                    let msg = error.message;
                    if (
                        msg.toLowerCase().includes('email not confirmed') ||
                        msg.toLowerCase().includes('email_not_confirmed')
                    ) {
                        showAlert('warning',
                            'Your email address has not been confirmed yet. ' +
                            'Please check your inbox (and spam folder) for a confirmation link from Supabase, ' +
                            'then try logging in again.');
                    } else if (
                        msg.toLowerCase().includes('invalid login credentials') ||
                        msg.toLowerCase().includes('invalid_credentials')
                    ) {
                        showAlert('error', 'Incorrect email or password. Please try again.');
                    } else {
                        showAlert('error', msg);
                    }
                    btn.disabled = false;
                    btn.textContent = 'Sign in';
                    return;
                }

                // Login succeeded — fetch profile to determine which dashboard to go to
                btn.textContent = 'Loading profile...';
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', data.user.id)
                    .single();

                if (profileError || !profile) {
                    // Profile row may still be creating via DB trigger — wait 1.5s and retry
                    await new Promise(r => setTimeout(r, 1500));
                    const { data: retryProfile, error: retryError } = await supabase
                        .from('profiles')
                        .select('role')
                        .eq('id', data.user.id)
                        .single();

                    if (retryError || !retryProfile) {
                        showAlert('error',
                            'Login succeeded but your account profile could not be found. ' +
                            'This usually means the database trigger did not run. ' +
                            'Please contact the administrator.');
                        await supabase.auth.signOut();
                        btn.disabled = false;
                        btn.textContent = 'Sign in';
                        return;
                    }

                    window.location.href = retryProfile.role === 'admin'
                        ? '/pages/admin/dashboard.html'
                        : '/pages/member/dashboard.html';
                    return;
                }

                window.location.href = profile.role === 'admin'
                    ? '/pages/admin/dashboard.html'
                    : '/pages/member/dashboard.html';

            } catch (err) {
                showAlert('error', 'Unexpected error: ' + err.message);
                btn.disabled = false;
                btn.textContent = 'Sign in';
            }
        });
    }

    // ── REGISTER ───────────────────────────────────────────────────────────
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = 'Registering...';

            const name  = document.getElementById('full-name').value.trim();
            const email = document.getElementById('email-address').value.trim();
            const phone = document.getElementById('phone-number').value.trim();
            const password = document.getElementById('password').value;

            try {
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
                    return;
                }

                if (data.session) {
                    // Email confirmation is OFF — user is logged in immediately

                    // Fallback: manually create profile if the DB trigger didn't fire
                    const { error: profileCheckError, data: existingProfile } = await supabase
                        .from('profiles')
                        .select('id')
                        .eq('id', data.user.id)
                        .single();

                    if (profileCheckError || !existingProfile) {
                        // Trigger didn't run — insert the profile manually
                        const { error: insertError } = await supabase
                            .from('profiles')
                            .insert([{
                                id: data.user.id,
                                full_name: name || 'Member',
                                email: email,
                                phone: phone || null,
                            }]);

                        if (insertError) {
                            console.error('Profile creation fallback failed:', insertError.message);
                            // Still proceed — user is authenticated, profile may appear via trigger shortly
                        }
                    }

                    showAlert('success', 'Registration successful! Redirecting to your dashboard...');
                    setTimeout(() => {
                        window.location.href = '/pages/member/dashboard.html';
                    }, 1500);

                } else if (data.user && !data.session) {
                    // Email confirmation is ON — user must verify their email before they can log in
                    showAlert('success',
                        'Registration submitted! Please check your email inbox (and spam folder) ' +
                        'for a confirmation link. You can log in after confirming your email address.');
                    btn.textContent = 'Check your email';
                    // Do not redirect — let the user read the message
                } else {
                    showAlert('warning', 'Registration may have succeeded. Please try logging in.');
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 3000);
                }

            } catch (err) {
                showAlert('error', 'Unexpected error: ' + err.message);
                btn.disabled = false;
                btn.textContent = 'Complete Registration';
            }
        });
    }
});
