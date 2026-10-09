// Helpers for the schematic SVG drawings of the robot (implement and settings editors).
// World coordinates are metres in the GPS frame of settings.json (+x left, +y forward, +z up);
// drawings use PX_PER_M svg units per metre and are fitted to their element with a viewBox.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const PX_PER_M = 100;
const TARGET_FONT_PX = 11;

export const vec = (v) => [Number(v?.[0]) || 0, Number(v?.[1]) || 0, Number(v?.[2]) || 0];
export const num = (value, fallback = 0) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);

export function el(name, attributes = {}, parent = null) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent?.append(element);
    return element;
}

/** Centre of the robot outline: `transform_center` when set, else the reference point `transform`. */
export function robotCentre(robot) {
    return vec((robot.transform_center ?? robot.transform)?.T);
}

/** A nice round length for the scale bar, about a fifth of `extent`. */
export function scaleLength(extent) {
    const raw = extent / 5;
    const power = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((f) => f * power).find((value) => value >= raw) ?? raw;
}

export class Bounds {
    constructor() {
        this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity;
    }
    add(x, y) {
        this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x);
        this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y);
    }
    get empty() { return this.minX > this.maxX; }
}

/** Sets the SVG's viewBox around `bounds` (svg units) and returns the font size that renders at ~11 px. */
export function fit(svg, bounds, padding) {
    const width = bounds.maxX - bounds.minX + 2 * padding;
    const height = bounds.maxY - bounds.minY + 2 * padding;
    svg.setAttribute('viewBox', `${bounds.minX - padding} ${bounds.minY - padding} ${width} ${height}`);
    // The drawing is scaled to fit both the width and the CSS max-height (preserveAspectRatio meet).
    const rect = svg.getBoundingClientRect();
    const scale = rect.width && rect.height ? Math.min(rect.width / width, rect.height / height) : 400 / width;
    return TARGET_FONT_PX / scale;
}

/** Redraws when the element's width changes; not on height changes, which follow the viewBox and would loop. */
export function redrawOnResize(element, redraw) {
    let width = 0;
    new ResizeObserver(([entry]) => {
        if (Math.abs(entry.contentRect.width - width) < 1) return;
        width = entry.contentRect.width;
        redraw();
    }).observe(element);
}

/** Scale bar under the drawing (the axis key is a caption in the template). */
export function drawScale(svg, bounds, extent, font, stroke) {
    const metres = scaleLength(extent / PX_PER_M);
    const length = metres * PX_PER_M;
    // Below the labels that hang under the lowest shape.
    const x = bounds.minX;
    const y = bounds.maxY + font * 3;
    const tick = font * 0.4;
    el('path', {
        class: 'ip-axis',
        d: `M${x},${y - tick} V${y + tick} M${x},${y} H${x + length} M${x + length},${y - tick} V${y + tick}`,
        'stroke-width': stroke * 1.5, fill: 'none',
    }, svg);
    const text = el('text', { class: 'ip-label', x: x + length + font * 0.5, y, 'dominant-baseline': 'middle' }, svg);
    text.textContent = `${metres} m`;

    const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh + font * 2.5}`);
}
