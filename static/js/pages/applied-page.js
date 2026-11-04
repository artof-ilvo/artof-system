import './app-base.js';
import { showError } from '../components/toast-stack.js';
import { byId, fillWindowHeight, readJSON, withBusy } from '../lib/dom.js';
import { get, postForm } from '../lib/http.js';
import { drawGeofence, drawTask, drawTraject } from '../map/field-layers.js';
import { createMap } from '../map/robot-map.js';
import { RateColors, sessionLabel } from './map/as-applied-panel.js';

// Colour attribute shown first for each layer ('' = one colour).
const DEFAULT_COLOR = { sections: 'rate', points: '' };
// Wait this long after the last filter edit before reloading the features.
const RELOAD_DELAY_MS = 350;
// Remembered per browser: whether the traject is drawn over the as-applied map.
const SHOW_TRAJECT_KEY = 'applied-show-traject';
// At most this many matching attributes are listed in the filter search.
const MAX_FILTER_OPTIONS = 200;
// Remembered per browser: the last field, its recording, the layer and per layer the colour and filters.
const VIEW_KEY = 'applied-view';

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

    /**
     * What to remember of this row. Value lists remember the unticked values, so values that only occur in
     * another recording are shown.
     */
    get saved() {
        const { name } = this.summary;
        if (this.boxes) return { name, exclude: this.boxes.filter((box) => !box.checked).map((box) => box.value) };
        if (this.min) return { name, min: this.min.value, max: this.max.value };
        return { name, text: this.text.value };
    }

    restore(saved) {
        if (this.boxes && Array.isArray(saved.exclude)) {
            for (const box of this.boxes) box.checked = !saved.exclude.includes(box.value);
        } else if (this.min) {
            if (saved.min !== undefined) this.min.value = saved.min;
            if (saved.max !== undefined) this.max.value = saved.max;
        } else if (this.text && typeof saved.text === 'string') {
            this.text.value = saved.text;
        }
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

/**
 * Search field with a list of attributes; picking one (click or Enter) calls onPick with its name.
 * By default the field clears after a pick ("+ Add filter"). With `selectable` it works as a searchable
 * select: it shows the picked attribute and lists all attributes again when focused ("Colour by").
 * `blank` is the label of an extra '' entry listed first (e.g. "One colour").
 */
class AttributePicker {
    constructor(input, list, onPick, { selectable = false, blank = null } = {}) {
        this.input = input;
        this.list = list;
        this.onPick = onPick;
        this.selectable = selectable;
        this.blank = blank;
        this.names = [];
        this.taken = new Set();
        this.selected = '';
        this.active = -1;

        input.addEventListener('focus', () => this.open());
        input.addEventListener('input', () => this.open());
        input.addEventListener('blur', () => this.close());
        input.addEventListener('keydown', (event) => this.keydown(event));
        // mousedown, not click: picking must happen before the input loses focus and closes the list.
        list.addEventListener('mousedown', (event) => {
            const option = event.target.closest('[data-name]');
            if (!option) return;
            event.preventDefault();
            this.pick(option.dataset.name);
        });
    }

    /** All attributes of the layer, and the ones that already have a filter. */
    setNames(names, taken = []) {
        this.names = names;
        this.taken = new Set(taken);
        if (!this.list.hidden) this.render();
    }

    /** Shows `name` as the chosen attribute (selectable pickers only), without calling onPick. */
    select(name) {
        this.selected = name;
        if (this.list.hidden) this.showSelected();
    }

    label(name) {
        return name === '' ? this.blank : name;
    }

    showSelected() {
        if (!this.selectable) return;
        this.input.value = this.label(this.selected) ?? '';
        this.input.placeholder = '';
    }

    get options() {
        return [...this.list.querySelectorAll('[data-name]')];
    }

    open() {
        if (this.list.hidden && this.selectable) {
            // Start from the whole list; the chosen attribute stays visible as the placeholder.
            this.input.placeholder = this.label(this.selected) ?? '';
            this.input.value = '';
        }
        this.render();
        this.list.hidden = false;
        this.input.setAttribute('aria-expanded', 'true');
    }

    close() {
        this.list.hidden = true;
        this.input.setAttribute('aria-expanded', 'false');
        this.input.removeAttribute('aria-activedescendant');
        this.active = -1;
        this.showSelected();
    }

    render() {
        const query = this.input.value.trim().toLowerCase();
        const entries = this.blank === null ? this.names : ['', ...this.names];
        const matches = entries.filter((name) => !this.taken.has(name) && this.label(name).toLowerCase().includes(query));
        const shown = matches.slice(0, MAX_FILTER_OPTIONS);
        this.list.replaceChildren(...shown.map((name, index) => {
            const option = document.createElement('div');
            option.className = 'applied-filter-option';
            option.id = `${this.list.id}-${index}`;
            option.role = 'option';
            option.dataset.name = name;
            option.textContent = this.label(name);
            if (this.selectable) {
                const selected = name === this.selected;
                option.classList.toggle('is-selected', selected);
                option.setAttribute('aria-selected', String(selected));
            }
            return option;
        }));
        if (!matches.length) {
            const empty = document.createElement('div');
            empty.className = 'applied-filter-empty';
            empty.textContent = this.names.length ? 'No attributes match.' : 'No attributes.';
            this.list.append(empty);
        } else if (matches.length > MAX_FILTER_OPTIONS) {
            const more = document.createElement('div');
            more.className = 'applied-filter-empty';
            more.textContent = `${matches.length - MAX_FILTER_OPTIONS} more: type to narrow down.`;
            this.list.append(more);
        }
        // Typing highlights the first match; an untouched selectable list highlights the chosen attribute.
        let active = query && matches.length ? 0 : -1;
        if (!query && this.selectable) active = shown.indexOf(this.selected);
        this.setActive(active);
    }

    setActive(index) {
        const options = this.options;
        this.active = options.length ? Math.max(-1, Math.min(index, options.length - 1)) : -1;
        options.forEach((option, i) => option.classList.toggle('is-active', i === this.active));
        const active = options[this.active];
        if (active) {
            active.scrollIntoView({ block: 'nearest' });
            this.input.setAttribute('aria-activedescendant', active.id);
        } else {
            this.input.removeAttribute('aria-activedescendant');
        }
    }

    keydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (this.list.hidden) this.open();
            this.setActive(this.active + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const option = this.options[this.active];
            if (option) this.pick(option.dataset.name);
        } else if (event.key === 'Escape') {
            this.close();
        }
    }

    pick(name) {
        if (this.selectable) this.selected = name;
        else this.input.value = '';
        this.close();
        this.input.blur();
        this.onPick(name);
    }
}

