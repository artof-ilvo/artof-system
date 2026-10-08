// Drawing of field geometries (traject, geofence, tasks) on a Leaflet layer group.

export const AREA_TASK_TYPES = ['continuous', 'cardan', 'hitch'];
export const POINT_TASK_TYPES = ['discrete', 'intermittent'];

const TASK_COLORS = { continuous: 'blue', cardan: 'yellow', hitch: 'green' };

/** Traject polyline with arrow heads showing the driving direction. */
export function drawTraject(group, latlngs, { color = 'red', dashed = true, arrowSize = 10 } = {}) {
    const line = L.polyline(latlngs, { color, weight: 2, dashArray: dashed ? '5, 10' : null }).addTo(group);
    L.polylineDecorator(line, {
        patterns: [{
            offset: 25,
            repeat: 50,
            symbol: L.Symbol.arrowHead({ pixelSize: arrowSize, polygon: true, pathOptions: { color, fillOpacity: 0, weight: 2 } }),
        }],
    }).addTo(group);
    return line;
}

export function drawGeofence(group, latlngs) {
    return L.polygon(latlngs, { color: 'red', fill: false }).addTo(group);
}

/** Areas are drawn as polygons per ring, point tasks as small circles. */
export function drawTask(group, type, latlngs, { filled = true } = {}) {
    if (AREA_TASK_TYPES.includes(type)) {
        const style = filled
            ? { color: TASK_COLORS[type], weight: 2, fillOpacity: 0.2 }
            : { color: 'blue', fill: false };
        for (const ring of latlngs) L.polygon(ring, style).addTo(group);
    } else if (POINT_TASK_TYPES.includes(type)) {
        for (const point of latlngs) {
            L.circleMarker(point, { color: 'blue', weight: 2, fillOpacity: 0.2, radius: 3 }).addTo(group);
        }
    }
}

/** Dashed black preview of an edit, drawn on top of the field. */
export function drawPreviewTraject(group, latlngs) {
    return drawTraject(group, latlngs, { color: 'black', dashed: true });
}

export function drawPreviewPolygon(group, latlngs) {
    return L.polygon(latlngs, { color: 'black', dashArray: '10, 10', weight: 2, fill: false }).addTo(group);
}
