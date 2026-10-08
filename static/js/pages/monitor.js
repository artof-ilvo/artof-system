import { showError, showToast } from '../components/toast-stack.js';
import { bindTableSearch, byId, show, withBusy } from '../lib/dom.js';
import { postJSON } from '../lib/http.js';
import { LiveSocket } from '../lib/live-socket.js';

// Pinned variable names, kept in this browser.
const PINNED_KEY = 'monitor-pinned';

function formatValue(type, value) {
    if (type === 'bool') return value ? 'true' : 'false';
    if (type.includes('int')) return Number(value).toFixed(0);
    if (type === 'float' || type === 'double') return Number(value).toFixed(5);
    return String(value);
}

/** One row of the monitor table: shows the live value of a Redis variable and lets the user write a new one. */
class VariableRow {
    constructor(row, index, editUrl) {
        this.row = row;
        this.index = index;
        this.name = row.dataset.variable;
        this.type = row.dataset.type;
        this.valueCell = row.querySelector('[data-value]');
        this.input = row.querySelector('[data-edit]');
        this.editUrl = editUrl;

        const button = row.querySelector('[data-upload]');
        button.addEventListener('click', () => withBusy(button, this.write()));
        this.pinButton = row.querySelector('[data-pin]');
    }

    setPinned(pinned) {
        this.pinButton.setAttribute('aria-pressed', pinned);
        this.pinButton.title = pinned ? 'Unpin' : 'Pin to the top';
        this.pinButton.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${this.name}`);
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

/**
 * Pinned variables: their rows move to the pinned card at the top (live values and writing keep working there)
 * and go back to their place in the full list when unpinned. The pinned names are remembered in localStorage.
 */
class PinBoard {
    constructor(rows, table, pinnedTable, search) {
        this.rows = rows;
        this.body = table.tBodies[0];
        this.pinnedBody = pinnedTable.tBodies[0];
        this.card = byId('monitor-pinned');
        this.search = search;
        /** @type {string[]} */
        this.pinned = [];

        for (const variable of rows.values()) {
            variable.pinButton.addEventListener('click', () => this.toggle(variable));
        }
        byId('monitor-unpin-all').addEventListener('click', () => {
            for (const name of [...this.pinned]) this.toggle(this.rows.get(name));
        });

        // Variables that no longer exist are dropped.
        for (const name of this.load()) {
            const variable = rows.get(name);
            if (variable && !this.pinned.includes(name)) this.pin(variable);
        }
        this.update();
    }

    load() {
        try {
            const names = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]');
            return Array.isArray(names) ? names : [];
        } catch {
            return [];
        }
    }

    save() {
        try {
            localStorage.setItem(PINNED_KEY, JSON.stringify(this.pinned));
        } catch {
            // Without storage the pins only last for this page.
        }
    }

    toggle(variable) {
        if (this.pinned.includes(variable.name)) this.unpin(variable);
        else this.pin(variable);
        this.update();
        this.save();
    }

    pin(variable) {
        this.pinned.push(variable.name);
        show(variable.row);  // the search only filters the full list
        this.pinnedBody.append(variable.row);
        variable.setPinned(true);
    }

    unpin(variable) {
        this.pinned = this.pinned.filter((name) => name !== variable.name);
        const next = [...this.body.rows].find((row) => this.rows.get(row.dataset.variable).index > variable.index);
        this.body.insertBefore(variable.row, next ?? null);
        variable.setPinned(false);
        // Apply the current search to the row that came back.
        this.search.dispatchEvent(new Event('input'));
    }

    update() {
        this.card.hidden = this.pinned.length === 0;
    }
}

const table = byId('monitor-table');
const search = byId('search');
const rows = new Map();
[...table.tBodies[0].rows].forEach((row, index) => {
    const variable = new VariableRow(row, index, table.dataset.editUrl);
    rows.set(variable.name, variable);
});

bindTableSearch(search, table);
new PinBoard(rows, table, byId('monitor-pinned-table'), search);

new LiveSocket('/ws/redis/', ({ variables }) => {
    for (const [name, value] of Object.entries(variables)) {
        rows.get(name)?.show(value);
    }
});