/** The Applied page's choices in localStorage; reads and writes never throw (storage may be unavailable). */
class ViewState {
    constructor() {
        let state = null;
        try { state = JSON.parse(localStorage.getItem(VIEW_KEY)); } catch { /* storage unavailable or bad JSON */ }
        this.state = state && typeof state === 'object' ? state : {};
        this.state.sessions ??= {};
        this.state.layers ??= {};
    }

    get field() { return this.state.field; }

    set field(name) { this.state.field = name; this.save(); }

    session(field) { return this.state.sessions[field]; }

    get layer() { return this.state.layer; }

    /** { color, filters } last used on a layer ('sections' / 'points'), or undefined. */
    layerView(layer) { return this.state.layers[layer]; }

    update({ field, session, layer, color, filters }) {
        this.state.field = field;
        this.state.sessions[field] = session;
        this.state.layer = layer;
        this.state.layers[layer] = { color, filters };
        this.save();
    }

    save() {
        try { localStorage.setItem(VIEW_KEY, JSON.stringify(this.state)); } catch { /* storage unavailable */ }
    }
}

class AppliedPage {
    constructor() {
        this.root = byId('applied-layout');
        this.view = new ViewState();
        // Opened without a field (e.g. from the navigation): go to the field viewed last, if it still exists.
        const fieldName = this.root.dataset.field;
        const remembered = this.view.field;
        if (!new URL(window.location.href).searchParams.has('field') && remembered && remembered !== fieldName
            && [...byId('applied-field').options].some((option) => option.value === remembered)) {
            const url = new URL(window.location.href);
            url.searchParams.set('field', remembered);
            window.location.replace(url);
            return;
        }
        this.view.field = fieldName;
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
        this.color = '';
        this.colorPicker = new AttributePicker(byId('applied-color'), byId('applied-color-options'),
            (name) => this.selectColor(name), { selectable: true, blank: 'One colour' });
        this.filterPicker = new AttributePicker(byId('applied-filter-search'), byId('applied-filter-options'), (name) => this.addFilter(name));
        /** @type {FilterRow[]} */
        this.filters = [];
        this.layerChange = 0;
        this.columns = {};
        this.request = 0;

        this.sessionSelect.addEventListener('change', () => this.selectSession());
        for (const radio of document.querySelectorAll('input[name="applied-layer"]')) {
            radio.addEventListener('change', () => this.selectLayer());
        }
        this.bindDeleteAll();

        // Restore the remembered recording and layer when they still exist (selectSession falls back otherwise).
        const session = this.view.session(fieldName);
        if ([...this.sessionSelect.options].some((option) => option.value === session)) this.sessionSelect.value = session;
        const layerRadio = byId(`applied-layer-${this.view.layer}`);
        if (layerRadio) layerRadio.checked = true;
        this.selectSession(true);
    }

