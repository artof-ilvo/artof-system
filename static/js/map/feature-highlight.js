const STYLE = { color: '#facc15', weight: 4, fill: false };

/** Outlines one polygon ([[lat, lng], ...]) or point ([lat, lng]) on the map, panning to it when it is out of view. */
export class FeatureHighlight {
    constructor(map) {
        this.map = map;
        this.group = L.layerGroup().addTo(map);
    }

    show(latlng) {
        this.clear();
        if (!latlng) return;

        const isPolygon = Array.isArray(latlng[0]);
        const layer = isPolygon ? L.polygon(latlng, STYLE) : L.circleMarker(latlng, { ...STYLE, radius: 9 });
        layer.addTo(this.group);
        const bounds = isPolygon ? layer.getBounds() : L.latLngBounds([latlng, latlng]);
        if (!this.map.getBounds().contains(bounds)) this.map.panTo(bounds.getCenter());
    }

    clear() {
        this.group.clearLayers();
    }
}
