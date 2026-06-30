import { supabase, isMisconfigured, getCurrentUser, signOut, ensureProfile, profileErrorMessage } from './supabase.js';

// ── PASSWORD TOGGLE ──────────────────────────────────────────────────────
function initPasswordToggles() {
    document.querySelectorAll('[id^="toggle-password"]').forEach(btn => {
        btn.addEventListener('click', () => {
            // Determine the target input: the sibling input[type=password] or input[type=text] in the same .relative container
            const container = btn.closest('.relative');
            const input = container?.querySelector('input[type="password"], input[type="text"]');
            if (!input) return;

            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');

            // Toggle icon: swap eye for eye-off
            const icon = btn.querySelector('svg');
            if (icon) {
                if (isPassword) {
                    // Eye-off icon
                    icon.innerHTML = `
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
                    `;
                } else {
                    // Eye icon
                    icon.innerHTML = `
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                    `;
                }
            }
        });
    });
}

// ── INLINE FIELD ERRORS ────────────────────────────────────────────────
function showFieldError(inputEl, message) {
    clearFieldError(inputEl);
    inputEl.classList.add('field-error');

    const errorEl = document.createElement('p');
    errorEl.className = 'field-error-text';
    errorEl.textContent = message;
    errorEl.id = `error-${inputEl.id || Math.random().toString(36).slice(2, 9)}`;
    inputEl.setAttribute('aria-invalid', 'true');
    inputEl.setAttribute('aria-describedby', errorEl.id);

    // Insert after the parent .relative container, or after input itself
    const container = inputEl.closest('.relative') || inputEl.parentElement;
    if (container) {
        container.after(errorEl);
    } else {
        inputEl.after(errorEl);
    }
}

function clearFieldError(inputEl) {
    inputEl.classList.remove('field-error');
    inputEl.removeAttribute('aria-invalid');
    inputEl.removeAttribute('aria-describedby');

    // Remove sibling error text
    const container = inputEl.closest('.relative') || inputEl.parentElement;
    if (container) {
        const next = container.nextElementSibling;
        if (next && next.classList.contains('field-error-text')) {
            next.remove();
        }
    }
}

function clearAllFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(el => clearFieldError(el));
}

