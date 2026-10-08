// Short feedback messages ("Saved", "Request failed") in the bottom corner.
// Separate from NotificationToast, which shows robot notifications and acknowledges them on the server.

const ICONS = {
    success: '<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>',
    warning: '<path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/>',
};
ICONS.danger = ICONS.warning;

/**
 * @param {string} message
 * @param {'success' | 'warning' | 'danger'} variant
 */
export function showToast(message, variant = 'success') {
    const stack = document.getElementById('toast-stack');
    const element = document.createElement('div');
    element.className = `toast toast-${variant}`;
    element.role = variant === 'success' ? 'status' : 'alert';
    element.innerHTML = `
        <div class="toast-body toast-message">
            <svg class="bi toast-icon" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">${ICONS[variant]}</svg>
            <span class="flex-grow-1"></span>
            <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>`;
    element.querySelector('span').textContent = message;
    stack.append(element);

    element.addEventListener('hidden.bs.toast', () => element.remove());
    bootstrap.Toast.getOrCreateInstance(element, { delay: variant === 'success' ? 2500 : 6000 }).show();
}

/** Logs the error and tells the user that `action` failed. */
export function showError(action, error) {
    console.error(error);
    showToast(`${action} failed. ${error?.message ?? ''}`.trim(), 'danger');
}
