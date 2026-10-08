import './app-base.js';
import { showError } from '../components/toast-stack.js';
import { byId, fillWindowHeight, readJSON } from '../lib/dom.js';
import { get } from '../lib/http.js';
import { drawGeofence, drawTask, drawTraject } from '../map/field-layers.js';
import { createMap } from '../map/robot-map.js';
import { RateColors, sessionLabel } from './map/as-applied-panel.js';

// Colour attribute shown first for each layer ('' = one colour).
const DEFAULT_COLOR = { sections: 'rate', points: '' };
// Wait this long after the last filter edit before reloading the features.
const RELOAD_DELAY_MS = 350;

const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function formatValue(value) {
    if (value === null || value === undefined) return '–';
    if (typeof value === 'number' && !Number.isInteger(value)) return Number(value.toFixed(4)).toString();
    return String(value);
}

/** Colours for attributes with a few distinct values (bool, text), from --category-colors in app.css. */
class CategoryColors {
    constructor() {
        this.colors = getComputedStyle(document.documentElement).getPropertyValue('--category-colors').split(',').map((c) => c.trim());
    }

    color(index) {
        return this.colors[index % this.colors.length];
    }
}

/**
 * How features are coloured: one colour, a ramp over a numeric range, or a colour per distinct value.
 * Built from the attribute summary returned by core:applied_attribute.
 */
class ColorScale {
    constructor(summary, rateColors, categoryColors) {
        this.summary = summary;
        this.rateColors = rateColors;
        this.categoryColors = categoryColors;
        this.none = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
        if (summary?.kind === 'number' && !(summary.values?.length <= 8)) {
            this.kind = 'ramp';
        } else if (summary?.values) {
            this.kind = 'categories';
            this.index = new Map(summary.values.map((value, i) => [String(value), i]));
        } else {
            this.kind = summary ? 'hash' : 'single';
        }
    }

    color(value) {
        if (this.kind === 'single') return this.none;
        if (value === null || value === undefined) return this.rateColors.none;
        if (this.kind === 'ramp') {
            const { min, max } = this.summary;
            return this.rateColors.color(max > min ? value - min : 1, max > min ? max - min : 1);
        }
        let index = this.index?.get(String(value));
        if (index === undefined) index = [...String(value)].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;
        return this.categoryColors.color(index);
    }

    renderLegend(element) {
        element.replaceChildren();
        if (this.kind === 'ramp') {
            element.innerHTML = `
                <div class="as-applied-ramp"></div>
                <div class="as-applied-scale"><span>${escapeHTML(formatValue(this.summary.min))}</span><span>${escapeHTML(formatValue(this.summary.max))}</span></div>`;
        } else if (this.kind === 'categories') {
            for (const value of this.summary.values) {
                const item = document.createElement('span');
                item.className = 'legend-item';
                item.innerHTML = `<span class="legend-swatch" style="background:${this.color(value)}"></span>`;
                item.append(formatValue(value));
                element.append(item);
            }
        }
    }
}

/** One filter row: a numeric range, or a set of values to keep. */
class FilterRow {
    constructor(summary, onChange, onRemove) {
        this.summary = summary;
        this.element = document.createElement('div');
        this.element.className = 'applied-filter';
        this.element.innerHTML = `
            <div class="applied-filter-header">
                <span class="applied-filter-name"></span>
                <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Remove filter">&times;</button>
            </div>`;
        this.element.querySelector('.applied-filter-name').textContent = summary.name;
        this.element.querySelector('button').addEventListener('click', onRemove);

        if (summary.values) {
            this.boxes = summary.values.map((value) => {
                const label = document.createElement('label');
                label.className = 'form-check form-check-inline small my-0 ms-0 me-3';
                label.innerHTML = '<input class="form-check-input" type="checkbox" checked> <span class="form-check-label"></span>';
                label.querySelector('span').textContent = formatValue(value);
                const box = label.querySelector('input');
                box.value = String(value);
                this.element.append(label);
                return box;
            });
        } else if (summary.kind === 'number') {
            const range = document.createElement('div');
            range.className = 'applied-filter-range';
            range.innerHTML = `
                <input type="number" step="any" class="form-control form-control-sm" aria-label="Minimum">
                <span class="text-body-secondary">–</span>
                <input type="number" step="any" class="form-control form-control-sm" aria-label="Maximum">`;
            [this.min, this.max] = range.querySelectorAll('input');
            this.min.value = summary.min ?? '';
            this.max.value = summary.max ?? '';
            this.element.append(range);
        } else {
            this.text = document.createElement('input');
            this.text.className = 'form-control form-control-sm';
            this.text.placeholder = 'Values, comma separated';
            this.element.append(this.text);
        }
        this.element.addEventListener('input', onChange);
        this.element.addEventListener('change', onChange);
    }

