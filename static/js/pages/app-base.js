// Shared by every page that extends app/base.html.
import { initConfirmDialogs } from '../components/confirm-dialog.js';
import { initFormControls } from '../components/form-controls.js';
import { NotificationToast, notificationOf } from '../components/notification-toast.js';
import { StatusBar } from '../components/status-bar.js';
import { byId } from '../lib/dom.js';
import { LiveSocket } from '../lib/live-socket.js';

const toast = new NotificationToast(byId('robot-toast'));
const statusBar = new StatusBar(byId('navigation-state-form'));

new LiveSocket('/ws/status/', (status) => {
    statusBar.update(status);
    const notification = notificationOf(status);
    if (notification) toast.show(notification);
});

initConfirmDialogs();
initFormControls();
