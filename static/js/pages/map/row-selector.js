import { showError } from '../../components/toast-stack.js';
import { postJSON } from '../../lib/http.js';

export const ALL_ROWS = -1;

/**
 * Parses the row selection text: "" or "All" for all rows, "2", "0,1,3" or "0-3".
 * Returns ALL_ROWS, a row number or a list of row numbers, as the server expects.
 */
export function parseRows(text) {
    text = text.trim();
    if (text === '' || text === 'All') return ALL_ROWS;
    if (/^-?\d+$/.test(text)) return parseInt(text, 10);

    const range = text.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
        const rows = [];
        for (let row = Number(range[1]); row <= Number(range[2]); row++) rows.push(row);
        return rows;
    }
    if (text.includes(',')) {
        return text.split(',').map((row) => parseInt(row, 10)).filter(Number.isInteger);
    }
    return ALL_ROWS;
}

/** The "Rows" control of the traject editor: selects rows and briefly highlights them on the map. */
export class RowSelector {
    constructor(root, { rowsUrl, highlightGroup, getPaths }) {
        this.input = root.querySelector('[data-row-input]');
        this.rowsUrl = rowsUrl;
        this.highlightGroup = highlightGroup;
        this.getPaths = getPaths;
        this.fadeTimer = null;

        root.querySelector('[data-row-action="next"]').addEventListener('click', () => this.highlight(this.next()));
        root.querySelector('[data-row-action="previous"]').addEventListener('click', () => this.highlight(this.previous()));
        root.querySelector('[data-row-action="all"]').addEventListener('click', () => this.highlight(ALL_ROWS));
        root.querySelector('[data-row-action="show"]').addEventListener('click', () => this.highlight(this.selected));
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.highlight(this.selected);
            }
        });
    }

    get selected() {
        return parseRows(this.input.value);
    }

    clear() {
        this.input.value = '';
    }

    /** Extends the selection by the row after it. */
    next() {
        const rows = this.selected;
        if (Array.isArray(rows)) return rows.length ? [...rows, rows[rows.length - 1] + 1] : ALL_ROWS;
        return rows + 1;
    }

    /** Extends the selection by the row before it. */
    previous() {
        const rows = this.selected;
        if (Array.isArray(rows)) return rows.length && rows[0] > 0 ? [rows[0] - 1, ...rows] : ALL_ROWS;
        return rows - 1;
    }

    /** Validates `rows` against the traject, writes the result in the input and flashes those rows on the map. */
    async highlight(rows) {
        let rowLatlngs;
        try {
            ({ latlng: rowLatlngs } = await postJSON(this.rowsUrl, { data: this.getPaths() }));
        } catch (error) {
            showError('Loading the rows', error);
            return;
        }

        const requested = typeof rows === 'number'
            ? (rows < 0 ? rowLatlngs.map((_, index) => index) : [rows])
            : rows;
        const valid = requested.filter((row) => row >= 0 && row < rowLatlngs.length);

        this.input.value = valid.length === rowLatlngs.length ? 'All' : valid.join(',');
        this.flash(valid.map((row) => rowLatlngs[row]));
    }

    flash(lines) {
        clearInterval(this.fadeTimer);
        this.highlightGroup.clearLayers();
        for (const line of lines) {
            L.polyline(line, { color: 'white', weight: 3 }).addTo(this.highlightGroup);
        }

        let opacity = 1;
        this.fadeTimer = setInterval(() => {
            opacity -= 0.1;
            this.highlightGroup.eachLayer((layer) => layer.setStyle({ opacity }));
            if (opacity <= 0) {
                clearInterval(this.fadeTimer);
                this.highlightGroup.clearLayers();
            }
        }, 100);
    }
}
