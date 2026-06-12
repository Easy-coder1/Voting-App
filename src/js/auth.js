import { insforge, isMisconfigured, saveLocalSession } from './insforge.js';

// ── PASSWORD TOGGLE ──────────────────────────────────────────────────────
function initPasswordToggles() {
    document.querySelectorAll('[id^="toggle-password"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const container = btn.closest('.app-input-wrap');
            const input = container?.querySelector('input[type="password"], input[type="text"]');
            if (!input) return;

            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');

            const icon = btn.querySelector('svg, i');
            if (icon) {
                const iconId = icon.id || '';
                const iconClass = typeof icon.className === 'string' ? icon.className : icon.className.baseVal || '';
                if (isPassword) {
                    icon.outerHTML = `<i data-lucide="eye" id="${iconId}" class="${iconClass.replace('lucide lucide-eye-off', '').replace('lucide lucide-eye', '')}"></i>`;
                } else {
                    icon.outerHTML = `<i data-lucide="eye-off" id="${iconId}" class="${iconClass.replace('lucide lucide-eye-off', '').replace('lucide lucide-eye', '')}"></i>`;
                }
            }
        });
    });
}

// ── INLINE FIELD ERRORS ────────────────────────────────────────────────
function showFieldError(inputEl, message) {
    clearFieldError(inputEl);
    inputEl.classList.add('app-input-error');

    const errorEl = document.createElement('p');
    errorEl.className = 'app-input-error-text';
    errorEl.textContent = message;
    errorEl.id = `error-${inputEl.id || Math.random().toString(36).slice(2, 9)}`;
    inputEl.setAttribute('aria-invalid', 'true');
    inputEl.setAttribute('aria-describedby', errorEl.id);

    const container = inputEl.closest('.app-input-wrap') || inputEl.parentElement;
    if (container) {
        container.after(errorEl);
    } else {
        inputEl.after(errorEl);
    }
}

function clearFieldError(inputEl) {
    inputEl.classList.remove('app-input-error');
    inputEl.removeAttribute('aria-invalid');
    inputEl.removeAttribute('aria-describedby');

    const container = inputEl.closest('.app-input-wrap') || inputEl.parentElement;
    if (container) {
        const next = container.nextElementSibling;
        if (next && next.classList.contains('app-input-error-text')) {
            next.remove();
        }
    }
}

function clearAllFieldErrors(form) {
    form.querySelectorAll('.app-input-error').forEach(el => clearFieldError(el));
}

// ── TOP ALERT ──────────────────────────────────────────────────────────
export function showAlert(type, message) {
    const container = document.getElementById('alert-container');
    const msgEl = document.getElementById('alert-message');
    const iconContainer = document.getElementById('alert-icon-container');

    if (!container || !msgEl) return;

    // Reset classes
    container.className = 'app-alert mt-6';

    let iconHtml = '';

    if (type === 'error') {
        container.classList.add('app-alert-error', 'visible');
        iconHtml = `<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>`;
    } else if (type === 'warning') {
        container.classList.add('app-alert-warning', 'visible');
        iconHtml = `<i data-lucide="alert-triangle" class="w-5 h-5 text-amber-400"></i>`;
    } else {
        container.classList.add('app-alert-success', 'visible');
        iconHtml = `<i data-lucide="check-circle" class="w-5 h-5 text-emerald-400"></i>`;
    }

    if (iconContainer) {
        iconContainer.innerHTML = iconHtml;
    }
    msgEl.textContent = message;
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

// ── PROFILE ────────────────────────────────────────────────────────────
async function ensureProfile(user) {
    const { data: profile, error: fetchError } = await insforge.database
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (fetchError) {
        console.error('Profile fetch error:', fetchError);
    }

    if (profile) return profile;

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

    const { data: newProfile } = await insforge.database
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    return newProfile || null;
}

document.addEventListener('DOMContentLoaded', () => {
    initPasswordToggles();

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    // ── CONFIG CHECK ────────────────────────────────────────────────────────
    if (isMisconfigured) {
        const container = document.getElementById('alert-container');
        const msgEl = document.getElementById('alert-message');
        const iconContainer = document.getElementById('alert-icon-container');

        if (container && msgEl && iconContainer) {
            container.className = 'app-alert app-alert-error visible mt-6';
            iconContainer.innerHTML = '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-400"></i>';
            msgEl.textContent = 'App is not configured: InsForge environment variables are missing. Contact the administrator.';
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

            if (!validateLoginForm(email, password)) {
                return;
            }

            setLoading(btn, true, 'Signing in...');

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
                    setLoading(btn, false, 'Sign in');
                    return;
                }

                if (data?.accessToken && data?.user) {
                    saveLocalSession(data.accessToken, data.refreshToken ?? null, data.user);
                }

                setLoading(btn, true, 'Loading profile...');

                const sessionUser = data.user;
                if (!sessionUser) {
                    showAlert('error', 'Signed in, but the session could not be established. Please try again.');
                    setLoading(btn, false, 'Sign in');
                    return;
                }

                const profile = await ensureProfile(sessionUser);

                if (!profile) {
                    console.error('Could not load or create profile for user:', sessionUser.id);
                    showAlert('error', 'Could not load your profile. Please try registering again or contact support.');
                    setLoading(btn, false, 'Sign in');
                    return;
                }

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

            if (!validateRegisterForm(firstName, lastName, email, password, verifyPassword)) {
                return;
            }

            setLoading(btn, true, 'Registering...');

            const name = `${firstName} ${lastName}`.trim();

            try {
                const { data, error } = await insforge.auth.signUp({
                    email,
                    password,
                    name: name,
                });

                if (error) {
                    showAlert('error', error.message);
                    setLoading(btn, false, 'Complete Registration');
                    return;
                }

                if (data.session) {
                    await ensureProfile(data.user);

                    showAlert('success', 'Registration successful! Please sign in to continue.');
                    await insforge.auth.signOut();
                    setLoading(btn, false, 'Complete Registration');
                    setTimeout(() => {
                        window.location.href = '/pages/login.html';
                    }, 1500);

                } else if (data.user && !data.session) {
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