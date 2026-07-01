/** Shared UI helpers — toasts, confirm dialogs, HTML escaping. */

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;

export function showToast(type, message, containerId = 'app-toast') {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'app-toast';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  container.className = 'app-toast app-toast--visible';
  container.classList.remove('app-toast--error', 'app-toast--success', 'app-toast--warning');
  container.classList.add(`app-toast--${type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'success'}`);
  container.textContent = message;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    container.classList.remove('app-toast--visible');
  }, type === 'error' ? 6000 : 4000);
}

function ensureConfirmModal() {
  let modal = document.getElementById('app-confirm-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'app-confirm-modal';
  modal.className = 'app-confirm-overlay';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="app-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title">
      <h2 id="app-confirm-title" class="app-confirm-title">Are you sure?</h2>
      <p id="app-confirm-message" class="app-confirm-message"></p>
      <div class="app-confirm-actions">
        <button type="button" id="app-confirm-cancel" class="app-confirm-cancel">Cancel</button>
        <button type="button" id="app-confirm-ok" class="app-confirm-ok">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

export function showConfirm(message, options = {}) {
  const {
    title = 'Are you sure?',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
  } = options;

  const modal = ensureConfirmModal();
  const titleEl = modal.querySelector('#app-confirm-title');
  const msgEl = modal.querySelector('#app-confirm-message');
  const cancelBtn = modal.querySelector('#app-confirm-cancel');
  const okBtn = modal.querySelector('#app-confirm-ok');
  const dialog = modal.querySelector('.app-confirm-dialog');

  titleEl.textContent = title;
  msgEl.textContent = message;
  cancelBtn.textContent = cancelLabel;
  okBtn.textContent = confirmLabel;
  okBtn.classList.toggle('app-confirm-ok--destructive', destructive);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey);
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    };

    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onBackdrop = (e) => {
      if (e.target === modal) finish(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
    };

    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    cancelBtn.focus();
  });
}

/** Trap focus inside an open modal element. Returns a cleanup function. */
export function trapFocus(modalEl) {
  const focusable = modalEl.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const onKey = (e) => {
    if (e.key !== 'Tab' || focusable.length === 0) return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  document.addEventListener('keydown', onKey);
  first?.focus();
  return () => document.removeEventListener('keydown', onKey);
}
