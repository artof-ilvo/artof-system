import { byId, hideCollapse } from '../../lib/dom.js';
import { postJSON } from '../../lib/http.js';
import { drawPreviewPolygon } from '../../map/field-layers.js';

/** Polygon operations (geofence and area tasks) on the map page. */
export class PolygonPanel {
    constructor(root, { overlayGroup }) {
        this.root = root;
        this.url = root.dataset.operationUrl;
        this.overlayGroup = overlayGroup;
        this.bufferInput = byId('polygon-buffer');
        /** @type {import('./shape-edit.js').ShapeEdit | null} */
        this.edit = null;

        this.bufferInput.addEventListener('change', () => this.previewBuffer());
        byId('accept-polygon-buffer').addEventListener('click', () => this.edit.accept());
    }

    start(edit) {
        this.edit = edit;
    }

    reset() {
        for (const collapse of this.root.querySelectorAll('.collapse')) hideCollapse(collapse);
        this.bufferInput.value = 0;
        this.edit = null;
    }

    async previewBuffer() {
        if (!this.edit || !this.bufferInput.checkValidity()) return;
        try {
            const result = await postJSON(this.url, {
                operation: 'buffer',
                data: this.edit.accepted,
                commands: { distance: parseFloat(this.bufferInput.value) },
            });
            this.overlayGroup.clearLayers();
            drawPreviewPolygon(this.overlayGroup, result.latlng);
            this.edit.setPreview(result.rings);
        } catch (error) {
            console.error(error);
        }
    }
}
