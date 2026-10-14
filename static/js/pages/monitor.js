import { History, LiveGraph, MAX_TRACES } from '../components/live-graph.js';
import { showError, showToast } from '../components/toast-stack.js';
import { bindTableSearch, byId, show, withBusy } from '../lib/dom.js';
import { postJSON } from '../lib/http.js';
import { LiveSocket } from '../lib/live-socket.js';

// Pinned variable names, graphed variable names and whether the graph is collapsed, kept in this browser.
const PINNED_KEY = 'monitor-pinned';
const GRAPHED_KEY = 'monitor-graphed';
const GRAPH_COLLAPSED_KEY = 'monitor-graph-collapsed';

function loadList(key) {
    try {
        const names = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(names) ? names : [];
    } catch {
        return [];
    }
}

function store(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Without storage the setting only lasts for this page.
    }
}

function formatValue(type, value) {
    if (type === 'bool') return value ? 'true' : 'false';
    if (type.includes('int')) return Number(value).toFixed(0);
    if (type === 'float' || type === 'double') return Number(value).toFixed(5);
    return String(value);
}

/** One row of the monitor table: shows the live value of a Redis variable and lets the user write a new one. */
class VariableRow {
    constructor(row, index, editUrl, pulseUrl) {
        this.row = row;
        this.index = index;
        this.name = row.dataset.variable;
        this.type = row.dataset.type;
        this.valueCell = row.querySelector('[data-value]');
        this.input = row.querySelector('[data-edit]');
        this.editUrl = editUrl;
        this.pulseUrl = pulseUrl;

        const button = row.querySelector('[data-upload]');
        button.addEventListener('click', () => withBusy(button, this.write()));
        const pulseButton = row.querySelector('[data-pulse]');
        pulseButton?.addEventListener('click', () => withBusy(pulseButton, this.pulse()));
        this.pinButton = row.querySelector('[data-pin]');
        this.graphButton = row.querySelector('button[data-graph]');
    }

    setGraphed(graphed) {
        if (!this.graphButton) return;
        this.graphButton.setAttribute('aria-pressed', graphed);
        this.graphButton.title = graphed ? 'Remove from the graph' : 'Show in the graph';
        this.graphButton.setAttribute('aria-label', `${graphed ? 'Remove' : 'Show'} ${this.name} ${graphed ? 'from' : 'in'} the graph`);
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

    /** The server holds the opposite value for 0.5 s and answers once the variable is restored. */
    async pulse() {
        try {
            await postJSON(this.pulseUrl, { name: this.name });
        } catch (error) {
            showError(`Pulsing ${this.name}`, error);
        }
    }
}

/**
 * Pinned variables: their rows move to the pinned card at the top (live values and writing keep working there)
 * and go back to their place in the full list when unpinned. The pinned names are remembered in localStorage.
 */
class PinBoard {
    constructor(rows, table, pinnedTable, search, graph, history) {
        this.rows = rows;
        this.body = table.tBodies[0];
        this.pinnedBody = pinnedTable.tBodies[0];
        this.card = byId('monitor-pinned');
        this.search = search;
        this.graph = graph;
        this.history = history;
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
        return loadList(PINNED_KEY);
    }

    save() {
        store(PINNED_KEY, this.pinned);
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
        // Only pinned variables are recorded and graphed.
        this.graph.remove(variable.name);
        this.history.forget(variable.name);
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
    const variable = new VariableRow(row, index, table.dataset.editUrl, table.dataset.pulseUrl);
    rows.set(variable.name, variable);
});

/** The graph buttons of pinned rows add and remove traces; the traced names are remembered. */
function bindGraph(graph, rows) {
    const graphBody = byId('monitor-graph-body');
    const toggle = graph.card.querySelector('[data-bs-toggle="collapse"]');
    let collapsed = false;
    try {
        collapsed = localStorage.getItem(GRAPH_COLLAPSED_KEY) === 'true';
    } catch {
        // Expanded by default.
    }
    if (collapsed) {
        graphBody.classList.remove('show');
        toggle.setAttribute('aria-expanded', 'false');
    }
    graphBody.addEventListener('shown.bs.collapse', () => {
        store(GRAPH_COLLAPSED_KEY, false);
        graph.render();
    });
    graphBody.addEventListener('hidden.bs.collapse', () => store(GRAPH_COLLAPSED_KEY, true));

    for (const variable of rows.values()) {
        variable.graphButton?.addEventListener('click', () => {
            if (graph.has(variable.name)) graph.remove(variable.name);
            else if (!graph.add(variable.name, variable.type)) {
                showToast(`The graph shows at most ${MAX_TRACES} variables.`, 'warning');
            }
        });
    }
    byId('monitor-graph-clear').addEventListener('click', () => graph.clear());
}

bindTableSearch(search, table);
// Read before the graph exists: it stores its (still empty) list of traces when created.
const savedGraphed = loadList(GRAPHED_KEY);
const history = new History();
const graph = new LiveGraph(byId('monitor-graph'), history, (names) => {
    for (const variable of rows.values()) variable.setGraphed(names.includes(variable.name));
    store(GRAPHED_KEY, names);
});
bindGraph(graph, rows);
const board = new PinBoard(rows, table, byId('monitor-pinned-table'), search, graph, history);
// Restore the traces after the pins, so only pinned variables come back.
const graphed = savedGraphed.filter((name) => board.pinned.includes(name));
for (const name of graphed) graph.add(name, rows.get(name).type);

new LiveSocket('/ws/redis/', ({ variables }) => {
    const now = Date.now();
    for (const [name, value] of Object.entries(variables)) {
        rows.get(name)?.show(value);
    }
    for (const name of board.pinned) {
        if (name in variables) history.record(name, variables[name], now);
    }
    graph.render(now);
});
