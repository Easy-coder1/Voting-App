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

async function ensureProfile(user) {
    // Try to fetch the existing profile
    const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (fetchError) {
        console.error('Profile fetch error:', fetchError);
    }

    if (profile) return profile;

    // No profile found — create one from user metadata
    console.log('No profile found for user, creating one...');
    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
    const phone = user.user_metadata?.phone || null;

    const { error: insertError } = await supabase
        .from('profiles')
        .insert([{
            id: user.id,
            full_name: fullName,
            email: user.email || '',
            phone: phone,
        }]);

    if (insertError) {
        console.error('Profile insert error:', insertError.message);
        return null;
    }

    // Fetch the newly created profile
    const { data: newProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    return newProfile || null;
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

                btn.textContent = 'Loading profile...';

                // Ensure profile exists
                const profile = await ensureProfile(data.user);

                if (!profile) {
                    console.error('Could not load or create profile for user:', data.user.id);
                    showAlert('error', 'Could not load your profile. Please try registering again or contact support.');
                    btn.disabled = false;
                    btn.textContent = 'Sign in';
                    return;
                }

                // Redirect based on role
                const dashboard = profile.role === 'admin'
                    ? '/pages/admin/dashboard.html'
                    : '/pages/member/dashboard.html';
                window.location.href = dashboard;

            } catch (err) {
                console.error('Login error:', err);
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

                    // Ensure profile gets created
                    await ensureProfile(data.user);

                    showAlert('success', 'Registration successful! Please sign in to continue.');
                    // Sign out so they can log in fresh
                    await supabase.auth.signOut();
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 1500);

                } else if (data.user && !data.session) {
                    // Email confirmation is ON
                    showAlert('success',
                        'Registration submitted! Please check your email inbox (and spam folder) ' +
                        'for a confirmation link. You will be redirected to the login page shortly.');
                    btn.textContent = 'Check your email';
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 3000);
                } else {
                    showAlert('warning', 'Registration may have succeeded. Please try logging in.');
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 3000);
                }

            } catch (err) {
                console.error('Registration error:', err);
                showAlert('error', 'Unexpected error: ' + err.message);
                btn.disabled = false;
                btn.textContent = 'Complete Registration';
            }
        });
    }
});