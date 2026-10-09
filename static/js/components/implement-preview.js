// SVG top and side view of an implement on the robot, for the implement editor.
//
// Geometry follows artof-core (Utils/Settings/{Implement,Section,Task}.cpp), in the GPS frame of
// settings.json: section origin = hitch T + hinge(hitch link_length) + hinge(section link_length) + section T,
// with hinge(l) = (0, -l, 0) at hitch angle 0. A section with `repeats` n becomes n copies shifted by
// i * offset along x. Its footprint is x in ±width/2, y in [-down, up], turned by the yaw R[2].
// Axes: +x right, +y forward, +z up; the top view is drawn with forward up and +x to the right.
import { Bounds, PX_PER_M, drawScale, el, fit, num, redrawOnResize, robotCentre, vec } from '../lib/svg-drawing.js';

/** Section copies as artof-core expands them, in the GPS frame. */
export function expandSections(implement, hitch) {
    const hitchT = hitch ? vec(hitch.transform?.T) : [0, 0, 0];
    const ball = [hitchT[0], hitchT[1] - num(hitch?.link_length), hitchT[2]];
    const copies = [];
    (implement.sections ?? []).forEach((section, index) => {
        const T = vec(section.transform?.T);
        const repeats = Math.max(1, Math.floor(num(section.repeats, 1)));
        const offset = num(section.offset);
        const linkLength = num(section.link_length);
        for (let i = 0; i < repeats; i++) {
            copies.push({
                index,
                id: repeats > 1 ? `${section.id ?? ''}${i}` : (section.id ?? ''),
                origin: [ball[0] + T[0] + i * offset, ball[1] - linkLength + T[1], ball[2] + T[2]],
                width: num(section.width),
                up: num(section.up),
                down: num(section.down),
                yaw: (num(section.transform?.R?.[2]) * Math.PI) / 180,
            });
        }
    });
    return { hitchT, ball, copies };
}

/** Corner points (x, y) of a copy's footprint. */
function footprint(copy) {
    const { origin, width, up, down, yaw } = copy;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return [[-width / 2, -down], [width / 2, -down], [width / 2, up], [-width / 2, up]]
        .map(([x, y]) => [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos]);
}

export class ImplementPreview {
    /**
     * @param {SVGSVGElement} topSvg
     * @param {SVGSVGElement} sideSvg
     * @param {{robot: object|null, hitches: object[]}} platform
     */
    constructor(topSvg, sideSvg, platform) {
        this.topSvg = topSvg;
        this.sideSvg = sideSvg;
        this.robot = platform.robot;
        this.hitches = platform.hitches ?? [];
        redrawOnResize(topSvg, () => this.last && this.draw(...this.last));
    }

    /**
     * @param {object} implement
     * @param {object|null} hitch hitch from settings, or null to draw relative to the origin
     * @param {number|null} activeIndex section that is being edited
     */
    draw(implement, hitch, activeIndex = null) {
        this.last = [implement, hitch, activeIndex];
        const geometry = expandSections(implement, hitch);
        this.drawTop(geometry, hitch, activeIndex);
        this.drawSide(geometry, hitch, activeIndex);
    }

    drawTop({ hitchT, ball, copies }, hitch, activeIndex) {
        const svg = this.topSvg;
        svg.replaceChildren();
        // World (x right, y forward) to svg (right, down).
        const sx = (x) => x * PX_PER_M;
        const sy = (y) => -y * PX_PER_M;
        const bounds = new Bounds();
        const addWorld = (x, y) => bounds.add(sx(x), sy(y));

        const robot = this.robot;
        let robotRect = null;
        if (robot && hitch) {
            const [rx, ry] = robotCentre(robot);
            const w = num(robot.width);
            const l = num(robot.length);
            robotRect = { x0: rx - w / 2, x1: rx + w / 2, y0: ry - l / 2, y1: ry + l / 2 };
            addWorld(robotRect.x0, robotRect.y0);
            addWorld(robotRect.x1, robotRect.y1);
        }
        const polygons = copies.map((copy) => ({ copy, points: footprint(copy) }));
        polygons.forEach(({ points }) => points.forEach(([x, y]) => addWorld(x, y)));
        addWorld(hitchT[0], hitchT[1]);
        addWorld(ball[0], ball[1]);
        if (bounds.empty) addWorld(0, 0);

        const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, PX_PER_M);
        const font = fit(svg, bounds, extent * 0.12);
        const stroke = font / 8;
        svg.style.setProperty('--ip-font', `${font}px`);