    get filter() {
        const { name } = this.summary;
        if (this.boxes) return { name, values: this.boxes.filter((box) => box.checked).map((box) => box.value) };
        if (this.min) {
            const number = (input) => (input.value === '' ? null : Number(input.value));
            return { name, min: number(this.min), max: number(this.max) };
        }
        const values = this.text.value.split(',').map((value) => value.trim()).filter(Boolean);
        return values.length ? { name, values } : null;
    }
}

class AppliedPage {
    constructor() {
        this.root = byId('applied-layout');
        this.field = readJSON('field-data');
        this.map = createMap(byId('applied-map'));
        this.drawField();

        this.rateColors = new RateColors();
        this.categoryColors = new CategoryColors();
        this.scale = new ColorScale(null, this.rateColors, this.categoryColors);
        this.renderer = L.canvas();
        this.layer = L.geoJSON(null, {
            style: (feature) => this.polygonStyle(feature),
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { renderer: this.renderer, radius: 4 }),
            onEachFeature: (feature, layer) => layer.bindPopup(() => this.popup(feature.properties.fid), { maxWidth: 360 }),
            renderer: this.renderer,
        }).addTo(this.map);

        fillWindowHeight(byId('applied-map-shell'), 16);
        this.map.invalidateSize();

        this.sessionSelect = byId('applied-session');
        if (!this.sessionSelect) return;  // no recordings for this field

        for (const option of this.sessionSelect.options) {
            option.textContent = sessionLabel(option.value) + (option.textContent.includes('(recording)') ? ' (recording)' : '');
        }
        this.colorSelect = byId('applied-color');
        this.addFilterSelect = byId('applied-add-filter');
        /** @type {FilterRow[]} */
        this.filters = [];
        this.columns = {};
        this.request = 0;

        this.sessionSelect.addEventListener('change', () => this.selectSession());
        for (const radio of document.querySelectorAll('input[name="applied-layer"]')) {
            radio.addEventListener('change', () => this.selectLayer());
        }
        this.colorSelect.addEventListener('change', () => this.selectColor(this.colorSelect.value));
        this.addFilterSelect.addEventListener('change', () => this.addFilter(this.addFilterSelect.value));