    /** "Delete all recordings" dialog: removes every session of the field, then reloads the page. */
    bindDeleteAll() {
        const accept = byId('applied-delete-accept');
        const download = byId('applied-delete-download');
        // After "Download first" the delete button becomes the obvious next step.
        download.addEventListener('click', () => {
            download.classList.replace('btn-outline-secondary', 'btn-light');
            accept.focus();
        });
        accept.addEventListener('click', () => {
            const body = new FormData();
            body.append('field', this.root.dataset.field);
            withBusy(accept, postForm(accept.dataset.deleteUrl, body))
                .then(() => window.location.reload())
                .catch((error) => {
                    bootstrap.Modal.getInstance(byId('applied-delete-dialog'))?.hide();
                    showError('Deleting the recordings', error);
                });
        });
    }

    drawField() {
        const group = L.layerGroup().addTo(this.map);
        const { geofence, traject, tasks } = this.field;
        if (!geofence.empty) drawGeofence(group, geofence.latlng);
        for (const task of Object.values(tasks)) {
            if (!task.geometry.empty) drawTask(group, task.type, task.geometry.latlng, { filled: false });
        }
        if (!traject.empty) this.drawTrajectToggle(traject.latlng[0]);
    }

    /** The traject in its own layer, shown or hidden with the "Show traject" switch. */
    drawTrajectToggle(latlngs) {
        const trajectGroup = L.layerGroup();
        drawTraject(trajectGroup, latlngs);
        const toggle = byId('applied-show-traject');
        let show = true;
        try { show = localStorage.getItem(SHOW_TRAJECT_KEY) !== 'false'; } catch { /* storage unavailable */ }
        toggle.checked = show;
        if (show) trajectGroup.addTo(this.map);
        byId('applied-traject-toggle').hidden = false;
        toggle.addEventListener('change', () => {
            if (toggle.checked) trajectGroup.addTo(this.map);
            else trajectGroup.remove();
            try { localStorage.setItem(SHOW_TRAJECT_KEY, String(toggle.checked)); } catch { /* storage unavailable */ }
        });
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
        const change = ++this.layerChange;
        byId('applied-download').href = this.url('downloadUrl');
        this.filters = [];
        byId('applied-filters').replaceChildren();
        let columns;
        try {
            ({ columns } = await this.getJSON('layerUrl'));
        } catch (error) {
            showError('Loading the recording', error);
            return;
        }
        if (change !== this.layerChange) return;  // another session or layer was picked meanwhile
        this.columns = columns;
        const names = Object.keys(this.columns).sort((a, b) => a.localeCompare(b));
        this.colorPicker.setNames(names);
        this.filterPicker.setNames(names);

        // The colour and filters last used on this layer, as far as this recording has those attributes.
        const remembered = this.view.layerView(this.layerName);
        for (const saved of remembered?.filters ?? []) {
            if (saved?.name in this.columns) await this.addFilter(saved.name, saved);
            if (change !== this.layerChange) return;
        }
        // '' is "One colour"; an attribute this recording lacks falls back to the layer's default.
        const fallback = DEFAULT_COLOR[this.layerName] in this.columns ? DEFAULT_COLOR[this.layerName] : '';
        let color = remembered?.color ?? fallback;
        if (color !== '' && !(color in this.columns)) color = fallback;
        await this.selectColor(color, { fit });
    }

    async selectColor(name, { fit = false } = {}) {
        this.color = name;
        this.colorPicker.select(name);
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

    /** Adds a filter row on attribute `name`, set to `saved` (a FilterRow.saved) when restoring it. */
    async addFilter(name, saved = null) {
        if (!name || this.filters.some((row) => row.summary.name === name)) return;
        const change = this.layerChange;
        try {
            const summary = await this.getJSON('attributeUrl', { name });
            if (change !== this.layerChange) return;  // the layer changed while loading
            const row = new FilterRow(summary, () => this.scheduleReload(), () => {
                this.filters = this.filters.filter((other) => other !== row);
                row.element.remove();
                this.updateFilterPicker();
                this.reload();
            });
            if (saved) row.restore(saved);
            this.filters.push(row);
            byId('applied-filters').append(row.element);
            this.updateFilterPicker();
            if (!saved) this.saveView();
        } catch (error) {
            showError('Adding the filter', error);
        }
    }

    /** Attributes that already have a filter are left out of the search. */
    updateFilterPicker() {
        this.filterPicker.setNames(this.filterPicker.names, this.filters.map((row) => row.summary.name));
    }

    scheduleReload() {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reload(), RELOAD_DELAY_MS);
    }

    saveView() {
        this.view.update({
            field: this.root.dataset.field,
            session: this.session,
            layer: this.layerName,
            color: this.color,
            filters: this.filters.map((row) => row.saved),
        });
    }

    async reload({ fit = false } = {}) {
        this.saveView();  // every change of session, layer, colour or filter ends in a reload
        const request = ++this.request;
        const filters = this.filters.map((row) => row.filter).filter(Boolean);
        try {
            const response = await get(this.url('featuresUrl', { color: this.color, filters: JSON.stringify(filters) }));
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
