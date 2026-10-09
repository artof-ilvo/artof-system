// Implement editor (system:implement_edit): form or JSON mode on the same implement object,
// with a live top/side preview. The form posts the implement as JSON in the hidden `data` field.
import { byId, checkedValue, readJSON } from '../lib/dom.js';
import { JsonEditor } from '../components/json-editor.js';
import { ImplementPreview } from '../components/implement-preview.js';
import { showToast } from '../components/toast-stack.js';

const MODE_KEY = 'implement-editor-mode';
// Section keys that artof-core treats as optional: an empty input removes them from the JSON.
const OPTIONAL_KEYS = new Set(['link_length', 'repeats', 'offset']);

const form = byId('implement-form');
const platform = readJSON('platform_data');
const rawJson = readJSON('raw_json');
const json = new JsonEditor(byId('json-editor'), byId('line-numbers'), byId('line-numbers-container'));
const preview = new ImplementPreview(byId('preview-top'), byId('preview-side'), platform);
const hitchSelect = byId('preview-hitch');
const sectionsList = byId('sections');
const sectionTemplate = byId('section-template');

let implement = normalise(readJSON('implement_data'));
let activeIndex = null;
let sectionUid = 0;

/** Fills in what the form needs (sections, transforms) without dropping unknown keys. */
function normalise(data) {
    const result = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
    result.name ??= '';
    result.types = Array.isArray(result.types) ? result.types : [];
    result.sections = Array.isArray(result.sections) ? result.sections : [];
    for (const section of result.sections) {
        section.transform ??= {};
        for (const key of ['T', 'R']) {
            const value = Array.isArray(section.transform[key]) ? section.transform[key] : [];
            section.transform[key] = [0, 1, 2].map((i) => Number(value[i]) || 0);
        }
    }
    return result;
}

function newSection() {
    return { id: '', width: 0.5, up: 0.05, down: 0.05, transform: { T: [0, -1, 0], R: [0, 0, 0] } };
}

const fmt = (value) => Number(Number(value).toFixed(3));

// ------------------------------------------------------------------ Form

function renderGeneral() {
    byId('implement-name').value = implement.name;
    for (const box of byId('implement-types').querySelectorAll('input')) {
        box.checked = implement.types.includes(box.value);
    }
    byId('implement-on-taskmap').checked = implement.on_taskmap !== false;
    updateTitle();
}

function updateTitle() {
    byId('implement-title').textContent = implement.name || 'New implement';
}

function sectionSummary(section) {
    const parts = [`${fmt(section.width || 0)} m wide`];
    const repeats = Number(section.repeats) || 1;
    if (repeats > 1) parts.push(`× ${repeats}`);
    return parts.join(' · ');
}

function renderSections() {
    sectionsList.replaceChildren(...implement.sections.map(renderSection));
    byId('sections-empty').hidden = implement.sections.length > 0;
}

function renderSection(section, index) {
    const element = sectionTemplate.content.firstElementChild.cloneNode(true);
    const uid = `section-${++sectionUid}`;
    element.dataset.index = index;

    const toggle = element.querySelector('.section-toggle');
    const body = element.querySelector('[data-section-body]');
    body.id = `${uid}-body`;
    toggle.dataset.bsTarget = `#${body.id}`;
    toggle.setAttribute('aria-controls', body.id);
    element.querySelector('[data-section-title]').textContent = `Section ${index + 1}${section.id ? ` · ${section.id}` : ''}`;
    element.querySelector('[data-section-summary]').textContent = sectionSummary(section);

    for (const input of element.querySelectorAll('[data-key]')) {
        input.id = `${uid}-${input.dataset.key.replace('.', '-')}`;
        const label = input.closest('[class*="col-"]')?.querySelector('label.field-label');
        if (label && !label.htmlFor) label.htmlFor = input.id;
        const value = readKey(section, input.dataset.key);
        input.value = value ?? '';
    }
    return element;
}

