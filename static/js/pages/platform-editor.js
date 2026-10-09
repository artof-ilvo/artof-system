// settings.json editor (system:edit_settings?filename=settings.json): form or JSON mode on the same
// settings object, with a live top/side view of the robot. Posts the settings as JSON in `data`.
//
// Form fields bind to the object through data attributes:
//   data-path="robot.transform.T.0"   path from the settings root
//   data-key="transform.T.0"          path from the list item (inside [data-list] items)
//   data-type                         string | number | int | optional-string | optional-number |
//                                     optional-int (empty removes the key) | checkbox-list
//   data-optional="robot.transform_center"   switch that adds/removes an optional transform
//   data-show-when="gps.device=socket"       shown only while that path has that value
import { byId, readJSON } from '../lib/dom.js';
import { initEditorModes } from '../components/editor-modes.js';
import { JsonEditor } from '../components/json-editor.js';
import { PlatformPreview } from '../components/platform-preview.js';

const form = byId('platform-form');
const formPane = byId('form-pane');
const json = new JsonEditor(byId('json-editor'), byId('line-numbers'), byId('line-numbers-container'));
const preview = new PlatformPreview(byId('preview-top'), byId('preview-side'));
const HITCH_NAMES = readJSON('hitch_names');
// Hitch names config.json has PLC variables for (null when config.json could not be read).
const CONFIG_HITCH_NAMES = readJSON('config_hitch_names');

let settings;
let activeHitch = null;
let uid = 0;

// ----------------------------------------------------------------- Model

const transform = () => ({ T: [0, 0, 0], R: [0, 0, 0] });
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function normaliseTransform(value) {
    const result = isObject(value) ? value : {};
    for (const key of ['T', 'R']) {
        const vector = Array.isArray(result[key]) ? result[key] : [];
        result[key] = [0, 1, 2].map((i) => Number(vector[i]) || 0);
    }
    return result;
}

/** Fills in what the form needs without dropping keys it does not know. */
function normalise(data) {
    const result = isObject(data) ? data : {};
    result.name ??= '';
    result.robot = isObject(result.robot) ? result.robot : {};
    result.robot.transform = normaliseTransform(result.robot.transform);
    for (const key of ['transform_center', 'transform_head']) {
        if (result.robot[key] !== undefined) result.robot[key] = normaliseTransform(result.robot[key]);
    }
    result.auto_velocity = isObject(result.auto_velocity) ? result.auto_velocity : { min: 0, max: 1 };
    result.auto_max_accel = isObject(result.auto_max_accel) ? result.auto_max_accel : { linear: 0, angular: 0.1 };
    for (const key of ['nav_modes', 'auto_modes', 'hitches']) {
        result[key] = Array.isArray(result[key]) ? result[key].filter(isObject) : [];
    }
    for (const hitch of result.hitches) {
        hitch.transform = normaliseTransform(hitch.transform);
        hitch.types = Array.isArray(hitch.types) ? hitch.types : [];
    }
    result.gps = isObject(result.gps) ? result.gps : { device: 'socket' };
    result.gps.transform = normaliseTransform(result.gps.transform);
    return result;
}

const segments = (path) => path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

