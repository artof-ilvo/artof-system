// Live graph of Redis variables: one strip per trace, stacked on a shared time axis
// (like a logic analyzer), so booleans and numbers of any scale each get their own y range.

// Time shown in the graph (ms), and the spacing of the vertical grid lines (ms).
export const WINDOW_MS = 30000;
const GRID_MS = 10000;
// Categorical colours, assigned in this order and kept by a trace while it is shown.
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const MAX_TRACES = SERIES_COLORS.length;
// SVG user units of a strip; the SVG is stretched to the strip, strokes keep their width.
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 100;
const PAD_Y = 10;

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(tag, attributes) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
}

function htmlElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/** Number that can be plotted, or null (strings and missing values). */
function plotValue(value) {
    if (typeof value === 'boolean') return value ? 1 : 0;
    const number = Number(value);
    return value === null || value === '' || !Number.isFinite(number) ? null : number;
}

/** Four significant digits, without trailing zeros (and no exponent for large values). */
function formatNumber(value) {
    if (Math.abs(value) >= 1000) return String(Math.round(value));
    return String(Number(value.toPrecision(4)));
}

/** Recent samples of the variables, kept for WINDOW_MS. */
export class History {
    constructor() {
        /** @type {Map<string, {t: number, v: number}[]>} */
        this.samples = new Map();
    }

    record(name, value, t) {
        const v = plotValue(value);
        if (v === null) return;
        let samples = this.samples.get(name);
        if (!samples) this.samples.set(name, samples = []);
        samples.push({ t, v });
        // Keep one sample before the window, so lines reach the left edge.
        let drop = 0;
        while (drop + 1 < samples.length && samples[drop + 1].t < t - WINDOW_MS) drop++;
        if (drop) samples.splice(0, drop);
    }

    forget(name) {
        this.samples.delete(name);
    }

    get(name) {
        return this.samples.get(name) ?? [];
    }
}

/** One trace: a label (colour, name, value) next to its plot. */
class Strip {
    constructor(name, type, color) {
        this.name = name;
        this.step = type === 'bool' || type.includes('int');
        this.bool = type === 'bool';

        this.element = htmlElement('div', 'graph-strip');
        this.element.style.setProperty('--trace-color', color);

        const label = htmlElement('div', 'graph-label');
        const swatch = htmlElement('span', 'graph-swatch');
        const title = htmlElement('span', 'graph-name', name);
        title.title = name;
        this.valueLabel = htmlElement('span', 'graph-value');
        label.append(swatch, title, this.valueLabel);

        const scale = htmlElement('div', 'graph-scale');
        this.maxLabel = htmlElement('span', '', '');
        this.minLabel = htmlElement('span', '', '');
        scale.append(this.maxLabel, this.minLabel);

        const plot = htmlElement('div', 'graph-plot');
        this.svg = svgElement('svg', {
            viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
            preserveAspectRatio: 'none',
            role: 'img',
            'aria-label': `${name} over the last ${WINDOW_MS / 1000} seconds`,
        });
        for (let t = GRID_MS; t < WINDOW_MS; t += GRID_MS) {
            const x = VIEW_WIDTH * (1 - t / WINDOW_MS);
            this.svg.append(svgElement('line', { class: 'graph-grid', x1: x, x2: x, y1: 0, y2: VIEW_HEIGHT }));
        }
        this.path = svgElement('path', { class: 'graph-line' });
        this.cursor = svgElement('line', { class: 'graph-cursor', y1: 0, y2: VIEW_HEIGHT, visibility: 'hidden' });
        this.dot = svgElement('line', { class: 'graph-dot', visibility: 'hidden' });
        this.svg.append(this.path, this.cursor, this.dot);
        plot.append(this.svg);

        this.element.append(label, scale, plot);
    }