        this.selectSession(true);
    }

    drawField() {
        const group = L.layerGroup().addTo(this.map);
        const { geofence, traject, tasks } = this.field;
        if (!geofence.empty) drawGeofence(group, geofence.latlng);
        for (const task of Object.values(tasks)) {
            if (!task.geometry.empty) drawTask(group, task.type, task.geometry.latlng, { filled: false });
        }
        if (!traject.empty) drawTraject(group, traject.latlng[0]);
    }

    get session() {
        return this.sessionSelect.value;
    }

    get layerName() {
        return document.querySelector('input[name="applied-layer"]:checked').value;
    }

    params(extra = {}) {
        return new URLSearchParams({ field: this.root.dataset.field, session: this.session, layer: this.layerName, ...extra });
    }

    url(name, extra) {
        const url = new URL(this.root.dataset[name], window.location.href);
        url.search = this.params(extra);
        return url;
    }

    async getJSON(name, extra) {
        return (await get(this.url(name, extra))).json();
    }

    selectSession(first = false) {
        // Keep the chosen layer when the session has it, else show the one it has.
        const layers = this.sessionSelect.selectedOptions[0].dataset.layers.split(',');
        for (const radio of document.querySelectorAll('input[name="applied-layer"]')) {
            radio.disabled = !layers.includes(radio.value);
        }
        const checked = document.querySelector('input[name="applied-layer"]:checked');
        if (checked.disabled) byId(`applied-layer-${layers[0]}`).checked = true;
        this.selectLayer(first);
    }

    async selectLayer(fit = false) {
        byId('applied-download').href = this.url('downloadUrl');
        this.filters = [];
        byId('applied-filters').replaceChildren();
        try {
            const { columns } = await this.getJSON('layerUrl');
            this.columns = columns;
        } catch (error) {
            showError('Loading the recording', error);
            return;
        }
        const names = Object.keys(this.columns).sort((a, b) => a.localeCompare(b));
        const options = (placeholder) => [placeholder, ...names.map((name) => new Option(name, name))];
        this.colorSelect.replaceChildren(...options(new Option('One colour', '')));
        this.addFilterSelect.replaceChildren(...options(new Option('+ Add filter on…', '')));

        const color = DEFAULT_COLOR[this.layerName];
        await this.selectColor(color in this.columns ? color : '', { fit });
    }

    async selectColor(name, { fit = false } = {}) {
        this.colorSelect.value = name;
        let summary = null;
        if (name) {
            try {
                summary = await this.getJSON('attributeUrl', { name });
            } catch (error) {
                showError('Loading the attribute', error);
            }
        }
        this.scale = new ColorScale(summary, this.rateColors, this.categoryColors);
        this.scale.renderLegend(byId('applied-legend'));
        await this.reload({ fit });
    }

    async addFilter(name) {
        this.addFilterSelect.value = '';
        if (!name || this.filters.some((row) => row.summary.name === name)) return;
        try {
            const summary = await this.getJSON('attributeUrl', { name });
            const row = new FilterRow(summary, () => this.scheduleReload(), () => {
                this.filters = this.filters.filter((other) => other !== row);
                row.element.remove();
                this.reload();
            });
            this.filters.push(row);
            byId('applied-filters').append(row.element);
        } catch (error) {
            showError('Adding the filter', error);
        }
    }

    scheduleReload() {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reload(), RELOAD_DELAY_MS);
    }

    async reload({ fit = false } = {}) {
        const request = ++this.request;
        const filters = this.filters.map((row) => row.filter).filter(Boolean);
        try {
            const response = await get(this.url('featuresUrl', { color: this.colorSelect.value, filters: JSON.stringify(filters) }));
            const collection = await response.json();
            // A newer request (other session, colour or filter) replaced this one.
            if (request !== this.request) return;
            this.layer.clearLayers();
            this.layer.addData(collection);
            byId('applied-count').textContent = `${response.headers.get('X-Shown')} of ${response.headers.get('X-Total')}`;
            if (fit && collection.features.length) this.map.fitBounds(this.layer.getBounds(), { padding: [24, 24] });
        } catch (error) {
            if (request === this.request) showError('Loading the as-applied map', error);
        }
    }

    polygonStyle(feature) {
        const color = this.scale.color(feature.properties.value);
        if (feature.geometry.type === 'Point') {
            return { color: '#fff', weight: 1, fillColor: color, fillOpacity: 0.9 };
        }
        return { stroke: false, fillColor: color, fillOpacity: 0.8 };
    }

    popup(fid) {
        const element = document.createElement('div');
        element.className = 'applied-popup';
        element.textContent = 'Loading…';
        this.getJSON('featureUrl', { fid }).then((properties) => {
            const entries = Object.entries(properties);
            element.innerHTML = `
                ${entries.length > 12 ? '<input type="search" class="form-control form-control-sm mb-2" placeholder="Search attributes">' : ''}
                <table class="table table-sm mb-0"><tbody>${entries.map(([name, value]) =>
                    `<tr><th>${escapeHTML(name)}</th><td>${escapeHTML(formatValue(value))}</td></tr>`).join('')}</tbody></table>`;
            element.querySelector('input')?.addEventListener('input', (event) => {
                const query = event.target.value.toLowerCase();
                for (const row of element.querySelectorAll('tr')) {
                    row.hidden = !row.textContent.toLowerCase().includes(query);
                }
            });
        }).catch((error) => {
            element.textContent = `Could not load the attributes: ${error.message}`;
        });
        return element;
    }
}

new AppliedPage();
