// Draws the live robot state received on /ws/robot/.

const pointStyle = (fillColor) => ({ stroke: false, fillColor, fillOpacity: 0.8, radius: 1.5 });

export class RobotLayer {
    constructor(map) {
        this.group = L.layerGroup().addTo(map);
        /** Last received robot center, `{latlng, xy}`. */
        this.location = null;
        this.heading = 0;
    }

    render(data) {
        this.group.clearLayers();
        this.location = data.robot.center;
        this.heading = data.robot.orientation;

        this.add(L.polygon(data.robot.contours.latlng, { stroke: false, fillColor: 'blue', fillOpacity: 0.5 }));

        for (const hitch of Object.values(data.hitches ?? {})) {
            this.add(L.circleMarker(hitch.state.ball.point.latlng, pointStyle('white')));
            this.add(L.circleMarker(hitch.state.ref.point.latlng, pointStyle(hitch.activate ? 'red' : 'white')));
        }

        const controller = data.controller_info;
        if (controller) {
            for (const key of ['current', 'carrot', 'closest', 'headCurrent', 'headClosest']) {
                if (controller[key]) this.add(L.circleMarker(controller[key].latlng, pointStyle('green')));
            }
        }

        for (const implement of Object.values(data.implements ?? {})) {
            for (const section of implement.sections) {
                const color = section.rate > 0 ? 'red' : 'white';
                this.add(L.polygon(section.latlng, { color, weight: 1, fillOpacity: 0.5 }));
            }
        }
    }

    add(layer) {
        layer.addTo(this.group);
    }
}
