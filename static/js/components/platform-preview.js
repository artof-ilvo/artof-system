// SVG top and side view of the robot as settings.json describes it, for the settings editor.
//
// Everything is in the GPS frame (+x right, +y forward, +z up), as artof-core's Platform::updateState:
// robot reference point, rotation centre, head and hitches are transforms from the frame origin.
// The antenna sits at -gps.T (the GPS transform goes from the antenna to the origin; its rotation is
// ignored here). Hitch balls are drawn with the hitch lowered: hitch T + (0, -link_length, 0).
import { Bounds, PX_PER_M, drawScale, el, fit, num, redrawOnResize, robotCentre, vec } from '../lib/svg-drawing.js';

/** Points of interest in the GPS frame. */
function geometry(settings) {
    const robot = settings.robot ?? {};
    const reference = vec(robot.transform?.T);
    const points = [{ kind: 'origin', label: 'origin', at: [0, 0, 0] }];
    const gpsT = vec(settings.gps?.transform?.T);
    points.push({ kind: 'antenna', label: 'GPS', at: [-gpsT[0], -gpsT[1], -gpsT[2]] });
    points.push({ kind: 'ref', label: 'reference', at: reference });
    if (robot.transform_center) points.push({ kind: 'ref', label: 'centre', at: vec(robot.transform_center.T) });
    if (robot.transform_head) points.push({ kind: 'ref', label: 'head', at: vec(robot.transform_head.T) });

    const hitches = (settings.hitches ?? []).map((hitch, index) => {
        const at = vec(hitch.transform?.T);
        return { index, name: hitch.name ?? '', at, ball: [at[0], at[1] - num(hitch.link_length), at[2]] };
    });
    const body = {
        centre: robotCentre(robot),
        width: num(robot.width),
        length: num(robot.length),
        wheel: num(robot.wheel_diameter),
    };
    return { points, hitches, body };
}

export class PlatformPreview {
    constructor(topSvg, sideSvg) {
        this.topSvg = topSvg;
        this.sideSvg = sideSvg;
        redrawOnResize(topSvg, () => this.last && this.draw(...this.last));
    }

    /**
     * @param {object} settings settings.json content
     * @param {number|null} activeHitch index of the hitch being edited
     */
    draw(settings, activeHitch = null) {
        this.last = [settings, activeHitch];
        const data = geometry(settings);
        // Top view: world x (right) to svg right, world y (forward) up.
        this.drawView(this.topSvg, data, activeHitch, (p) => [p[0] * PX_PER_M, -p[1] * PX_PER_M], 'top');
        // Side view from the robot's left side: forward to the left, z up.
        this.drawView(this.sideSvg, data, activeHitch, (p) => [-p[1] * PX_PER_M, -p[2] * PX_PER_M], 'side');
    }

    drawView(svg, { points, hitches, body }, activeHitch, project, view) {
        svg.replaceChildren();
        const bounds = new Bounds();
        const add = (p) => bounds.add(...project(p));

        // Robot outline: width × length around the centre (top), length × (ref z .. 0 or wheel height) (side).
        let corners = null;
        if (body.width > 0 && body.length > 0) {
            const [cx, cy, cz] = body.centre;
            corners = view === 'top'
                ? [[cx - body.width / 2, cy - body.length / 2, 0], [cx + body.width / 2, cy + body.length / 2, 0]]
                : [[0, cy - body.length / 2, cz], [0, cy + body.length / 2, Math.max(0, cz + body.wheel)]];
            corners.forEach(add);
        }
        points.forEach((point) => add(point.at));
        hitches.forEach((hitch) => { add(hitch.at); add(hitch.ball); });

        const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, PX_PER_M);
        const font = fit(svg, bounds, extent * (view === 'top' ? 0.12 : 0.08));
        const stroke = font / 8;
        svg.style.setProperty('--ip-font', `${font}px`);

        if (corners) {
            const [x0, y0] = project(corners[0]);
            const [x1, y1] = project(corners[1]);
            el('rect', {
                class: 'ip-robot',
                x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
                rx: stroke * 4, 'stroke-width': stroke,
            }, svg);
        }

        for (const hitch of hitches) {
            const active = hitch.index === activeHitch;
            const [hx, hy] = project(hitch.at);
            const [bx, by] = project(hitch.ball);
            el('line', { class: `ip-link${active ? ' is-active' : ''}`, x1: hx, y1: hy, x2: bx, y2: by, 'stroke-width': stroke * (active ? 3 : 2) }, svg);
            el('circle', { class: `ip-hitch${active ? ' is-active' : ''}`, cx: hx, cy: hy, r: stroke * 3 }, svg);
            el('circle', { class: 'ip-ball', cx: bx, cy: by, r: stroke * 3, 'stroke-width': stroke }, svg);
            label(svg, `hitch ${hitch.name}`, bx + font * 0.6, by + font * 0.9, active);
        }

        // Points that coincide in this view (e.g. GPS and origin from the side) share one label.
        const groups = new Map();
        for (const point of points) {
            const [x, y] = project(point.at);
            const key = `${x.toFixed(1)}:${y.toFixed(1)}`;
            if (!groups.has(key)) groups.set(key, { x, y, labels: [] });
            groups.get(key).labels.push(point.label);
            marker(svg, point.kind, x, y, stroke);
        }
        for (const group of groups.values()) {
            label(svg, group.labels.join(' · '), group.x + font * 0.6, group.y - font * 0.5);
        }

        drawScale(svg, bounds, extent, font, stroke);
    }
}

function marker(svg, kind, x, y, stroke) {
    const d = stroke * 4;
    if (kind === 'origin') {
        el('path', { class: 'ip-axis', d: `M${x - d},${y} H${x + d} M${x},${y - d} V${y + d}`, 'stroke-width': stroke }, svg);
    } else if (kind === 'antenna') {
        el('path', { class: 'ip-antenna', d: `M${x},${y - d} L${x + d},${y} L${x},${y + d} L${x - d},${y} z` }, svg);
    } else {
        el('circle', { class: 'ip-origin', cx: x, cy: y, r: stroke * 2.5 }, svg);
    }
}

function label(svg, text, x, y, strong = false) {
    const element = el('text', { class: `ip-label${strong ? ' ip-label-strong' : ''}`, x, y }, svg);
    element.textContent = text;
    return element;
}
