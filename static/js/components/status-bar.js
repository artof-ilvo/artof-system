import { byId } from '../lib/dom.js';
import { postForm } from '../lib/http.js';

// Error that fills the cross-track error bar completely (m).
const MAX_ERROR_M = 0.3;
// After the user picks a navigation state, ignore the state pushed by the
// server for this long, so the radio does not jump back before the robot applied it.
const USER_STATE_GRACE_MS = 1000;

function errorBarWidth(value) {
    return `${Math.min(value / MAX_ERROR_M, 1) * 100}%`;
}

/** The status bar of the app pages: cross-track error, navigation state, GPS, battery, heartbeat. */
export class StatusBar {
    constructor(stateForm) {
        this.errorLabel = byId('error-label');
        this.errorBarPositive = byId('error-bar-positive');
        this.errorBarNegative = byId('error-bar-negative');
        this.gpsLabel = byId('gps-label');
        this.batteryLabel = byId('battery-label');
        this.heart = byId('heart-label');
        this.stateForm = stateForm;
        this.lastUserChange = 0;

        stateForm.addEventListener('change', () => {
            this.lastUserChange = Date.now();
            postForm(stateForm.action, new FormData(stateForm)).catch(console.error);
        });
    }

    update(status) {
        this.errorLabel.textContent = status.error.value;
        this.errorBarPositive.style.width = errorBarWidth(status.error.positive);
        this.errorBarNegative.style.width = errorBarWidth(status.error.negative);
        this.gpsLabel.textContent = status.fix;
        this.batteryLabel.textContent = status.power_level;
        this.heart.style.color = status.heartbeat ? 'red' : 'white';

        if (Date.now() - this.lastUserChange > USER_STATE_GRACE_MS) {
            const radio = this.stateForm.querySelector(`input[name="state"][value="${CSS.escape(status.current_state)}"]`);
            if (radio) radio.checked = true;
        }
    }
}