function readKey(section, key) {
    if (key.startsWith('T.') || key.startsWith('R.')) {
        const [vector, i] = key.split('.');
        return section.transform[vector][Number(i)];
    }
    return section[key];
}

function writeKey(section, key, input) {
    if (key === 'id') {
        section.id = input.value;
        return;
    }
    const empty = input.value.trim() === '';
    const value = key === 'repeats' ? parseInt(input.value, 10) : parseFloat(input.value);
    if (key.startsWith('T.') || key.startsWith('R.')) {
        const [vector, i] = key.split('.');
        section.transform[vector][Number(i)] = empty || !Number.isFinite(value) ? 0 : value;
    } else if (OPTIONAL_KEYS.has(key) && empty) {
        delete section[key];
    } else {
        section[key] = Number.isFinite(value) ? value : 0;
    }
}

/** Marks inputs that artof-core would reject; returns whether the implement is valid. */
function validateForm() {
    const name = byId('implement-name');
    const badName = !implement.name.trim() || /[\\/]/.test(implement.name) || implement.name.startsWith('.');
    name.classList.toggle('is-invalid', badName);
    let valid = !badName;

    for (const element of sectionsList.querySelectorAll('[data-section]')) {
        const section = implement.sections[Number(element.dataset.index)];
        const width = element.querySelector('[data-key="width"]');
        const up = element.querySelector('[data-key="up"]');
        const down = element.querySelector('[data-key="down"]');
        const badWidth = !(section.width > 0);
        const badLength = !((Number(section.up) || 0) + (Number(section.down) || 0) > 0);
        width.classList.toggle('is-invalid', badWidth);
        up.classList.toggle('is-invalid', badLength);
        down.classList.toggle('is-invalid', badLength);
        if (badWidth || badLength) {
            valid = false;
            bootstrap.Collapse.getOrCreateInstance(element.querySelector('[data-section-body]'), { toggle: false }).show();
        }
    }
    return valid;
}

byId('implement-name').addEventListener('input', (event) => {
    implement.name = event.target.value;
    event.target.classList.remove('is-invalid');
    updateTitle();
});

byId('implement-types').addEventListener('change', () => {
    implement.types = [...byId('implement-types').querySelectorAll('input:checked')].map((box) => box.value);
    updateHitchOptions();
    draw();
});

byId('implement-on-taskmap').addEventListener('change', (event) => {
    implement.on_taskmap = event.target.checked;
});

sectionsList.addEventListener('input', (event) => {
    const input = event.target.closest('[data-key]');
    const element = event.target.closest('[data-section]');
    if (!input || !element) return;
    const section = implement.sections[Number(element.dataset.index)];
    writeKey(section, input.dataset.key, input);
    input.classList.remove('is-invalid');
    element.querySelector('[data-section-title]').textContent =
        `Section ${Number(element.dataset.index) + 1}${section.id ? ` · ${section.id}` : ''}`;
    element.querySelector('[data-section-summary]').textContent = sectionSummary(section);
    draw();
});

sectionsList.addEventListener('focusin', (event) => {
    const element = event.target.closest('[data-section]');
    const index = element ? Number(element.dataset.index) : null;
    if (index !== activeIndex) {
        activeIndex = index;
        draw();
    }
});

sectionsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const index = Number(button.closest('[data-section]').dataset.index);
    if (button.dataset.action === 'remove') {
        implement.sections.splice(index, 1);
        activeIndex = null;
    } else if (button.dataset.action === 'duplicate') {
        implement.sections.splice(index + 1, 0, structuredClone(implement.sections[index]));
        activeIndex = index + 1;
    }
    renderSections();
    draw();
});

byId('add-section').addEventListener('click', () => {
    implement.sections.push(newSection());
    activeIndex = implement.sections.length - 1;
    renderSections();
    draw();
    sectionsList.lastElementChild?.querySelector('[data-key="id"]')?.focus();
});

