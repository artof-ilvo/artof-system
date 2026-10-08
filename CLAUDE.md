# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Django web app ("system add-on") of the [ARTOF](https://artof-ilvo.github.io) agricultural robot. It runs on the robot itself (Docker, `--network=host`) and is the operator UI: field/traject editing on a map, live robot status, navigation/hitch settings, and an admin section for processes, addons, implements and Redis variables.

Almost all domain logic lives in the external package **`artof_utils`** (installed in `.venv`, source under `.venv/lib/python3.12/site-packages/artof_utils/`): `robot_manager`, `redis_server`, `Field`/`Fields`, traject/polygon helpers, implement manager, paths. This repo is mostly views, consumers and templates around it. Read that package when you need data shapes (e.g. `Field.context`, `RobotManager.status()`/`context()`).

## Commands

The app needs a running Redis (RedisJSON) and an `ILVO_PATH` directory (normally `/var/lib/ilvo`, holding `settings.json`, `config.json`, `types.json`, `field/`, `implement/`).

```bash
# Dev server (daphne is in INSTALLED_APPS, so runserver is ASGI and serves the websockets)
ILVO_PATH=/var/lib/ilvo DEBUG=1 .venv/bin/python manage.py runserver 0.0.0.0:8000

# Production-like (what the Docker image runs: gunicorn + uvicorn worker, ilvo.asgi:application)
ILVO_PATH=/var/lib/ilvo DEBUG=0 .venv/bin/daphne -b 127.0.0.1 -p 8000 ilvo.asgi:application

.venv/bin/python manage.py check
.venv/bin/python manage.py test app_core          # single app
.venv/bin/python manage.py test app_core.tests.TaskFormSetTest.test_formset
```

Shapefile tests write field data, so run them against a copy of the ILVO directory (they refuse to run on `/var/lib/ilvo`):

```bash
cp -r /var/lib/ilvo /tmp/ilvo-test
ILVO_PATH=/tmp/ilvo-test .venv/bin/python manage.py test app_core.test_shapefiles
```

Shapes are saved through `app_core/utils/shapefiles.py`: uploads are stored as the uploaded GeoDataFrame (attributes and projected CRS kept), and coordinate-based edits go through `preserving_attributes()`, because `artof_utils`' `Shapefile.update(coordinates)` writes geometry only.

`app_core/tests.py` imports `app_core.forms.task`, which no longer exists, so that test module currently fails to import. There is no linter or JS build configured.

Docker: `docker build -t axelwillekens/artof-system:sqat .` and run with `--network=host -v /var/lib/ilvo:/var/lib/ilvo`. CI (`.github/workflows/ci.yml`) only builds and pushes the image (tag `dev` and version/`latest`).

## Architecture

- **`ilvo/`** – project: settings, `urls.py` (`/core/` → `app_core`, `/system/` → `app_system`, `/` redirects to the field page), `routing.py` + `consumers.py` for websockets, `filters.py` (`split` template filter, loaded as `filters`).
- **`app_core`** – operator app (namespace `core`): field list/edit, map page, settings. Views are function-based and call `robot_manager` / `Field`; many actions are GET links that do the change and redirect or re-render a full page.
- **`app_system`** – admin (namespace `system`): JSON editor for settings/processes/addons/implements (`templates/system/editor.html`), Redis variable monitor.
- **Websockets** (`ilvo/consumers.py`): `CustomConsumer` pushes `get_data()` every 200 ms to each client. `/ws/status/` → `robot_manager.status()` (status bar + notifications), `/ws/robot/` → `robot_manager.context()` (robot pose, hitches, implements, controller info; also receives `{command, value}` drive commands), `/ws/redis/` → all Redis variables (monitor page).
- **Static files** are served by the ASGI app itself (`ilvo/asgi.py` wraps Django in `ASGIStaticFilesHandler`, also with `DEBUG=0`, adding `Cache-Control: no-cache`), so there is no collectstatic step or separate web server.

### Frontend

Server-rendered Django templates + Bootstrap 5 + Leaflet (plugins: rotate-map, polylineDecorator, leaflet-draw), loaded from CDNs. No jQuery and no build step: JavaScript is native ES modules in `static/js/`, loaded with `<script type="module" src="{% static ... %}">`.

- `templates/app/base.html` and `templates/system/base.html` load `static/js/pages/app-base.js` / `system-base.js` (status websocket, status bar, notification toast, generic form controls). Each page then loads its own module from `static/js/pages/`.
- Conventions that keep templates free of inline JS:
  - Server data goes to JS via `{{ value|json_script:"id" }}` and `readJSON("id")` (e.g. `field_data`, added to the context by `with_field_data()` in `app_core/views.py`; don't `JSON.parse` the `field_json` string in a template).
  - Endpoint URLs come from the element that uses them (`form.action`, `data-*-url` attributes).
  - Reusable components in `templates/components/` are wired up through data attributes handled by `static/js/components/form-controls.js` (`data-stepper` + `data-step`, `data-autosubmit`, range `data-label`).
  - POSTs go through `static/js/lib/http.js`, which takes the CSRF token from `<meta name="csrf-token">`; websockets use `LiveSocket` (`static/js/lib/live-socket.js`).
  - Feedback: `showToast()` / `showError()` (`static/js/components/toast-stack.js`) for request results, `withBusy(button, promise)` (`lib/dom.js`) for spinners on fetch actions, `data-busy` on forms that navigate away, `data-confirm="Question?"` (+ optional `data-confirm-label`) on destructive forms (`components/confirm-dialog.js`). `NotificationToast` is only for robot notifications, since closing it acknowledges them on the server.
- Styling: light theme only. All colours, radii and shadows are tokens in `:root` of `static/css/app.css` (brand colour `--brand`), which also overrides Bootstrap's CSS variables; prefer those tokens and the existing classes (`page-header`, `card` + `table-modern table-cards` with `data-label` cells for phone layouts, `btn-ghost btn-icon` row actions, `section-toggle` collapsible sections, `segmented` radio groups, `floating-panel` map controls) over new one-off styles. Shared `<head>` assets and the toast/confirm overlays live in `templates/components/head_assets.html` and `overlays.html`.
- Map code shared by the map and field-edit pages is in `static/js/map/` (`createMap` persists the view in sessionStorage, `RobotLayer` draws the `/ws/robot/` data, `field-layers.js` draws traject/geofence/tasks).
- Map page editing (`static/js/pages/map/`): `ShapeEdit` holds `server` / `accepted` / `preview` geometry of the selected shape. Traject and polygon operations are computed server-side (`core:map_edit_traject_operation`, `core:map_edit_polygon_operation`) and shown as a dashed preview; check buttons accept, the upload form posts `accepted`. Traject `reverse` returns nested paths, all other operations a single path that the client wraps in `[...]`.
- Coordinates: geometries carry both projected coordinates (`xy`, `paths`, `rings`, `points` in the field's UTM CRS) and `latlng` (WGS84) for Leaflet.

## Gotchas

- `app_core/views.py`, `app_core/urls.py` and `ilvo/consumers.py` use CRLF line endings; preserve them when editing.
- With `DEBUG=0` Django caches templates: restart the server after editing templates before checking the result.
- `.gitignore` patterns are root-anchored for `/lib/`; a bare `lib/` would ignore `static/js/lib/`.
- Several endpoints write to the live robot (navigation state, simulation, hitch/navigation settings, monitor edits, map uploads). Be careful when exercising the UI against a real robot's Redis.
