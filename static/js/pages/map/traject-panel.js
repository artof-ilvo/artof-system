import { showError } from '../../components/toast-stack.js';
import { byId, checkedValue, hideCollapse } from '../../lib/dom.js';
import { postJSON } from '../../lib/http.js';
import { drawPreviewTraject } from '../../map/field-layers.js';
import { ALL_ROWS, RowSelector } from './row-selector.js';

/** Drives in a traject: A marks the start, "/" adds a waypoint and B marks the end at the robot position. */
class DriveIn {
    constructor(root, { group, getRobotLocation, onFinish }) {
        this.group = group;
        this.getRobotLocation = getRobotLocation;
        this.onFinish = onFinish;
        this.buttonA = root.querySelector('[data-drive="start"]');
        this.buttonM = root.querySelector('[data-drive="waypoint"]');
        this.buttonB = root.querySelector('[data-drive="end"]');
        this.latlngs = [];
        this.points = [];

        this.buttonA.addEventListener('click', () => this.start());
        this.buttonM.addEventListener('click', () => this.addRobotPosition());
        this.buttonB.addEventListener('click', () => this.finish());
    }

    start() {
        this.latlngs = [];
        this.points = [];
        this.addRobotPosition();
        this.buttonM.disabled = false;
        this.buttonB.disabled = false;
    }

    addRobotPosition() {
        const location = this.getRobotLocation();
        if (!location) return;
        this.latlngs.push(location.latlng);
        this.points.push(location.xy);
        this.draw();
    }

    finish() {
        this.addRobotPosition();
        this.reset();
        this.onFinish([this.points], this.latlngs);
    }

    reset() {
        this.buttonM.disabled = true;
        this.buttonB.disabled = true;
        this.group.clearLayers();
    }

    draw() {
        this.group.clearLayers();
        const style = { color: 'white', weight: 2 };
        L.circleMarker(this.latlngs[0], { ...style, radius: 3, fill: true }).addTo(this.group);
        if (this.latlngs.length > 1) L.polyline(this.latlngs, style).addTo(this.group);
    }
}

/** Traject operations on the map page: extend, shift, add, remove and reverse/flip rows, or drive in a new traject. */
export class TrajectPanel {
    constructor(root, { overlayGroup, highlightGroup, driveInGroup, getRobotLocation }) {
        this.root = root;
        this.url = root.dataset.operationUrl;
        this.overlayGroup = overlayGroup;
        /** @type {import('./shape-edit.js').ShapeEdit | null} */
        this.edit = null;

        this.rows = new RowSelector(byId('traject-rows'), {
            rowsUrl: root.dataset.rowsUrl,
            highlightGroup,
            getPaths: () => this.edit.preview,
        });
        this.driveIn = new DriveIn(byId('traject-drive-in'), {
            group: driveInGroup,
            getRobotLocation,
            onFinish: (paths, latlngs) => {
                this.showPreview(latlngs);
                this.edit.setPreview(paths);
                this.edit.accept();
            },
        });

        this.inputs = {
            extendLength: byId('traject-extention'),
            shiftDistance: byId('traject-shift'),
            addDistance: byId('traject-add'),
            addNumber: byId('traject-add-number'),
            reverse: byId('check-traject-reverse'),
            flip: byId('check-traject-flip'),
        };
        this.acceptAddButton = byId('check-traject-add');
        this.bindEvents();
    }

    bindEvents() {
        const { extendLength, shiftDistance, addDistance, addNumber, reverse, flip } = this.inputs;

        for (const button of this.root.querySelectorAll('[data-accept-traject]')) {
            button.addEventListener('click', () => this.edit.accept());
        }

        extendLength.addEventListener('change', () => this.previewFromAccepted('extend', extendLength, {
            length: parseFloat(extendLength.value),
            row_number: this.rows.selected,
            side: checkedValue('traject-extention', this.root),
        }));
        shiftDistance.addEventListener('change', () => this.previewFromAccepted('shift', shiftDistance, {
            distance: parseFloat(shiftDistance.value),
            row_number: this.rows.selected,
        }));

        for (const input of [addDistance, addNumber, ...this.root.querySelectorAll('input[name="traject-add"]')]) {
            input.addEventListener('change', () => this.previewAddedRows());
        }
        byId('switch-sign-traject-add').addEventListener('click', () => this.negateAddDistance());
        this.acceptAddButton.addEventListener('click', () => {
            this.edit.accept();
            // Preview the next row on the other side, ready to be accepted again.
            this.negateAddDistance();
        });

        byId('button-traject-remove-row').addEventListener('click', () => {
            const rows = this.rows.selected;
            if (rows === ALL_ROWS) {
                console.warn('Select the rows to remove; removing all rows is not allowed.');
                return;
            }
            this.applyAndAccept('remove', { row_number: rows }, (path) => [path]);
        });

        reverse.addEventListener('change', () => this.applyAndAccept('reverse', undefined, (paths) => paths));
        flip.addEventListener('change', () => this.applyAndAccept('flip', undefined, (path) => [path]));
    }

    start(edit) {
        this.edit = edit;
    }

    /** Closes the sub panels and resets all inputs. */
    reset() {
        for (const collapse of this.root.querySelectorAll('.collapse')) hideCollapse(collapse);
        this.inputs.reverse.checked = false;
        this.inputs.flip.checked = false;
        this.inputs.extendLength.value = 0;
        this.inputs.shiftDistance.value = 0;
        this.inputs.addDistance.value = 0;
        this.rows.clear();
        this.driveIn.reset();
        this.edit = null;
    }

    negateAddDistance() {
        const input = this.inputs.addDistance;
        input.value = -parseFloat(input.value || 0);
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async previewAddedRows() {
        const { addDistance, addNumber } = this.inputs;
        this.acceptAddButton.disabled = true;
        await this.previewFromAccepted('add', addDistance, {
            distance: parseFloat(addDistance.value),
            side: checkedValue('traject-add', this.root),
            number: parseInt(addNumber.value, 10),
        });
        this.acceptAddButton.disabled = false;
    }

    /** Previews `operation` on the accepted traject; the user accepts it with the check button. */
    async previewFromAccepted(operation, input, commands) {
        if (!this.edit || !input.checkValidity()) return;
        const path = await this.perform(operation, this.edit.accepted, commands);
        if (path) this.edit.setPreview([path]);
    }

    /** Applies `operation` on the current preview and accepts the result immediately. */
    async applyAndAccept(operation, commands, toPaths) {
        if (!this.edit) return;
        const result = await this.perform(operation, this.edit.preview, commands);
        if (result) {
            this.edit.setPreview(toPaths(result));
            this.edit.accept();
        }
    }

    /** Runs the operation on the server and draws the resulting traject as preview. Returns its path. */
    async perform(operation, data, commands) {
        try {
            const result = await postJSON(this.url, { operation, data, commands });
            this.showPreview(result.latlng);
            return result.path;
        } catch (error) {
            showError('The traject operation', error);
            return null;
        }
    }

    showPreview(latlngs) {
        this.overlayGroup.clearLayers();
        drawPreviewTraject(this.overlayGroup, latlngs);
    }
}
