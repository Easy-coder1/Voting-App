import { supabase } from './supabase.js';
import { showAlert } from './auth.js';

function initPasswordToggles() {
  document.querySelectorAll('button[data-password-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const container = btn.closest('.m-field');
      const input = container?.querySelector('input[data-password-input]');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  });
}

function setLoading(loading) {
  const btn = document.getElementById('submit-btn');
  const textEl = document.getElementById('submit-btn-text');
  const spinnerEl = document.getElementById('submit-btn-spinner');
  if (!btn) return;
  btn.disabled = loading;
  if (textEl) textEl.textContent = loading ? 'Updating…' : 'Update password';
  if (spinnerEl) spinnerEl.classList.toggle('hidden', !loading);
}

function showForm() {
  document.getElementById('reset-loading')?.classList.add('hidden');
  document.getElementById('reset-password-form')?.classList.remove('hidden');
}

function showInvalidLink(message) {
  document.getElementById('reset-loading')?.classList.add('hidden');
  showAlert('error', message);
}

document.addEventListener('DOMContentLoaded', async () => {
  initPasswordToggles();

  const form = document.getElementById('reset-password-form');
  let ready = false;

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    ready = true;
    showForm();
  }

  if (!ready) {
    await new Promise((resolve) => {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
        if (event === 'PASSWORD_RECOVERY' && sess) {
          ready = true;
          showForm();
          subscription.unsubscribe();
          resolve();
        }
      });
      setTimeout(() => {
        subscription.unsubscribe();
        resolve();
      }, 4000);
    });
  }

  if (!ready) {
    showInvalidLink(
      'This password reset link is invalid or has expired. Please request a new link from the sign-in page.'
    );
    return;
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('new-password').value;
    const verify = document.getElementById('verify-password').value;

    if (password.length < 6) {
      showAlert('error', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== verify) {
      showAlert('error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      showAlert('error', error.message || 'Could not update password. Please try again.');
      return;
    }

    showAlert('success', 'Password updated! Redirecting you to sign in…');
    await supabase.auth.signOut();
    setTimeout(() => {
      window.location.href = '/pages/login.html';
    }, 2000);
  });
});