// ---------------------------------------------------------------- Preview

/** Hitches from settings that accept this implement's types (all hitches when none match). */
function updateHitchOptions() {
    const selected = hitchSelect.value;
    const matching = platform.hitches.filter((hitch) => (hitch.types ?? []).some((type) => implement.types.includes(type)));
    const options = matching.length ? matching : platform.hitches;
    hitchSelect.replaceChildren(...options.map((hitch) => new Option(`Hitch ${hitch.name}`, hitch.name)));
    if (options.some((hitch) => hitch.name === selected)) hitchSelect.value = selected;
    hitchSelect.hidden = options.length === 0;

    const note = byId('preview-note');
    if (!platform.hitches.length) {
        note.textContent = 'No hitches in settings.json: sections are drawn relative to the hitch ball.';
    } else if (!matching.length) {
        note.textContent = implement.types.length
            ? 'No hitch supports these task types; drawn on another hitch.'
            : 'Choose task types to see which hitches can carry this implement.';
    } else {
        note.textContent = 'Drawn with the hitch lowered (angle 0). Dots are section origins; the hitch ball is the open circle.';
    }
}

function selectedHitch() {
    return platform.hitches.find((hitch) => hitch.name === hitchSelect.value) ?? null;
}

function draw() {
    preview.draw(implement, selectedHitch(), activeIndex);
}

hitchSelect.addEventListener('change', draw);

// ------------------------------------------------------------------ Modes

const formPane = byId('form-pane');
const jsonPane = byId('json-pane');
const formatButton = byId('format-button');

function showMode(mode) {
    formPane.hidden = mode !== 'form';
    jsonPane.hidden = mode !== 'json';
    formatButton.hidden = mode !== 'json';
    byId(`editor-mode-${mode}`).checked = true;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable */ }
}

/** Parses the JSON pane into an implement, or shows why it cannot. */
function implementFromJson() {
    const { value, error } = json.tryParse();
    if (error) {
        showToast(`Invalid JSON: ${error.message}`, 'danger');
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        showToast('The implement must be a JSON object ({ … }).', 'danger');
        return null;
    }
    return normalise(value);
}

form.addEventListener('change', (event) => {
    if (event.target.name !== 'editor-mode') return;
    if (event.target.value === 'json') {
        json.setValue(JSON.stringify(implement, null, 2));
        showMode('json');
    } else {
        const parsed = implementFromJson();
        if (!parsed) {
            showMode('json');
            return;
        }
        implement = parsed;
        activeIndex = null;
        renderGeneral();
        renderSections();
        updateHitchOptions();
        draw();
        showMode('form');
    }
});

// Keep the preview in step with valid JSON while typing.
byId('json-editor').addEventListener('input', () => {
    const { value } = json.tryParse();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        preview.draw(normalise(structuredClone(value)), selectedHitch(), null);
    }
});

formatButton.addEventListener('click', () => json.format());

form.addEventListener('submit', (event) => {
    if (checkedValue('editor-mode', form) === 'json') {
        const parsed = implementFromJson();
        if (!parsed) {
            event.preventDefault();
            return;
        }
        implement = parsed;
    } else if (!validateForm()) {
        event.preventDefault();
        showToast('Fix the marked fields before saving.', 'warning');
        return;
    }
    byId('implement-data').value = JSON.stringify(implement);
});

// ------------------------------------------------------------------- Start

renderGeneral();
renderSections();
updateHitchOptions();
draw();

if (rawJson !== null) {
    // The server rejected JSON it could not parse: show it as it was typed.
    json.setValue(rawJson);
    showMode('json');
} else {
    let mode = 'form';
    try { mode = localStorage.getItem(MODE_KEY) === 'json' ? 'json' : 'form'; } catch { /* storage unavailable */ }
    if (mode === 'json') json.setValue(JSON.stringify(implement, null, 2));
    showMode(mode);
}
