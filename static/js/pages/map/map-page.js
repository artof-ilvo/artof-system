import '../app-base.js';
import { byId, fillWindowHeight, makeCollapsesExclusive, readJSON, setButtonActive, show } from '../../lib/dom.js';
import { postForm, postJSON } from '../../lib/http.js';
import { LiveSocket } from '../../lib/live-socket.js';
import { FeatureHighlight } from '../../map/feature-highlight.js';
import { drawGeofence, drawTask, drawTraject } from '../../map/field-layers.js';
import { createMap, isWellInView } from '../../map/robot-map.js';
import { RobotLayer } from '../../map/robot-layer.js';
import { TaskAttributeEditor, taskFeature } from '../task-attributes.js';
import { PolygonPanel } from './polygon-panel.js';
import { ShapeEdit } from './shape-edit.js';
import { TrajectPanel } from './traject-panel.js';

// Each +/- click doubles or halves the simulation speed factor.
const SIMULATION_FACTOR_MULTIPLIER = 2;

// Arrow keys drive the simulated robot: [command, value while pressed].
const DRIVE_KEYS = {
    ArrowLeft: ['left', 0.2],
    ArrowUp: ['up', 1.0],
    ArrowRight: ['right', -0.2],
    ArrowDown: ['down', -1.0],
};

/** A toggle button; with a `key` its state is kept in sessionStorage. */
class ToggleButton {
    constructor(button, key, onChange = () => {}) {
        this.button = button;
        this.key = key;
        this.onChange = onChange;
        this.set(key !== null && sessionStorage.getItem(key) === 'true');
        button.addEventListener('click', () => {
            this.set(!this.active);
            this.onChange(this.active);
        });
    }

    set(active) {
        this.active = active;
        setButtonActive(this.button, active);
        if (this.key !== null) sessionStorage.setItem(this.key, active);
    }
}

class MapPage {
    constructor() {
        this.field = readJSON('field-data');

        this.mapContainer = byId('map-container');
        this.editContainer = byId('edit-field-container');
        this.map = createMap(this.mapContainer, { rotate: true });
        this.drawField();

        this.robot = new RobotLayer(this.map);
        this.driveInGroup = L.layerGroup().addTo(this.map);
        this.overlayGroup = L.layerGroup().addTo(this.map);
        this.highlightGroup = L.layerGroup().addTo(this.map);

        this.followRobot = new ToggleButton(byId('follow-robot-button'), 'follow-robot');
        this.directRobot = new ToggleButton(byId('direct-robot-button'), 'direct-robot', (active) => {
            if (!active) this.map.setBearing(0);
        });
        this.commandRobot = new ToggleButton(byId('command-robot-button'), 'command-robot');
        this.simulationCheck = byId('simulation-check');

        this.socket = new LiveSocket('/ws/robot/', (data) => this.onRobotData(data));

        this.initSimulation();
        this.initDriving();
        this.initEditor();

        // Same margin below the map card as the page padding above it.
        fillWindowHeight(byId('map-shell'), 16);
        this.map.invalidateSize();
    }

    drawField() {
        const group = L.layerGroup().addTo(this.map);
        const { geofence, traject, tasks } = this.field;
        if (!geofence.empty) drawGeofence(group, geofence.latlng);
        for (const task of Object.values(tasks)) {
            if (!task.geometry.empty) drawTask(group, task.type, task.geometry.latlng);
        }
        if (!traject.empty) drawTraject(group, traject.latlng[0]);
    }

    onRobotData(data) {
        this.robot.render(data);
        const { latlng } = this.robot.location;
        if (this.followRobot.active && !isWellInView(this.map, latlng)) {
            this.map.setView(latlng);
        }
        if (this.directRobot.active) {
            this.map.setBearing(this.robot.heading);
        }
    }

    get isCommandingSimulation() {
        return this.simulationCheck.checked && this.commandRobot.active;
    }

    initSimulation() {
        const simulationForm = byId('simulation-form');
        const factorForm = byId('simulation-factor-form');
        const factorInput = byId('simulation-factor');

        simulationForm.addEventListener('change', async () => {
            try {
                await postForm(simulationForm.action, new FormData(simulationForm));
            } catch (error) {
                console.error(error);
            }
            show(factorForm, this.simulationCheck.checked);
        });

        const sendFactor = (event) => {
            event.preventDefault();
            if (factorForm.checkValidity()) {
                postForm(factorForm.action, new FormData(factorForm)).catch(console.error);
            }
        };
        factorForm.addEventListener('change', sendFactor);
        factorForm.addEventListener('submit', sendFactor);

        const setFactor = (value) => {
            factorInput.value = Math.min(Math.max(value, Number(factorInput.min)), Number(factorInput.max));
            factorInput.dispatchEvent(new Event('change', { bubbles: true }));
        };
        byId('increase-simulation-factor-button').addEventListener('click', () => {
            setFactor(Math.max(parseFloat(factorInput.value) * SIMULATION_FACTOR_MULTIPLIER, 1));
        });
        byId('decrease-simulation-factor-button').addEventListener('click', () => {
            const value = parseFloat(factorInput.value) / SIMULATION_FACTOR_MULTIPLIER;
            setFactor(value < 1 ? 0 : value);
        });

        // Clicking the map moves the simulated robot there.
        this.map.on('click', (event) => {
            if (!this.isCommandingSimulation) return;
            postJSON(this.mapContainer.dataset.simulationPositionUrl, { lat: event.latlng.lat, lon: event.latlng.lng }).catch(console.error);
        });
    }

