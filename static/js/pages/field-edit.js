import { showError, showToast } from '../components/toast-stack.js';
import { byId, checkedValue, fillWindowHeight, hideCollapse, makeCollapsesExclusive, readJSON, show, withBusy } from '../lib/dom.js';
import { postForm } from '../lib/http.js';
import { LiveSocket } from '../lib/live-socket.js';
import { drawGeofence, drawTask, drawTraject } from '../map/field-layers.js';
import { averageCoordinate, createMap, DEFAULT_CENTER, DEFAULT_ZOOM, isPlausibleRobotPosition } from '../map/robot-map.js';
import { RobotLayer } from '../map/robot-layer.js';

const FIELD_ZOOM = 18;

/** Shows a check mark on a section's toggle once its changes are saved. */
function markSaved(toggle, saved) {
    toggle.classList.toggle('is-saved', saved);
}

/** Flattens the shapes drawn with Leaflet Draw to coordinates: one [[lat, lng], ...] per line or polygon, [lat, lng] per point. */
function drawnCoordinates(drawnItems) {
    return drawnItems.getLayers().map((layer) => {
        if (layer instanceof L.CircleMarker) {
            const { lat, lng } = layer.getLatLng();
            return [lat, lng];
        }
        let latlngs = layer.getLatLngs();
        while (Array.isArray(latlngs[0])) latlngs = latlngs[0];
        return latlngs.map(({ lat, lng }) => [lat, lng]);
    });
}

/** The shape that can be changed with the draw tools: the field part whose panel is open. */
class DrawTarget {
    constructor(name = '', type = '', latlngs = []) {
        this.name = name;
        /** 'polyline', 'polygon' or 'circlemarker' */
        this.type = type;
        this.latlngs = latlngs;
    }

    /** Leaflet layers to start drawing from. */
    layers() {
        if (this.type === 'polyline') return [L.polyline(this.latlngs)];
        if (this.type === 'polygon') return [L.polygon(this.latlngs)];
        if (this.type === 'circlemarker') return this.latlngs.map((point) => L.circleMarker(point));
        return [];
    }

    /** Whether a newly drawn layer fits this shape; traject and geofence keep a single shape. */
    accepts(layer) {
        const isPolygon = layer instanceof L.Polygon;
        const isLine = layer instanceof L.Polyline && !isPolygon;
        if (this.name === 'traject') return isLine;
        if (this.name === 'geofence') return isPolygon;
        return isPolygon || layer instanceof L.CircleMarker;
    }
}

/** One collapsible "traject", "geofence" or task section (templates/components/container_field_edit.html). */
class ShapeSection {
    constructor(page, editor) {
        this.page = page;
        this.name = editor.dataset.shapeEditor;
        this.editor = editor;
        this.form = editor.closest('form');
        this.toggleButton = byId(`button-${this.name}`);

        const submitButton = editor.querySelector('[data-shape-submit]');
        submitButton.addEventListener('click', () => withBusy(submitButton, this.submit()));
        for (const radio of editor.querySelectorAll(`input[name="${CSS.escape(this.name)}"]`)) {
            radio.addEventListener('change', () => this.onModeChange());
        }
        this.fileInput = editor.querySelector('[data-shapefile-url]');
        this.fileInput.addEventListener('change', () => this.uploadShapefile(this.fileInput));
        this.form.addEventListener('show.bs.collapse', (event) => {
            if (event.target === this.form) page.setDrawTarget(this.drawTarget(), this.mode === 'draw');
        });
    }

    get mode() {
        return checkedValue(this.name, this.editor);
    }

    get isTask() {
        return this.name !== 'traject' && this.name !== 'geofence';
    }

    get geometry() {
        return this.isTask ? this.page.field.tasks[this.name].geometry : this.page.field[this.name];
    }

    set geometry(geometry) {
        if (this.isTask) this.page.field.tasks[this.name].geometry = geometry;
        else this.page.field[this.name] = geometry;
    }

    drawTarget() {
        const geometry = this.geometry;
        const ring = geometry.empty ? [] : geometry.latlng[0];
        if (this.name === 'traject') return new DrawTarget(this.name, 'polyline', ring);
        if (this.name === 'geofence' || 'rings' in geometry) return new DrawTarget(this.name, 'polygon', ring);
        if ('points' in geometry) return new DrawTarget(this.name, 'circlemarker', geometry.empty ? [] : geometry.latlng);
        return new DrawTarget(this.name);
    }

    onModeChange() {
        const mode = this.mode;
        for (const info of this.editor.querySelectorAll('[data-mode-info]')) {
            show(info, info.dataset.modeInfo === mode);
        }
        if (this.page.drawTarget.name === this.name) {
            this.page.setDrawTarget(this.page.drawTarget, mode === 'draw');
        }
    }

    async uploadShapefile(input) {
        const formData = new FormData();
        for (const file of input.files) formData.append('files', file);
        try {
            const response = await postForm(input.dataset.shapefileUrl, formData);
            const { note, ...geometry } = await response.json();
            this.page.updateShape(this.name, geometry);
            if (note) showToast(note, 'warning');
        } catch (error) {
            showError('Reading the shape files', error);
        }
    }