// ── TOP ALERT ──────────────────────────────────────────────────────────
export function showAlert(type, message) {
    const container = document.getElementById('alert-container');
    const msgEl = document.getElementById('alert-message');
    const iconContainer = document.getElementById('alert-icon-container');

    if (!container || !msgEl) return;

    // Reset all themed classes (light surfaces tuned to the Sacred Flame palette)
    container.classList.remove(
        'hidden',
        'bg-red-50', 'border-red-200', 'text-red-800',
        'bg-emerald-50', 'border-emerald-200', 'text-emerald-800',
        'bg-amber-50', 'border-amber-200', 'text-amber-800'
    );

    let iconHtml = '';

    if (type === 'error') {
        container.classList.add('bg-red-50', 'border-red-200', 'text-red-800');
        iconHtml = `<svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    } else if (type === 'warning') {
        container.classList.add('bg-amber-50', 'border-amber-200', 'text-amber-800');
        iconHtml = `<svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
    } else {
        container.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-800');
        iconHtml = `<svg class="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    }

    if (iconContainer) {
        iconContainer.innerHTML = iconHtml;
    }
    msgEl.textContent = message;
    container.classList.remove('hidden');
}

// ── SUBMIT BUTTON LOADING STATE ────────────────────────────────────────
function setLoading(btn, loading, text) {
    const textEl = document.getElementById('submit-btn-text');
    const spinnerEl = document.getElementById('submit-btn-spinner');
    if (!btn) return;

    if (loading) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        if (textEl) textEl.textContent = text;
        if (spinnerEl) spinnerEl.classList.remove('hidden');
    } else {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        if (textEl) textEl.textContent = text;
        if (spinnerEl) spinnerEl.classList.add('hidden');
    }
}

// ── CLIENT-SIDE VALIDATION ─────────────────────────────────────────────
function validateLoginForm(email, password) {
    let isValid = true;
    const emailInput = document.getElementById('email-address');
    const passwordInput = document.getElementById('password');

    clearAllFieldErrors(document.getElementById('login-form'));

    if (!email) {
        showFieldError(emailInput, 'Email address is required.');
        isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
        showFieldError(emailInput, 'Please enter a valid email address.');
        isValid = false;
    }

    if (!password) {
        showFieldError(passwordInput, 'Password is required.');
        isValid = false;
    }

    return isValid;
}

function validateRegisterForm(firstName, lastName, email, password, verifyPassword) {
    let isValid = true;
    const firstNameInput = document.getElementById('first-name');
    const lastNameInput = document.getElementById('last-name');
    const emailInput = document.getElementById('email-address');
    const passwordInput = document.getElementById('password');
    const verifyInput = document.getElementById('verify-password');

    clearAllFieldErrors(document.getElementById('register-form'));

    if (!firstName) {
        showFieldError(firstNameInput, 'First name is required.');
        isValid = false;
    }

    if (!lastName) {
        showFieldError(lastNameInput, 'Last name is required.');
        isValid = false;
    }

    if (!email) {
        showFieldError(emailInput, 'Email address is required.');
        isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
        showFieldError(emailInput, 'Please enter a valid email address.');
        isValid = false;
    }

    if (!password) {
        showFieldError(passwordInput, 'Password is required.');
        isValid = false;
    } else if (password.length < 6) {
        showFieldError(passwordInput, 'Password must be at least 6 characters.');
        isValid = false;
    }

    if (!verifyPassword) {
        showFieldError(verifyInput, 'Please verify your password.');
        isValid = false;
    } else if (password !== verifyPassword) {
        showFieldError(verifyInput, 'Passwords do not match.');
        isValid = false;
    }

    return isValid;
}

// ── LOGIN ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Init password toggles
    initPasswordToggles();

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    // ── CONFIG CHECK ────────────────────────────────────────────────────────
    if (isMisconfigured) {
        const container = document.getElementById('alert-container');
        const msgEl = document.getElementById('alert-message');
        const iconContainer = document.getElementById('alert-icon-container');

        if (container && msgEl && iconContainer) {
            container.classList.remove('hidden');
            container.classList.add('bg-red-50', 'border-red-200', 'text-red-800');
            iconContainer.innerHTML = '<svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
            msgEl.textContent = 'App is not configured: Supabase environment variables are missing. Contact the administrator.';
        }

        const btn = document.getElementById('submit-btn');
        const textEl = document.getElementById('submit-btn-text');
        if (btn) {
            btn.disabled = true;
            if (textEl) textEl.textContent = 'Configuration Error';
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    // ── LOGIN ──────────────────────────────────────────────────────────────
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');

            const email = document.getElementById('email-address').value.trim();
            const password = document.getElementById('password').value;

            // Client-side validation
            if (!validateLoginForm(email, password)) {
                return;
            }

            setLoading(btn, true, 'Signing in...');

            try {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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
                            'Please check your inbox (and spam folder) for a confirmation link from Supabase, ' +
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
                    setLoading(btn, false, 'Sign in');
                    return;
                }

                if (data.session) {
                    await supabase.auth.setSession(data.session);
                }

                setLoading(btn, true, 'Loading profile...');

                const sessionUser = data.user;
                if (!sessionUser) {
                    showAlert('error', 'Signed in, but the session could not be established. Please try again.');
                    setLoading(btn, false, 'Sign in');
                    return;
                }

                const { profile, error: profileError } = await ensureProfile(sessionUser);

                if (!profile) {
                    console.error('Could not load or create profile for user:', sessionUser.id, profileError);
                    showAlert('error', profileErrorMessage(profileError));
                    setLoading(btn, false, 'Sign in');
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
                setLoading(btn, false, 'Sign in');
            }
        });
    }

    // ── REGISTER ───────────────────────────────────────────────────────────
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');

            const firstName = document.getElementById('first-name').value.trim();
            const lastName  = document.getElementById('last-name').value.trim();
            const email = document.getElementById('email-address').value.trim();
            const password = document.getElementById('password').value;
            const verifyPassword = document.getElementById('verify-password').value;

            // Client-side validation
            if (!validateRegisterForm(firstName, lastName, email, password, verifyPassword)) {
                return;
            }

            setLoading(btn, true, 'Registering...');

            const name = `${firstName} ${lastName}`.trim();

            try {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { full_name: name },
                    },
                });

                if (error) {
                    const msg = (error.message || '').toLowerCase();
                    if (msg.includes('failed to fetch') || msg.includes('network')) {
                        showAlert('error', 'Could not reach Supabase. Check that VITE_SUPABASE_URL in .env.local matches your project (https://<ref>.supabase.co) and restart the dev server.');
                    } else {
                        showAlert('error', error.message);
                    }
                    setLoading(btn, false, 'Complete Registration');
                    return;
                }

                if (data.session) {
                    await supabase.auth.setSession(data.session);
                    await ensureProfile(data.user);

                    showAlert('success', 'Registration successful! Please sign in to continue.');
                    await signOut();
                    setLoading(btn, false, 'Complete Registration');
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 1500);

                } else if (data.user && !data.session) {
                    // Email confirmation is ON
                    showAlert('success',
                        'Registration submitted! Please check your email inbox (and spam folder) ' +
                        'for a confirmation link.');
                    setLoading(btn, false, 'Check your email');
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 3000);
                } else {
                    showAlert('warning', 'Registration may have succeeded. Please try logging in.');
                    setLoading(btn, false, 'Complete Registration');
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 3000);
                }

            } catch (err) {
                console.error('Registration error:', err);
                showAlert('error', 'Unexpected error: ' + err.message);
                setLoading(btn, false, 'Complete Registration');
            }
        });
    }
});