    initDriving() {
        const handleKey = (event, pressed) => {
            const key = DRIVE_KEYS[event.key];
            if (!key || !this.isCommandingSimulation || event.repeat) return;
            if (event.target.closest('input, select, textarea')) return;
            event.preventDefault();
            const [command, value] = key;
            this.socket.send({ command, value: pressed ? value : 0.0 });
        };
        document.addEventListener('keydown', (event) => handleKey(event, true));
        document.addEventListener('keyup', (event) => handleKey(event, false));
    }

    initEditor() {
        const layers = {
            overlayGroup: this.overlayGroup,
            highlightGroup: this.highlightGroup,
            driveInGroup: this.driveInGroup,
        };
        this.trajectPanel = new TrajectPanel(byId('edit-traject-shape-panel'), {
            ...layers,
            getRobotLocation: () => this.robot.location,
        });
        this.polygonPanel = new PolygonPanel(byId('edit-polygon-shape-panel'), layers);
        this.featureHighlight = new FeatureHighlight(this.map);
        this.attributeEditor = new TaskAttributeEditor(byId('edit-task-attribute'), {
            getFieldName: () => this.field.name,
            highlightFeature: (taskName, index) => this.featureHighlight.show(taskFeature(this.field, taskName, index)),
        });
        this.shapeSelect = byId('edit-field-select');
        this.uploadButton = byId('button-upload');
        /** @type {ShapeEdit | null} */
        this.edit = null;

        makeCollapsesExclusive(this.editContainer);

        this.editSheet = bootstrap.Offcanvas.getOrCreateInstance(this.editContainer);
        this.editToggle = new ToggleButton(byId('edit-field-button'), null, (active) => this.showEditor(active));
        // Closing the sheet (close button or Escape) ends editing too.
        this.editContainer.addEventListener('hide.bs.offcanvas', () => byId('map-shell').classList.remove('is-editing'));
        this.editContainer.addEventListener('hidden.bs.offcanvas', () => {
            this.editToggle.set(false);
            this.shapeSelect.value = '';
            this.selectShape('');
        });

        this.shapeSelect.addEventListener('change', () => this.selectShape(this.shapeSelect.value));

        byId('map-edit-upload-form').addEventListener('submit', (event) => {
            if (!this.edit) {
                event.preventDefault();
                return;
            }
            byId('map-edit-shape-attr').value = this.edit.name;
            byId('map-edit-geometries-attr').value = JSON.stringify(this.edit.accepted);
        });
    }

    showEditor(visible) {
        if (!visible) {
            this.editSheet.hide();
            return;
        }
        // Side sheet below the header on wide screens, bottom sheet on phones.
        const isPhone = window.matchMedia('(max-width: 767.98px)').matches;
        this.editContainer.classList.toggle('offcanvas-end', !isPhone);
        this.editContainer.classList.toggle('offcanvas-bottom', isPhone);
        const headerBottom = byId('app-header').getBoundingClientRect().bottom;
        this.editContainer.style.setProperty('--sheet-top', `${Math.max(headerBottom, 0)}px`);
        byId('map-shell').classList.toggle('is-editing', !isPhone);
        this.editSheet.show();
    }

    selectShape(name) {
        this.trajectPanel.reset();
        this.polygonPanel.reset();
        this.overlayGroup.clearLayers();
        this.featureHighlight.clear();
        this.uploadButton.disabled = true;
        this.attributeEditor.setTask(name in this.field.tasks ? name : null);

        this.edit = name ? ShapeEdit.forShape(this.field, name, (edit) => {
            this.uploadButton.disabled = !edit.isModified;
        }) : null;

        const kind = this.edit?.kind;
        show(byId('edit-traject-shape-panel'), kind === 'traject');
        show(byId('edit-polygon-shape-panel'), kind === 'polygon');
        if (kind === 'traject') this.trajectPanel.start(this.edit);
        if (kind === 'polygon') this.polygonPanel.start(this.edit);
    }
}

new MapPage();
