import { showError, showToast } from '../components/toast-stack.js';
import { bindTableSearch, byId, withBusy } from '../lib/dom.js';
import { postJSON } from '../lib/http.js';
import { LiveSocket } from '../lib/live-socket.js';

function formatValue(type, value) {
    if (type === 'bool') return value ? 'true' : 'false';
    if (type.includes('int')) return Number(value).toFixed(0);
    if (type === 'float' || type === 'double') return Number(value).toFixed(5);
    return String(value);
}

/** One row of the monitor table: shows the live value of a Redis variable and lets the user write a new one. */
class VariableRow {
    constructor(row, editUrl) {
        this.name = row.dataset.variable;
        this.type = row.dataset.type;
        this.valueCell = row.querySelector('[data-value]');
        this.input = row.querySelector('[data-edit]');
        this.editUrl = editUrl;

        const button = row.querySelector('[data-upload]');
        button.addEventListener('click', () => withBusy(button, this.write()));
    }

    show(value) {
        const text = formatValue(this.type, value);
        if (this.valueCell.textContent !== text) this.valueCell.textContent = text;
    }

    async write() {
        if (!this.input) return;
        const value = this.input.type === 'checkbox' ? this.input.checked : this.input.value;
        if (value === '') return;
        try {
            await postJSON(this.editUrl, { name: this.name, value });
            showToast(`${this.name} = ${value}`);
        } catch (error) {
            showError(`Writing ${this.name}`, error);
        }
    }
}

const table = byId('monitor-table');
const rows = new Map();
for (const row of table.tBodies[0].rows) {
    const variable = new VariableRow(row, table.dataset.editUrl);
    rows.set(variable.name, variable);
}

bindTableSearch(byId('search'), table);

new LiveSocket('/ws/redis/', ({ variables }) => {
    for (const [name, value] of Object.entries(variables)) {
        rows.get(name)?.show(value);
    }
});
