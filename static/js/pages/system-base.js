// Shared by every page that extends system/base.html.
import { initConfirmDialogs } from '../components/confirm-dialog.js';
import { initFormControls } from '../components/form-controls.js';
import { NotificationToast, notificationOf } from '../components/notification-toast.js';
import { byId } from '../lib/dom.js';
import { LiveSocket } from '../lib/live-socket.js';

const toast = new NotificationToast(byId('robot-toast'));

new LiveSocket('/ws/status/', (status) => {
    const notification = notificationOf(status);
    if (notification) toast.show(notification);
});

initConfirmDialogs();
initFormControls();
