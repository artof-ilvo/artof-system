// Form | JSON toggle for editors that edit one JSON object in either a form or the JSON editor
// (implement and settings editors). Expects the markup of those templates: radios named
// `editor-mode` (values form/json, ids editor-mode-<mode>), #form-pane, #json-pane and #format-button.
import { byId, checkedValue } from '../lib/dom.js';
import { showToast } from './toast-stack.js';

/**
 * @param {object} options
 * @param {HTMLFormElement} options.form
 * @param {import('./json-editor.js').JsonEditor} options.json
 * @param {HTMLInputElement} options.dataInput hidden input that receives the JSON on submit
 * @param {string} options.storageKey localStorage key of the last used mode
 * @param {string|null} options.rawJson text the server could not parse; opens JSON mode with it
 * @param {() => object} options.getValue the object as edited in the form
 * @param {(value: object) => void} options.setValue loads an object into the form
 * @param {(value: object) => void} [options.previewJson] called with valid JSON while typing
 * @param {() => boolean} [options.validateForm] marks invalid form fields; false blocks saving
 */
export function initEditorModes({ form, json, dataInput, storageKey, rawJson, getValue, setValue, previewJson, validateForm }) {
    const formPane = byId('form-pane');
    const jsonPane = byId('json-pane');
    const formatButton = byId('format-button');

    function showMode(mode) {
        formPane.hidden = mode !== 'form';
        jsonPane.hidden = mode !== 'json';
        formatButton.hidden = mode !== 'json';
        byId(`editor-mode-${mode}`).checked = true;
        try { localStorage.setItem(storageKey, mode); } catch { /* storage unavailable */ }
    }

    /** Parses the JSON pane into an object, or shows why it cannot. */
    function objectFromJson() {
        const { value, error } = json.tryParse();
        if (error) {
            showToast(`Invalid JSON: ${error.message}`, 'danger');
            return null;
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            showToast('The JSON must be an object ({ … }).', 'danger');
            return null;
        }
        return value;
    }

    form.addEventListener('change', (event) => {
        if (event.target.name !== 'editor-mode') return;
        if (event.target.value === 'json') {
            json.setValue(JSON.stringify(getValue(), null, 2));
            showMode('json');
        } else {
            const parsed = objectFromJson();
            if (!parsed) {
                showMode('json');
                return;
            }
            setValue(parsed);
            showMode('form');
        }
    });

    if (previewJson) {
        json.textarea.addEventListener('input', () => {
            const { value } = json.tryParse();
            if (value && typeof value === 'object' && !Array.isArray(value)) previewJson(value);
        });
    }

    formatButton.addEventListener('click', () => json.format());

    form.addEventListener('submit', (event) => {
        let value;
        if (checkedValue('editor-mode', form) === 'json') {
            value = objectFromJson();
            if (!value) {
                event.preventDefault();
                return;
            }
        } else {
            if (validateForm && !validateForm()) {
                event.preventDefault();
                showToast('Fix the marked fields before saving.', 'warning');
                return;
            }
            value = getValue();
        }
        dataInput.value = JSON.stringify(value);
    });

    if (rawJson !== null && rawJson !== undefined) {
        // The server rejected JSON it could not parse: show it as it was typed.
        json.setValue(rawJson);
        showMode('json');
        return;
    }
    let mode = 'form';
    try { mode = localStorage.getItem(storageKey) === 'json' ? 'json' : 'form'; } catch { /* storage unavailable */ }
    if (mode === 'json') json.setValue(JSON.stringify(getValue(), null, 2));
    showMode(mode);
}
