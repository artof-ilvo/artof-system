/**
 * Editing session of one field shape (traject, geofence or a task) on the map page.
 *
 * Geometries are in the field's projected coordinates: traject `paths`, polygon `rings`.
 * - `server`:   as loaded from the server; used to detect changes.
 * - `accepted`: edits confirmed with a check button; operations build on it and it is uploaded.
 * - `preview`:  result of the latest operation, shown as a dashed overlay until accepted.
 */
export class ShapeEdit {
    constructor(name, kind, geometry, onChange) {
        this.name = name;
        /** 'traject' or 'polygon'. */
        this.kind = kind;
        this.server = geometry;
        this.accepted = geometry;
        this.preview = geometry;
        this.onChange = onChange;
    }

    /** Creates the session for the shape selected in the editor dropdown, or null if it cannot be edited. */
    static forShape(field, name, onChange) {
        if (name === 'traject') return new ShapeEdit(name, 'traject', field.traject.paths, onChange);
        if (name === 'geofence') return new ShapeEdit(name, 'polygon', field.geofence.rings, onChange);
        const rings = field.tasks[name]?.geometry.rings;
        return rings ? new ShapeEdit(name, 'polygon', rings, onChange) : null;
    }

    setPreview(geometry) {
        this.preview = geometry;
    }

    accept() {
        this.accepted = this.preview;
        this.onChange(this);
    }

    get isModified() {
        return JSON.stringify(this.accepted) !== JSON.stringify(this.server);
    }
}
