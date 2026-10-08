import { get } from '../lib/http.js';

/**
 * Shows robot notifications in a Bootstrap toast. Closing the toast
 * acknowledges the notification on the server (`data-acknowledge-url`), which clears it.
 */
export class NotificationToast {
    constructor(element) {
        this.element = element;
        this.message = element.querySelector('.toast-body');
        this.toast = bootstrap.Toast.getOrCreateInstance(element);
        this.isOpen = false;

        element.addEventListener('hidden.bs.toast', () => this.acknowledge(element.dataset.acknowledgeUrl));
    }

    show(message) {
        if (this.isOpen) return;
        this.isOpen = true;
        this.message.textContent = message;
        this.toast.show();
    }

    async acknowledge(url) {
        try {
            await get(url);
        } catch (error) {
            console.error(error);
        }
        this.isOpen = false;
    }
}

/** The server sends "-" when there is no notification. */
export function notificationOf(status) {
    return status.notification && status.notification !== '-' ? status.notification : null;
}