function getPath(object, path) {
    return segments(path).reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function setPath(object, path, value) {
    const keys = segments(path);
    const last = keys.pop();
    let target = object;
    keys.forEach((key, i) => {
        if (target[key] == null) target[key] = typeof (keys[i + 1] ?? last) === 'number' ? [] : {};
        target = target[key];
    });
    if (value === undefined) delete target[last];
    else target[last] = value;
}

/** The value an input stands for; undefined removes an optional key. */
function inputValue(input) {
    const type = input.dataset.type ?? 'string';
    const text = input.value.trim();
    if (type.startsWith('optional-') && text === '') return undefined;
    if (type.endsWith('int')) return Number.isFinite(parseInt(text, 10)) ? parseInt(text, 10) : 0;
    if (type.endsWith('number')) return Number.isFinite(parseFloat(text)) ? parseFloat(text) : 0;
    return input.value;
}

/** Shows `value` in an input; a select gets an extra option for a value it does not list. */
function showValue(input, value) {
    if (input.dataset.type === 'checkbox-list') {
        input.checked = Array.isArray(value) && value.includes(input.value);
        return;
    }
    const text = value ?? '';
    if (input.tagName === 'SELECT' && text !== '' && ![...input.options].some((option) => option.value === String(text))) {
        input.add(new Option(`${text} (unknown)`, text));
    }
    input.value = text;
}

// ------------------------------------------------------------------ Form

function render() {
    for (const input of formPane.querySelectorAll('[data-path]')) {
        showValue(input, getPath(settings, input.dataset.path));
    }
    for (const toggle of formPane.querySelectorAll('[data-optional]')) {
        toggle.checked = getPath(settings, toggle.dataset.optional) !== undefined;
    }
    for (const list of formPane.querySelectorAll('[data-list]')) renderList(list);
    updateVisibility();
}

function updateVisibility() {
    for (const body of formPane.querySelectorAll('[data-optional-body]')) {
        body.hidden = getPath(settings, body.dataset.optionalBody) === undefined;
    }
    for (const element of formPane.querySelectorAll('[data-show-when]')) {
        const [path, value] = element.dataset.showWhen.split('=');
        element.hidden = String(getPath(settings, path) ?? '') !== value;
    }
}

function renderList(list) {
    const template = byId(list.dataset.template);
    const items = settings[list.dataset.list];
    list.replaceChildren(...items.map((item, index) => {
        const element = template.content.firstElementChild.cloneNode(true);
        const prefix = `item-${++uid}`;
        element.dataset.index = index;
        for (const [i, input] of [...element.querySelectorAll('[data-key]')].entries()) {
            input.id = `${prefix}-${i}`;
            const label = input.closest('.form-check')?.querySelector('label')
                ?? input.parentElement.querySelector(':scope > label.field-label');
            if (label && !label.htmlFor) label.htmlFor = input.id;
            showValue(input, getPath(item, input.dataset.key));
        }
        const body = element.querySelector('[data-item-body]');
        if (body) {
            body.id = `${prefix}-body`;
            const toggle = element.querySelector('[data-bs-toggle="collapse"]');
            toggle.dataset.bsTarget = `#${body.id}`;
            toggle.setAttribute('aria-controls', body.id);
        }
        updateItemTitle(list.dataset.list, element, item);
        return element;
    }));
}

function updateItemTitle(listName, element, item) {
    const title = element.querySelector('[data-item-title]');
    if (title && listName === 'hitches') title.textContent = `Hitch ${item.name ?? ''}`;
}

function newItem(listName) {
    const items = settings[listName];
    const nextId = Math.max(0, ...items.map((item) => Number(item.id) || 0)) + 1;
    if (listName === 'hitches') {
        const used = new Set(items.map((hitch) => hitch.name));
        const usable = CONFIG_HITCH_NAMES ?? HITCH_NAMES;
        return {
            name: usable.find((name) => !used.has(name)) ?? HITCH_NAMES.find((name) => !used.has(name)) ?? HITCH_NAMES[0],
            min: 0, max: 50, types: ['hitch'], transform: transform(), link_length: 0.5,
        };
    }
    if (listName === 'nav_modes') return { id: 3, name: 'pure pp' };
    return { id: nextId, name: 'auto' };
}

/** Applies an edit of `input` to the settings. */
function applyInput(input) {
    const itemElement = input.closest('[data-item]');
    if (itemElement) {
        const listName = itemElement.closest('[data-list]').dataset.list;
        const item = settings[listName][Number(itemElement.dataset.index)];
        if (input.dataset.type === 'checkbox-list') {
            const boxes = itemElement.querySelectorAll(`[data-key="${input.dataset.key}"]`);
            setPath(item, input.dataset.key, [...boxes].filter((box) => box.checked).map((box) => box.value));
        } else {
            setPath(item, input.dataset.key, inputValue(input));
        }
        updateItemTitle(listName, itemElement, item);
    } else if (input.dataset.path) {
        setPath(settings, input.dataset.path, inputValue(input));
    } else if (input.dataset.optional) {
        // A separate centre/head starts at the reference point.
        setPath(settings, input.dataset.optional, input.checked ? structuredClone(settings.robot.transform) : undefined);
        const body = formPane.querySelector(`[data-optional-body="${input.dataset.optional}"]`);
        for (const field of body.querySelectorAll('[data-path]')) showValue(field, getPath(settings, field.dataset.path));
    } else {
        return;
    }
    input.classList.remove('is-invalid');
    updateVisibility();
    draw();
}

// Text inputs, selects and checkboxes all fire `input`.
formPane.addEventListener('input', (event) => applyInput(event.target));

formPane.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    const remove = event.target.closest('[data-remove]');
    if (add) {
        const listName = add.dataset.add;
        settings[listName].push(newItem(listName));
        if (listName === 'hitches') activeHitch = settings.hitches.length - 1;
        renderList(formPane.querySelector(`[data-list="${listName}"]`));
        draw();
    } else if (remove) {
        const itemElement = remove.closest('[data-item]');
        const list = itemElement.closest('[data-list]');
        settings[list.dataset.list].splice(Number(itemElement.dataset.index), 1);
        activeHitch = null;
        renderList(list);
        draw();
    }
});

