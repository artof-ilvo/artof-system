import { byId } from '../lib/dom.js';
import { postForm } from '../lib/http.js';

// Error that fills the cross-track error gauge completely (m).
const MAX_ERROR_M = 0.3;
// Fractions of MAX_ERROR_M from which the gauge turns amber and red.
const WARNING_FRACTION = 0.33;
const DANGER_FRACTION = 0.66;
// After the user picks a navigation state, ignore the state pushed by the
// server for this long, so the radio does not jump back before the robot applied it.
const USER_STATE_GRACE_MS = 1000;

const errorFraction = (value) => Math.min(Math.abs(value) / MAX_ERROR_M, 1);

/** Chip colour for the GPS fix text: RTK fix is good, no fix is bad, anything in between is a warning. */
function gpsVariant(fix) {
    if (/rtk\s*fix/i.test(fix)) return 'chip-success';
    if (!fix || /no\s*fix|none|invalid/i.test(fix)) return 'chip-danger';
    return 'chip-warning';
}

/** The status bar of the app pages: cross-track error, navigation state, GPS, battery, heartbeat. */
export class StatusBar {
    constructor(stateForm) {
        this.errorLabel = byId('error-label');
        this.errorGauge = byId('error-gauge');
        this.errorBarPositive = byId('error-bar-positive');
        this.errorBarNegative = byId('error-bar-negative');
        this.gpsChip = byId('gps-chip');
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
        const negative = errorFraction(status.error.negative);
        const positive = errorFraction(status.error.positive);
        this.errorLabel.textContent = status.error.value;
        // Each fill covers half of the gauge, from the centre outwards.
        this.errorBarNegative.style.width = `${negative * 50}%`;
        this.errorBarPositive.style.width = `${positive * 50}%`;
        const worst = Math.max(negative, positive);
        this.errorGauge.classList.toggle('is-warning', worst >= WARNING_FRACTION && worst < DANGER_FRACTION);
        this.errorGauge.classList.toggle('is-danger', worst >= DANGER_FRACTION);

        this.gpsLabel.textContent = status.fix;
        this.gpsChip.classList.remove('chip-success', 'chip-warning', 'chip-danger');
        this.gpsChip.classList.add(gpsVariant(status.fix));

        const power = status.power_level;
        this.batteryLabel.textContent = typeof power === 'number' ? `${Math.round(power)}%` : power;
        this.heart.classList.toggle('is-on', Boolean(status.heartbeat));

        if (Date.now() - this.lastUserChange > USER_STATE_GRACE_MS) {
            const radio = this.stateForm.querySelector(`input[name="state"][value="${CSS.escape(status.current_state)}"]`);
            if (radio) radio.checked = true;
        }
    }
}
