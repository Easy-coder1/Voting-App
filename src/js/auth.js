import { insforge, isMisconfigured } from './insforge.js';

export function showAlert(type, message) {
    const container = document.getElementById('alert-container');
    const msgEl = document.getElementById('alert-message');
    const iconContainer = document.getElementById('alert-icon-container');

    if (!container || !msgEl) return;

    // Reset classes
    container.classList.remove('hidden', 'bg-red-950/40', 'border-red-500/20', 'text-red-300', 'bg-emerald-950/40', 'border-emerald-500/20', 'text-emerald-300', 'bg-amber-950/40', 'border-amber-500/20', 'text-amber-300');
    
    let iconHtml = '';
    
    if (type === 'error') {
        container.classList.add('bg-red-950/40', 'border-red-500/20', 'text-red-300');
        iconHtml = `<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    } else if (type === 'warning') {
        container.classList.add('bg-amber-950/40', 'border-amber-500/20', 'text-amber-300');
        iconHtml = `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
    } else {
        container.classList.add('bg-emerald-950/40', 'border-emerald-500/20', 'text-emerald-300');
        iconHtml = `<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    }

    if (iconContainer) {
        iconContainer.innerHTML = iconHtml;
    }
    msgEl.textContent = message;
    container.classList.remove('hidden');
}

async function ensureProfile(user) {
    // Try to fetch the existing profile
    const { data: profile, error: fetchError } = await insforge.database
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
    const fullName = user.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
    const phone = user.user_metadata?.phone || null;

    const { error: insertError } = await insforge.database
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
    const { data: newProfile } = await insforge.database
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    return newProfile || null;
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    // ── CONFIG CHECK ────────────────────────────────────────────────────────
    // If environment variables are missing, disable all auth forms and show a
    // prominent banner so the user knows exactly what is wrong instead of
    // hitting a vague "Unexpected error" on submit.
    if (isMisconfigured) {
        const container = document.getElementById('alert-container');
        const msgEl = document.getElementById('alert-message');
        const iconContainer = document.getElementById('alert-icon-container');

        // Re-use the existing alert UI if present
        if (container && msgEl && iconContainer) {
            container.classList.remove('hidden');
            container.classList.add('bg-red-950/40', 'border-red-500/20', 'text-red-300');
            iconContainer.innerHTML = '<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
            msgEl.textContent = 'App is not configured: InsForge environment variables are missing. Contact the administrator.';
        }

        // Disable whichever form is present
        const btn = document.getElementById('submit-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Configuration Error';
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

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
                const { data, error } = await insforge.auth.signInWithPassword({ email, password });

                if (error) {
                    const msg = (error.message || '').toLowerCase();
                    const code = (error.error || '').toLowerCase();

                    if (
                        msg.includes('email not confirmed') ||
                        msg.includes('email_not_confirmed') ||
                        code === 'email_not_confirmed' ||
                        code === 'email_not_verified'
                    ) {
                        showAlert('warning',
                            'Your email address has not been confirmed yet. ' +
                            'Please check your inbox (and spam folder) for a confirmation link from InsForge, ' +
                            'then try logging in again.');
                    } else if (
                        msg.includes('invalid login credentials') ||
                        msg.includes('invalid_credentials') ||
                        msg.includes('invalid email or password') ||
                        msg.includes('wrong password') ||
                        code === 'invalid_credentials' ||
                        code === 'invalid_email_or_password'
                    ) {
                        showAlert('error', 'Incorrect email or password. Please try again.');
                    } else if (
                        msg.includes('network') ||
                        msg.includes('failed to fetch') ||
                        msg.includes('econnrefused') ||
                        msg.includes('econnreset')
                    ) {
                        showAlert('error', 'Could not reach the authentication server. Please check your internet connection or contact support.');
                    } else {
                        showAlert('error', error.message);
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

            const firstName = document.getElementById('first-name').value.trim();
            const lastName  = document.getElementById('last-name').value.trim();
            const email = document.getElementById('email-address').value.trim();
            const password = document.getElementById('password').value;
            const verifyPassword = document.getElementById('verify-password').value;

            if (password !== verifyPassword) {
                showAlert('error', 'Passwords do not match. Please try again.');
                btn.disabled = false;
                btn.textContent = 'Complete Registration';
                return;
            }

            const name = `${firstName} ${lastName}`.trim();

            try {
                const { data, error } = await insforge.auth.signUp({
                    email,
                    password,
                    name: name,
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
                    await insforge.auth.signOut();
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 1500);

                } else if (data.user && !data.session) {
                    // Email confirmation is ON
                    showAlert('success',
                        'Registration submitted! Please check your email inbox (and spam folder) ' +
                        'for a confirmation link.');
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