formPane.addEventListener('focusin', (event) => {
    const item = event.target.closest('[data-list="hitches"] [data-item]');
    const index = item ? Number(item.dataset.index) : null;
    if (index !== activeHitch) {
        activeHitch = index;
        draw();
    }
});

/** Marks values that artof-core or the app would reject; returns whether all are valid. */
function validateForm() {
    let valid = true;
    const mark = (input, invalid) => {
        input.classList.toggle('is-invalid', invalid);
        if (invalid) valid = false;
    };
    mark(byId('platform-name'), !settings.name.trim());
    mark(byId('robot-width'), !(settings.robot.width > 0));
    mark(byId('robot-length'), !(settings.robot.length > 0));
    mark(byId('auto-vel-max'), Number(settings.auto_velocity.max) < Number(settings.auto_velocity.min));

    const names = settings.hitches.map((hitch) => hitch.name);
    for (const element of formPane.querySelectorAll('[data-list="hitches"] [data-item]')) {
        const hitch = settings.hitches[Number(element.dataset.index)];
        const badName = names.filter((name) => name === hitch.name).length > 1
            || (CONFIG_HITCH_NAMES !== null && !CONFIG_HITCH_NAMES.includes(hitch.name));
        const badRange = Number(hitch.max) < Number(hitch.min);
        mark(element.querySelector('[data-key="name"]'), badName);
        mark(element.querySelector('[data-key="max"]'), badRange);
        if (badName || badRange) {
            bootstrap.Collapse.getOrCreateInstance(element.querySelector('[data-item-body]'), { toggle: false }).show();
        }
    }
    for (const element of formPane.querySelectorAll('[data-list] [data-item] [data-key="name"]')) {
        if (element.tagName === 'INPUT') mark(element, !element.value.trim());
    }
    return valid;
}

// ---------------------------------------------------------------- Preview

function draw() {
    preview.draw(settings, activeHitch);
}

// ------------------------------------------------------------------- Start

settings = normalise(readJSON('settings_data'));
render();
draw();

initEditorModes({
    form,
    json,
    dataInput: byId('platform-data'),
    storageKey: 'platform-editor-mode',
    rawJson: readJSON('raw_json'),
    getValue: () => settings,
    setValue: (value) => {
        settings = normalise(value);
        activeHitch = null;
        render();
        draw();
    },
    previewJson: (value) => preview.draw(normalise(structuredClone(value)), null),
    validateForm,
});