    /** Y range of the visible samples, with some room when the value is flat. */
    range(samples) {
        if (this.bool) return [0, 1];
        let min = Infinity;
        let max = -Infinity;
        for (const { v } of samples) {
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
        if (min === Infinity) return [0, 1];
        if (min === max) {
            const room = Math.abs(min) * 0.1 || 1;
            return [min - room, max + room];
        }
        return [min, max];
    }

    format(value) {
        if (this.bool) return value ? 'true' : 'false';
        return formatNumber(value);
    }

    /** Draws the samples; `cursorT` is the hovered time, or null to show the latest value. */
    render(samples, now, cursorT) {
        const [min, max] = this.range(samples);
        const x = (t) => VIEW_WIDTH * (1 - (now - t) / WINDOW_MS);
        const y = (v) => PAD_Y + (VIEW_HEIGHT - 2 * PAD_Y) * (1 - (v - min) / (max - min));

        let d = '';
        let previousY = null;
        for (const { t, v } of samples) {
            const px = x(t).toFixed(1);
            const py = y(v).toFixed(1);
            if (previousY === null) d += `M${px} ${py}`;
            else d += this.step ? `H${px}V${py}` : `L${px} ${py}`;
            previousY = py;
        }
        if (previousY !== null) d += this.step ? `H${VIEW_WIDTH}` : '';
        this.path.setAttribute('d', d);

        this.maxLabel.textContent = this.format(max);
        this.minLabel.textContent = this.format(min);

        let shown = samples.at(-1);
        if (cursorT !== null) {
            // The value at the hovered time: the last sample at or before it.
            shown = undefined;
            for (const sample of samples) {
                if (sample.t > cursorT) break;
                shown = sample;
            }
            const cx = x(cursorT);
            this.cursor.setAttribute('x1', cx);
            this.cursor.setAttribute('x2', cx);
            this.cursor.setAttribute('visibility', 'visible');
            if (shown) {
                const cy = y(shown.v);
                // A zero-length line with a round cap draws a dot that is not stretched by the viewBox.
                for (const [name, value] of [['x1', cx], ['x2', cx], ['y1', cy], ['y2', cy]]) {
                    this.dot.setAttribute(name, value);
                }
            }
            this.dot.setAttribute('visibility', shown ? 'visible' : 'hidden');
        } else {
            this.cursor.setAttribute('visibility', 'hidden');
            this.dot.setAttribute('visibility', 'hidden');
        }
        this.valueLabel.textContent = shown ? this.format(shown.v) : '–';
    }
}

/**
 * The graph card: traces are added and removed by name, each keeps its colour while shown.
 * The card is hidden while it has no traces; `onChange` is called with the traced names.
 */
export class LiveGraph {
    constructor(card, history, onChange) {
        this.card = card;
        this.history = history;
        this.onChange = onChange;
        this.body = card.querySelector('[data-graph-body]');
        this.plots = card.querySelector('[data-graph-strips]');
        this.cursorLabel = card.querySelector('[data-graph-cursor]');
        /** @type {Map<string, Strip>} */
        this.strips = new Map();
        this.cursorFraction = null;

        this.plots.addEventListener('pointermove', (event) => {
            const plot = event.target.closest('.graph-plot');
            if (!plot) return this.setCursor(null);
            const box = plot.getBoundingClientRect();
            this.setCursor(Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1));
        });
        this.plots.addEventListener('pointerleave', () => this.setCursor(null));
        this.update();
    }

    has(name) {
        return this.strips.has(name);
    }

    get names() {
        return [...this.strips.keys()];
    }

    add(name, type) {
        if (this.strips.has(name) || this.strips.size >= MAX_TRACES) return false;
        const used = new Set([...this.strips.values()].map((strip) => strip.color));
        const color = SERIES_COLORS.find((candidate) => !used.has(candidate));
        const strip = new Strip(name, type, color);
        strip.color = color;
        this.strips.set(name, strip);
        this.plots.append(strip.element);
        this.update();
        return true;
    }

    remove(name) {
        const strip = this.strips.get(name);
        if (!strip) return;
        strip.element.remove();
        this.strips.delete(name);
        this.update();
    }

    clear() {
        for (const name of this.names) this.remove(name);
    }

    update() {
        this.card.hidden = this.strips.size === 0;
        this.render();
        this.onChange?.(this.names);
    }

    setCursor(fraction) {
        this.cursorFraction = fraction;
        this.render();
    }

    render(now = Date.now()) {
        if (this.card.hidden || !this.body.classList.contains('show')) return;
        const cursorT = this.cursorFraction === null ? null : now - WINDOW_MS * (1 - this.cursorFraction);
        for (const strip of this.strips.values()) {
            strip.render(this.history.get(strip.name), now, cursorT);
        }
        this.cursorLabel.textContent = cursorT === null ? '' : `${((cursorT - now) / 1000).toFixed(1)} s`;
    }
}