    async submit() {
        const mode = this.mode;
        if (mode === 'draw') {
            const features = drawnCoordinates(this.page.drawnItems);
            if (features.length === 0) {
                showToast('Draw a shape on the map first.', 'warning');
                return;
            }
            this.page.updateShape(this.name, { ...this.geometry, empty: false, latlng: features });
        }
        if (mode === 'file' && this.fileInput.files.length === 0) {
            showToast('Choose the shape files first.', 'warning');
            return;
        }

        const formData = new FormData(this.form);
        // The server stores the uploaded shapefile itself, so its attributes are kept.
        if (mode === 'file') {
            for (const file of this.fileInput.files) formData.append('files', file);
        }
        formData.append('name', this.page.field.name);
        formData.append('input_mode', mode);
        const data = this.isTask ? this.page.field.tasks[this.name] : this.geometry;
        formData.append('data', JSON.stringify(data));

        try {
            await postForm(this.form.action, formData);
            markSaved(this.toggleButton, true);
            hideCollapse(this.form);
            showToast(`${this.toggleButton.textContent.trim()} saved.`);
        } catch (error) {
            markSaved(this.toggleButton, false);
            showError('Saving', error);
        }
    }
}

class FieldEditPage {
    constructor() {
        this.field = readJSON('field-data');
        this.root = byId('edit-field');
        this.mapContainer = byId('map-container');
        this.map = createMap(this.mapContainer);
        this.zoomedToField = false;

        this.layerGroups = { traject: L.layerGroup().addTo(this.map), geofence: L.layerGroup().addTo(this.map) };
        for (const name of Object.keys(this.field.tasks)) this.layerGroups[name] = L.layerGroup().addTo(this.map);

        this.robot = new RobotLayer(this.map);
        this.initDrawing();

        this.updateShape('geofence', this.field.geofence);
        for (const [name, task] of Object.entries(this.field.tasks)) this.updateShape(name, task.geometry);
        this.updateShape('traject', this.field.traject);

        for (const editor of this.root.querySelectorAll('[data-shape-editor]')) new ShapeSection(this, editor);
        this.initNameForm();
        this.initTaskControls();
        makeCollapsesExclusive(this.root);

        new LiveSocket('/ws/robot/', (data) => this.onRobotData(data));
        fillWindowHeight(this.root, 16);
        this.map.invalidateSize();
    }

    initDrawing() {
        this.drawnItems = new L.FeatureGroup().addTo(this.map);
        this.drawTarget = new DrawTarget();

        new L.Control.Draw({
            draw: { marker: false, circlemarker: true, polyline: true, polygon: true, circle: false, rectangle: false },
            edit: { featureGroup: this.drawnItems, edit: true, remove: true },
        }).addTo(this.map);

        this.map.on(L.Draw.Event.CREATED, ({ layer }) => {
            if (!this.drawTarget.accepts(layer)) return;
            if (!this.isTask(this.drawTarget.name)) {
                // Traject and geofence consist of a single shape.
                this.drawnItems.clearLayers();
            } else {
                // A task is either points or polygons: drop the drawn shapes of the other kind.
                const isPoint = layer instanceof L.CircleMarker;
                this.drawTarget.type = isPoint ? 'circlemarker' : 'polygon';
                for (const other of this.drawnItems.getLayers()) {
                    if ((other instanceof L.CircleMarker) !== isPoint) this.drawnItems.removeLayer(other);
                }
            }
            this.drawnItems.addLayer(layer);
        });
    }

    isTask(name) {
        return name in this.field.tasks;
    }

    /** Makes `target` the shape the draw tools apply to; in draw mode it is put on the map to edit. */
    setDrawTarget(target, drawMode) {
        this.drawTarget = target;
        this.drawnItems.clearLayers();
        if (drawMode) {
            for (const layer of target.layers()) this.drawnItems.addLayer(layer);
        }
    }

    /** Stores the geometry of a field part and redraws it. */
    updateShape(name, geometry) {
        if (geometry.empty) return;

        const group = this.layerGroups[name];
        group.clearLayers();
        if (name === 'traject') {
            drawTraject(group, geometry.latlng[0], { dashed: false, arrowSize: 5 });
            this.field.traject = geometry;
        } else if (name === 'geofence') {
            drawGeofence(group, geometry.latlng[0]);
            this.field.geofence = geometry;
        } else {
            drawTask(group, this.field.tasks[name].type, geometry.latlng, { filled: false });
            this.field.tasks[name].geometry = geometry;
        }

        if (!this.isTask(name) && !this.zoomedToField) {
            this.map.setView(averageCoordinate(geometry.latlng[0]), FIELD_ZOOM);
            this.zoomedToField = true;
        }
    }

    onRobotData(data) {
        this.robot.render(data);
        if (!this.zoomedToField) {
            const { latlng } = this.robot.location;
            if (isPlausibleRobotPosition(latlng)) this.map.setView(latlng, FIELD_ZOOM);
            else this.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
            this.zoomedToField = true;
        }
    }

    initNameForm() {
        const form = byId('collapse-field-name');
        const input = byId('input-field-name');
        const button = byId('button-field-name');

        // Field names are used as folder names: only letters, digits and underscores.
        input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9a-zA-Z_]/g, ''); });

        form.addEventListener('show.bs.collapse', (event) => {
            if (event.target === form) this.setDrawTarget(new DrawTarget(), false);
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await withBusy(byId('check-field-name'), postForm(form.action, new FormData(form)));
                this.field.name = input.value;
                form.querySelector('input[name="original"]').value = input.value;
                markSaved(button, true);
                hideCollapse(form);
                showToast(`Renamed to ${input.value}.`);
            } catch (error) {
                markSaved(button, false);
                showError('Renaming the field', error);
            }
        });
    }

    initTaskControls() {
        for (const select of this.root.querySelectorAll('select[data-task]')) {
            select.addEventListener('change', () => {
                this.field.tasks[select.dataset.task][select.dataset.taskProperty] = select.value;
            });
        }
        // The field may have been renamed on this page: send the current name.
        for (const form of this.root.querySelectorAll('form[data-field-name-form]')) {
            form.addEventListener('submit', () => {
                form.querySelector('input[name="field_name"]').value = this.field.name;
            });
        }
    }
}

new FieldEditPage();