        if (robotRect) {
            el('rect', {
                class: 'ip-robot',
                x: sx(robotRect.x0), y: sy(robotRect.y1),
                width: (robotRect.x1 - robotRect.x0) * PX_PER_M, height: (robotRect.y1 - robotRect.y0) * PX_PER_M,
                rx: stroke * 4, 'stroke-width': stroke,
            }, svg);
            const label = el('text', { class: 'ip-label', x: sx((robotRect.x0 + robotRect.x1) / 2), y: sy((robotRect.y0 + robotRect.y1) / 2), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
            label.textContent = 'robot';
        }

        // Hitch → ball → section origins.
        el('line', { class: 'ip-link', x1: sx(hitchT[0]), y1: sy(hitchT[1]), x2: sx(ball[0]), y2: sy(ball[1]), 'stroke-width': stroke * 2 }, svg);
        for (const { copy } of polygons) {
            el('line', { class: 'ip-link ip-link-thin', x1: sx(ball[0]), y1: sy(ball[1]), x2: sx(copy.origin[0]), y2: sy(copy.origin[1]), 'stroke-width': stroke }, svg);
        }

        const labelEvery = copies.length > 12 ? copies.length - 1 : 1;
        polygons.forEach(({ copy, points }, i) => {
            const active = copy.index === activeIndex;
            const invalid = copy.width <= 0 || copy.up + copy.down <= 0;
            el('polygon', {
                class: `ip-section${active ? ' is-active' : ''}${invalid ? ' is-invalid' : ''}`,
                points: points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' '),
                'stroke-width': stroke,
            }, svg);
            el('circle', { class: 'ip-origin', cx: sx(copy.origin[0]), cy: sy(copy.origin[1]), r: stroke * 1.5 }, svg);
            if (copy.id && (i % labelEvery === 0)) {
                const minY = Math.min(...points.map(([, y]) => y));
                const text = el('text', { class: 'ip-label ip-label-strong', x: sx(copy.origin[0]), y: sy(minY) + font * 1.2, 'text-anchor': 'middle' }, svg);
                text.textContent = copy.id;
            }
        });

        el('circle', { class: 'ip-hitch', cx: sx(hitchT[0]), cy: sy(hitchT[1]), r: stroke * 3 }, svg);
        el('circle', { class: 'ip-ball', cx: sx(ball[0]), cy: sy(ball[1]), r: stroke * 3, 'stroke-width': stroke }, svg);
        const hitchLabel = el('text', { class: 'ip-label', x: sx(hitchT[0]) + font * 0.8, y: sy(hitchT[1]), 'dominant-baseline': 'middle' }, svg);
        hitchLabel.textContent = hitch ? `hitch ${hitch.name}` : 'hitch ball';

        drawScale(svg, bounds, extent, font, stroke);
    }

    drawSide({ hitchT, ball, copies }, hitch, activeIndex) {
        const svg = this.sideSvg;
        svg.replaceChildren();
        // Seen from the robot's left side (+x is right): forward (+y) is drawn to the left, z up.
        const sx = (y) => -y * PX_PER_M;
        const sy = (z) => -z * PX_PER_M;
        const bounds = new Bounds();
        const addWorld = (y, z) => bounds.add(sx(y), sy(z));

        const robot = this.robot;
        let body = null;
        if (robot && hitch) {
            const [, ry, rz] = robotCentre(robot);
            const l = num(robot.length);
            body = { y0: ry - l / 2, y1: ry + l / 2, z0: rz, z1: Math.max(0, rz + num(robot.wheel_diameter)) };
            addWorld(body.y0, body.z0);
            addWorld(body.y1, body.z1);
        }
        for (const copy of copies) {
            addWorld(copy.origin[1] - copy.down, copy.origin[2]);
            addWorld(copy.origin[1] + copy.up, copy.origin[2]);
        }
        addWorld(hitchT[1], hitchT[2]);
        addWorld(ball[1], ball[2]);

        const extent = Math.max(bounds.maxX - bounds.minX, PX_PER_M);
        // Keep the side view flat: pad vertically at least enough for the labels.
        const font = fit(svg, bounds, extent * 0.08);
        const stroke = font / 8;
        svg.style.setProperty('--ip-font', `${font}px`);

        if (body) {
            el('rect', {
                class: 'ip-robot', x: sx(body.y1), y: sy(body.z1),
                width: (body.y1 - body.y0) * PX_PER_M, height: (body.z1 - body.z0) * PX_PER_M,
                rx: stroke * 4, 'stroke-width': stroke,
            }, svg);
        }

        el('line', { class: 'ip-link', x1: sx(hitchT[1]), y1: sy(hitchT[2]), x2: sx(ball[1]), y2: sy(ball[2]), 'stroke-width': stroke * 2 }, svg);
        // Copies of a repeated section overlap in this view: draw each distinct (y, z) once.
        const drawn = new Set();
        for (const copy of copies) {
            const key = `${copy.index}:${copy.origin[1]}:${copy.origin[2]}`;
            if (drawn.has(key)) continue;
            drawn.add(key);
            const active = copy.index === activeIndex;
            el('line', { class: 'ip-link ip-link-thin', x1: sx(ball[1]), y1: sy(ball[2]), x2: sx(copy.origin[1]), y2: sy(copy.origin[2]), 'stroke-width': stroke }, svg);
            el('line', {
                class: `ip-footprint${active ? ' is-active' : ''}`,
                x1: sx(copy.origin[1] + copy.up), y1: sy(copy.origin[2]),
                x2: sx(copy.origin[1] - copy.down), y2: sy(copy.origin[2]),
                'stroke-width': stroke * 5,
            }, svg);
            el('circle', { class: 'ip-origin', cx: sx(copy.origin[1]), cy: sy(copy.origin[2]), r: stroke * 1.5 }, svg);
        }
        el('circle', { class: 'ip-hitch', cx: sx(hitchT[1]), cy: sy(hitchT[2]), r: stroke * 3 }, svg);
        el('circle', { class: 'ip-ball', cx: sx(ball[1]), cy: sy(ball[2]), r: stroke * 3, 'stroke-width': stroke }, svg);

        drawScale(svg, bounds, extent, font, stroke);
    }
}
