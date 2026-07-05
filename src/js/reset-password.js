import { supabase } from './supabase.js';
import { redirectPasswordRecoveryToResetPage } from './authRecovery.js';
import { showAlert } from './auth.js';

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

async function waitForRecoverySession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      subscription.unsubscribe();
      resolve(value);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && sess) {
        finish(true);
      }
    });

    setTimeout(() => finish(false), 8000);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (redirectPasswordRecoveryToResetPage()) return;

  const form = document.getElementById('reset-password-form');
  const ready = await waitForRecoverySession();

  if (!ready) {
    showInvalidLink(
      'This password reset link is invalid or has expired. Please request a new link from the sign-in page.'
    );
    return;
  }

  showForm();

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
