import { showError, showToast } from '../components/toast-stack.js';
import { withBusy } from '../lib/dom.js';
import { get, postJSON } from '../lib/http.js';

const LABELS = { rate: ['Rate', 'rates'], routine: ['Routine', 'routines'] };

/** Lat/lng of feature `index` of a task in the field data (polygon ring or point), or null. */
export function taskFeature(field, taskName, index) {
    const geometry = taskName ? field.tasks[taskName]?.geometry : null;
    return geometry && !geometry.empty ? geometry.latlng?.[index] ?? null : null;
}

/**
 * The rate (continuous, cardan) or routine (discrete, intermittent) of every polygon/point of a task,
 * one input per feature (templates/components/container_task_edit.html, `data-task-attribute`).
 * Focusing an input highlights its feature on the map.
 */
export class TaskAttributeEditor {
    constructor(root, { getFieldName, highlightFeature }) {
        this.root = root;
        this.taskName = root.dataset.taskAttribute ?? null;
        this.url = root.dataset.url;
        this.getFieldName = getFieldName;
        this.highlightFeature = highlightFeature;
        this.attribute = null;

        root.addEventListener('input', (event) => {
            if (event.target.matches('.attribute-row input')) this.saveButton.disabled = false;
        });
        // The editor sits inside the task's form: Enter must not submit that form.
        root.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.preventDefault();
        });
    }

    /** Shows the attribute of another task; null hides the editor. */
    setTask(taskName) {
        this.taskName = taskName;
        if (taskName) return this.load();
        this.render(null);
    }

    async load() {
        const taskName = this.taskName;
        const params = new URLSearchParams({ field_name: this.getFieldName(), task_name: taskName });
        try {
            const response = await get(`${this.url}?${params}`);
            const { attribute } = await response.json();
            // Another task may have been selected meanwhile.
            if (this.taskName === taskName) this.render(attribute);
        } catch (error) {
            showError(`Loading the attributes of ${taskName}`, error);
        }
    }

    render(attribute) {
        this.attribute = attribute;
        this.root.hidden = !attribute;
        this.root.replaceChildren();
        if (!attribute) return;

        const [label, plural] = LABELS[attribute.name] ?? [attribute.name, attribute.name];
        const step = attribute.type === 'int' ? '1' : 'any';
        this.root.innerHTML = `
            <div class="d-flex flex-wrap align-items-end justify-content-between gap-2">
                <div>
                    <span class="field-label d-block m-0">${label} per feature</span>
                    <span class="small text-body-secondary">Default ${attribute.default}</span>
                </div>
                <div class="input-group input-group-sm set-all">
                    <input type="number" class="form-control" step="${step}" min="0" placeholder="${label}" aria-label="${label} for all features" data-set-all>
                    <button type="button" class="btn btn-outline-secondary" data-apply-all>Set all</button>
                </div>
            </div>
            <p class="mode-info my-2" data-not-stored hidden>Not stored yet: the default is shown. Save to store it.</p>
            <div class="attribute-list" data-list></div>
            <div class="d-flex justify-content-end mt-2">
                <button type="button" class="btn btn-primary btn-sm" data-save disabled>Save ${plural}</button>
            </div>`;

        const list = this.root.querySelector('[data-list]');
        this.saveButton = this.root.querySelector('[data-save]');
        this.root.querySelector('[data-not-stored]').hidden = attribute.stored;

        if (attribute.values.length === 0) {
            list.outerHTML = '<p class="mode-info my-2">No features yet: add a shape to this task first.</p>';
            this.root.querySelector('[data-apply-all]').disabled = true;
        }

        this.inputs = attribute.values.map((value, index) => {
            const row = document.createElement('label');
            row.className = 'attribute-row';
            row.innerHTML = `<span>#${index + 1}</span>
                <input type="number" class="form-control form-control-sm" step="${step}" min="0" aria-label="${label} of feature ${index + 1}">`;
            const input = row.querySelector('input');
            input.value = value;
            input.addEventListener('focus', () => this.highlightFeature(this.taskName, index));
            input.addEventListener('blur', () => this.highlightFeature(null));
            list.append(row);
            return input;
        });

        this.root.querySelector('[data-apply-all]').addEventListener('click', () => this.setAll());
        this.saveButton.addEventListener('click', () => withBusy(this.saveButton, this.save()));
        if (!attribute.stored && attribute.values.length) this.saveButton.disabled = false;
    }

    setAll() {
        const value = this.root.querySelector('[data-set-all]').value;
        if (value === '') return;
        for (const input of this.inputs) input.value = value;
        this.saveButton.disabled = false;
    }

    async save() {
        const invalid = this.inputs.find((input) => input.value === '' || !input.checkValidity());
        if (invalid) {
            invalid.focus();
            showToast(`Enter a valid ${this.attribute.name} for every feature.`, 'warning');
            return;
        }
        try {
            const result = await postJSON(this.url, {
                field_name: this.getFieldName(),
                task_name: this.taskName,
                values: this.inputs.map((input) => Number(input.value)),
            });
            this.render(result.attribute);
            showToast(`${LABELS[this.attribute.name]?.[0] ?? this.attribute.name} of ${this.taskName} saved.`);
        } catch (error) {
            showError('Saving', error);
        }
    }
}
