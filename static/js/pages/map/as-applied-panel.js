import { showError, showToast } from '../../components/toast-stack.js';
import { byId } from '../../lib/dom.js';
import { get, postForm } from '../../lib/http.js';

// Poll faster while a recording is running, so the map follows the implement.
const POLL_RECORDING_MS = 2000;
const POLL_IDLE_MS = 10000;
const SELECTION_KEY = 'as-applied-session';
// Rates are scaled from 0 to at least this value (the default task rate).
const DEFAULT_MAX_RATE = 100;

/** `flame-weeder_20261008-102412.gpkg` → { implement, start (Date, UTC) }. */
function parseSessionFile(file) {
    const match = /^(.*)_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.gpkg$/.exec(file);
    if (!match) return { implement: file, start: null };
    const [, implement, year, month, day, hours, minutes, seconds] = match;
    return { implement, start: new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)) };
}

function sessionLabel(file) {
    const { implement, start } = parseSessionFile(file);
    if (!start) return implement;
    const when = start.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${when} · ${implement}`;
}

const sessionStart = (file) => file.slice(file.lastIndexOf('_'));

function hexToRgb(hex) {
    const value = parseInt(hex.trim().slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Colour of a rate on the sequential ramp defined in app.css (--rate-ramp, --rate-none). */
class RateColors {
    constructor() {
        const style = getComputedStyle(document.documentElement);
        this.none = style.getPropertyValue('--rate-none').trim();
        this.ramp = style.getPropertyValue('--rate-ramp').split(',').map(hexToRgb);
    }

    color(rate, maxRate) {
        const t = Math.min(Math.max(rate / maxRate, 0), 1) * (this.ramp.length - 1);
        const i = Math.min(Math.floor(t), this.ramp.length - 2);
        const [a, b] = [this.ramp[i], this.ramp[i + 1]];
        const rgb = a.map((channel, k) => Math.round(channel + (b[k] - channel) * (t - i)));
        return `rgb(${rgb.join(',')})`;
    }

    style(rate, maxRate) {
        if (!(rate > 0)) return { stroke: false, fillColor: this.none, fillOpacity: 0.45 };
        return { stroke: false, fillColor: this.color(rate, maxRate), fillOpacity: 0.85 };
    }
}

/**
 * As-applied map on the map page: the record toggle, the session picker with legend, and the layer itself.
 * "Latest" follows the running recording, or else the newest recorded session of the field.
 */
export class AsAppliedPanel {
    constructor(panel, map, recordForm) {
        this.panel = panel;
        this.map = map;
        this.recordForm = recordForm;
        this.recordCheck = recordForm.querySelector('input[name="record"]');
        this.select = byId('as-applied-select');
        this.colors = new RateColors();
        this.maxRate = DEFAULT_MAX_RATE;

        // Own pane below the field shapes and the robot, drawn on a canvas (sessions hold many small polygons).
        map.createPane('asApplied').style.zIndex = 390;
        this.layer = L.geoJSON(null, {
            pane: 'asApplied',
            renderer: L.canvas({ pane: 'asApplied' }),
            style: (feature) => this.colors.style(feature.properties.rate, this.maxRate),
            onEachFeature: (feature, layer) => layer.bindPopup(() => this.popup(feature.properties)),
        }).addTo(map);

        /** Files drawn now, and how many features of each are loaded. */
        this.shownFiles = [];
        this.loaded = {};
        this.state = { sessions: [], active_files: [], recording: this.recordCheck.checked, addon_running: true };

        try {
            this.select.value = sessionStorage.getItem(SELECTION_KEY) ?? 'latest';
        } catch {
            this.select.value = 'latest';
        }
        this.select.addEventListener('change', () => {
            try {
                sessionStorage.setItem(SELECTION_KEY, this.select.value);
            } catch {
                // Selection is only a convenience.
            }
            this.refresh();
        });
        this.recordForm.addEventListener('change', () => this.toggleRecording());

        this.poll();
    }

    popup({ rate, section, implement, time }) {
        const when = time ? new Date(time).toLocaleTimeString() : '';
        const element = document.createElement('div');
        element.className = 'small';
        element.innerHTML = '<strong></strong><div class="text-body-secondary"></div>';
        element.querySelector('strong').textContent = `Rate ${rate}`;
        element.querySelector('div').textContent = `${implement} · section ${section} · ${when}`;
        return element;
    }

    async toggleRecording() {
        try {
            const response = await postForm(this.recordForm.action, new FormData(this.recordForm));
            const { recording, addon_running } = await response.json();
            this.recordCheck.checked = recording;
            if (recording && !addon_running) {
                showToast('Recording is on, but the task-map addon is not running: start it under System › Addons.', 'warning');
            } else {
                showToast(recording ? 'Recording the as-applied map' : 'Recording stopped');
            }
        } catch (error) {
            this.recordCheck.checked = !this.recordCheck.checked;
            showError('Toggling the as-applied recording', error);
        }
        // A new session starts on the next flush of the addon; pick it up soon.
        setTimeout(() => this.refresh(), 1500);
    }

    async poll() {
        await this.refresh();
        setTimeout(() => this.poll(), this.state.recording ? POLL_RECORDING_MS : POLL_IDLE_MS);
    }

    async refresh() {
        try {
            const response = await get(this.panel.dataset.sessionsUrl);
            this.state = await response.json();
        } catch (error) {
            console.warn('As-applied sessions could not be loaded', error);
            return;
        }
        const { recording, addon_running, active_files } = this.state;
        // Another client may have toggled the recording.
        this.recordCheck.checked = recording;
        byId('as-applied-live').hidden = !(recording && active_files.length > 0);
        byId('as-applied-warning').hidden = !(recording && !addon_running);
        this.renderOptions();
        await this.loadFiles(this.selectedFiles());
    }

    renderOptions() {
        const selected = this.select.value;
        const options = [new Option('Latest', 'latest'), new Option('Hidden', '')];
        for (const file of this.state.sessions) options.push(new Option(sessionLabel(file), file));
        this.select.replaceChildren(...options);
        this.select.value = options.some((option) => option.value === selected) ? selected : 'latest';
    }

    selectedFiles() {
        const { sessions, active_files } = this.state;
        if (this.select.value === '') return [];
        if (this.select.value !== 'latest') return [this.select.value];
        if (active_files.length) return active_files;
        // All implements of the newest session.
        return sessions.length ? sessions.filter((file) => sessionStart(file) === sessionStart(sessions[0])) : [];
    }

    async loadFiles(files) {
        if (files.join() !== this.shownFiles.join()) {
            this.layer.clearLayers();
            this.shownFiles = files;
            this.loaded = Object.fromEntries(files.map((file) => [file, 0]));
            this.maxRate = DEFAULT_MAX_RATE;
        }
        byId('as-applied-legend').hidden = files.length === 0;

        for (const file of files) {
            const url = new URL(this.panel.dataset.mapUrl, window.location.href);
            url.search = new URLSearchParams({ file, skip: this.loaded[file] });
            try {
                const collection = await (await get(url)).json();
                // The selection may have changed while waiting.
                if (this.loaded[file] === undefined) return;
                this.loaded[file] += collection.features.length;
                this.layer.addData(collection);
                this.updateScale(collection.features);
            } catch (error) {
                // The addon may be writing the file right now; the next poll retries.
                console.warn(`As-applied map ${file} could not be loaded`, error);
            }
        }
    }

    updateScale(features) {
        const maxRate = features.reduce((max, feature) => Math.max(max, feature.properties.rate), this.maxRate);
        if (maxRate !== this.maxRate) {
            this.maxRate = maxRate;
            this.layer.setStyle((feature) => this.colors.style(feature.properties.rate, this.maxRate));
        }
        byId('as-applied-max').textContent = this.maxRate;
    }
}
