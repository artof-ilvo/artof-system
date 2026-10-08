// Leaflet map setup shared by the map and field edit pages.

export const DEFAULT_CENTER = [50.98203689815162, 3.7785538265089014];
export const DEFAULT_ZOOM = 16;

const SATELLITE_TILES = 'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';

function storedView() {
    try {
        const center = JSON.parse(sessionStorage.getItem('center'));
        const zoom = parseInt(sessionStorage.getItem('zoom'), 10);
        if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng) && Number.isFinite(zoom)) {
            return { center: [center.lat, center.lng], zoom };
        }
    } catch (error) {
        console.error('Stored map view is invalid, using the default.', error);
    }
    return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

/**
 * Creates a satellite map. The view (center and zoom) is kept in sessionStorage
 * so it survives page reloads.
 */
export function createMap(container, options = {}) {
    const map = L.map(container, { ...storedView(), ...options });
    map.keyboard.disable();

    map.on('moveend', () => {
        sessionStorage.setItem('center', JSON.stringify(map.getCenter()));
        sessionStorage.setItem('zoom', map.getZoom());
    });

    L.tileLayer(SATELLITE_TILES, {
        maxZoom: 25,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    }).addTo(map);

    return map;
}

/** True when `latlng` lies in the central part of the map (excluding a `margin` fraction on each side). */
export function isWellInView(map, latlng, margin = 0.25) {
    const size = map.getSize();
    const bounds = L.latLngBounds(
        map.containerPointToLatLng([size.x * margin, size.y * margin]),
        map.containerPointToLatLng([size.x * (1 - margin), size.y * (1 - margin)]),
    );
    return bounds.contains(L.latLng(latlng));
}

/** Rejects (0, 0) and coordinates outside Europe, which a robot without a GPS fix reports. */
export function isPlausibleRobotPosition([lat, lng]) {
    if (lat === 0 || lng === 0) return false;
    return lat >= 35 && lat <= 72 && lng >= -35 && lng <= 45;
}

export function averageCoordinate(coordinates) {
    const sum = coordinates.reduce(([lat, lng], [cLat, cLng]) => [lat + cLat, lng + cLng], [0, 0]);
    return [sum[0] / coordinates.length, sum[1] / coordinates.length];
}
