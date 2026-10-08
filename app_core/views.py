from django.shortcuts import render, redirect
from django.urls import reverse
from django.http import HttpResponse, JsonResponse
from artof_utils.robot import robot_manager
from artof_utils.schemas.field import Fields, Field, get_current_field_name
from artof_utils.schemas.task import TaskInfo
from artof_utils.helpers import traject
from artof_utils.helpers import polygon
from artof_utils.helpers import task
from artof_utils.helpers import shape as shp
from artof_utils.schemas.settings import HitchName
import artof_utils.paths as paths
from .forms.multifileinput import FileFieldForm
from .utils.shapefiles import (ShapefileError, load_uploaded_gdf, prepare_upload, preserving_attributes,
                               set_task_attribute, sync_geom_type, task_attribute, task_geom_type, utm_crs,
                               xy_to_crs)
from glob import glob
from os import path, walk
import json
from copy import deepcopy
import io
import zipfile
from django.http import HttpResponse
from django.shortcuts import render

# Create your views here.
def create_context(data=dict()):
    data['robot_name'] = robot_manager.platform_settings.name.capitalize()
    data['navigation_state'] = {
        'states': ','.join(robot_manager.get_navigation_states()),
        'current_state': robot_manager.get_navigation_state()
    }

    return data

def notification_acknowledge(request):
    robot_manager.acknowledge_notification()
    return HttpResponse()

def navigation_state(request):
    new_state = request.POST.get("state")
    if new_state:
        robot_manager.set_navigation_state(new_state)
    return HttpResponse()

# Field
def field(request):
    fields = Fields()
    return render(request, "app/field.html", context=create_context(fields.context))

def field_download(request):
    # Folder path to be zipped and downloaded
    field_name = request.GET.get('name')
    folder_path = path.join(paths.fields, field_name)

    if path.exists(folder_path):
        # Create an in-memory zip file
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, False) as zip_file:
            for root, dirs, files in walk(folder_path):
                for file in files:
                    file_path = path.join(root, file)
                    zip_file.write(file_path, path.relpath(file_path, folder_path))

        # Prepare the zip file for download
        response = HttpResponse(zip_buffer.getvalue(), content_type='application/zip')
        response['Content-Disposition'] = 'attachment; filename="%s.zip"' % field_name
        return response

def field_select(request):
    fields = Fields()
    fields.select_field(request.GET.get("name"))
    return redirect(reverse('core:field'))

def field_delete(request):
    fields = Fields()
    fields.delete_field(request.GET.get("name"))
    return redirect(reverse('core:field'))

def delete_new_field(request):
    fields = Fields()
    field_name = "New"
    fields.delete_field(field_name)
    return redirect(reverse('core:field'))

# Field Edit
def shapefile_error(error):
    message = str(error) or 'The shape could not be saved.'
    return JsonResponse({'status': 'error', 'message': message}, status=400)

def uploaded_shape(request, geom_type):
    # The shapefile uploaded with a save in 'file' mode, with its attributes and coordinate system
    gdf, _ = prepare_upload(load_uploaded_gdf(request.FILES.getlist('files')), geom_type)
    return gdf

def field_edit_shapefile(request):
    # Preview of an uploaded shapefile; the files are uploaded again when the shape is saved
    if request.method == 'POST':
        form = FileFieldForm(request.POST, request.FILES, prefix=None)
        if form.is_valid():
            try:
                shp_file, note = form.load_shapefile()
            except ShapefileError as error:
                return shapefile_error(error)
            return JsonResponse({**shp_file.context, 'note': note})

    return JsonResponse({'status': 'error', 'message': 'No shapefile was uploaded.'}, status=400)

def with_field_data(context):
    # Lets templates pass the field to JavaScript safely with the json_script filter
    context['field_data'] = json.loads(context['field_json'])
    return context


def field_edit_context(field):
    field_context = with_field_data(field.context)

    field_context['field_name'] = field.name
    field_context['hitch_choices'] = [(hitch.name.value, hitch.name.value) for hitch in robot_manager.hitches.hitches]
    field_context['implement_choices'] = task.get_implement_choices()
    field_context['type_choices'] = task.get_type_choices()

    return field_context


def field_edit_task_add(request):
    field_name = request.GET.get('field_name')
    field = Field(field_name)
    field.add_new_task()
    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))

def field_edit_task_remove(request):
    field_name = request.GET.get('field_name')
    task_name = request.GET.get('task_name')
    field = Field(field_name)
    field.remove_task(task_name)
    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))


def field_edit_name(request):
    original_field_name = request.POST.get('original')
    new_field_name = request.POST.get('new')
    field = Field(original_field_name)

    if original_field_name != new_field_name:
        field = field.rename(new_field_name)

    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))

def field_edit_geofence(request):
    field_name = request.POST.get('name')
    field = Field(field_name)

    data = json.loads(request.POST.get('data'))
    input_mode = request.POST.get('input_mode')

    try:
        if input_mode == 'file':
            field.update_geofence(uploaded_shape(request, 'Polygon'))
            sync_geom_type(field.shp_geofence)
        elif input_mode != 'original':
            if data['empty'] or input_mode == 'drive':
                latlng, epsg = [[0, 0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0]], 32631
            else:
                latlng, epsg = data['latlng'], 4326
            preserving_attributes(field.shp_geofence, lambda: field.update_geofence(latlng, epsg=epsg))
    except (ShapefileError, AssertionError) as error:
        return shapefile_error(error)

    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))


def field_edit_traject(request):
    field_name = request.POST.get('name')
    field = Field(field_name)

    data = json.loads(request.POST.get('data'))
    input_mode = request.POST.get('input_mode')

    try:
        if input_mode == 'file':
            field.update_traject(uploaded_shape(request, 'LineString'))
            sync_geom_type(field.shp_traject)
        elif input_mode != 'original':
            if data['empty'] or input_mode == 'drive':
                latlng, epsg = [[0, 0], [10.0, 10.0]], 32631
            else:
                latlng, epsg = data['latlng'], 4326
            preserving_attributes(field.shp_traject, lambda: field.update_traject(latlng, epsg=epsg))
    except (ShapefileError, AssertionError) as error:
        return shapefile_error(error)

    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))


def field_edit_task(request):
    field_name = request.POST.get('name')
    field = Field(field_name)

    task = json.loads(request.POST.get('data'))
    input_mode = request.POST.get('input_mode')
    task_name = task['name']
    task_info = TaskInfo(name=task_name, type=task['type'], implement='' if not task['implement'] else task['implement'], hitch=task['hitch'])

    try:
        if input_mode == 'file':
            field.update_task(task_name, uploaded_shape(request, task_geom_type(task_info.type)), task_info)
            sync_geom_type(field.get_task(task_name).shp_task)
        elif input_mode == 'original':
            field.update_task(task_name, None, task_info)
        else:
            shapefile = field.get_task(task_name).shp_task
            preserving_attributes(shapefile, lambda: field.update_task(task_name, task['geometry']['latlng'], task_info, epsg=4326))
        # Store the default rate/routine for features that have none
        set_task_attribute(field.get_task(task_name))
    except (ShapefileError, AssertionError) as error:
        return shapefile_error(error)

    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))


def field_edit_task_attribute(request):
    # GET: the rate/routine per feature of a task; POST: store new values ({field_name, task_name, values})
    params = json.loads(request.body) if request.method == 'POST' else request.GET
    task = Field(params.get('field_name')).get_task(params.get('task_name'))
    if task is None:
        return JsonResponse({'status': 'error', 'message': 'Unknown task.'}, status=404)

    if request.method == 'POST':
        try:
            set_task_attribute(task, params.get('values', []))
        except ShapefileError as error:
            return shapefile_error(error)
        # Let the robot reload its active field, as for edits on the map page
        if params.get('field_name') == get_current_field_name():
            robot_manager.update_field()

    return JsonResponse({'attribute': task_attribute(task)})


def field_edit(request):
    field = Field(request.GET.get('name'))
    return render(request, 'app/field_edit.html', context=create_context(field_edit_context(field)))
      

def field_duplicate(request):
    fields = Fields()
    fields.duplicate_field(request.GET.get("name"))
    return redirect(reverse('core:field'))

# Settings
def settings(request):
    # Update context
    robot_manager.navigation.update()
    robot_manager.hitches.update()

    # Get context
    navigation_context = robot_manager.navigation.context

    navigation_mode = {
        'mode': navigation_context['navigation_mode'],
        'modes': robot_manager.get_navigation_modes()
    }
    navigation_sliders = [
        {'name': 'Velocity non operational', 'base_id': 'non_operational_velocity', 'initial': navigation_context['non_operational_velocity'], 'min': robot_manager.platform_settings.auto_velocity.min, 'max': robot_manager.platform_settings.auto_velocity.max, 'step': 0.1, 'unit': 'm/s'},
        {'name': 'Velocity operational', 'base_id': 'operational_velocity', 'initial': navigation_context['operational_velocity'], 'min': robot_manager.platform_settings.auto_velocity.min, 'max': robot_manager.platform_settings.auto_velocity.max, 'step': 0.1, 'unit': 'm/s'},
        {'name': 'Weight factor (Pure Pursuit)', 'base_id': 'weight_factor', 'initial': navigation_context['weight_factor'], 'min': 0.0, 'max': 1.0, 'step': 0.05, 'unit': ''},
        {'name': 'Carrot distance (Pure Pursuit)', 'base_id': 'carrot_distance', 'initial': navigation_context['carrot_distance'], 'min': 1.0, 'max': 6.0, 'step': 0.5, 'unit': 'm'},
        {'name': 'Kp (Pure Pursuit)', 'base_id': 'kp_purepursuit', 'initial': navigation_context['kp_purepursuit'], 'min': 0.0, 'max': 2.0, 'step': 0.1, 'unit': ''},
        {'name': 'Ki (Pure Pursuit)', 'base_id': 'ki_purepursuit', 'initial': navigation_context['ki_purepursuit'], 'min': 0.0, 'max': 0.5, 'step': 0.01, 'unit': ''},
        {'name': 'Kd (Pure Pursuit)', 'base_id': 'kd_purepursuit', 'initial': navigation_context['kd_purepursuit'], 'min': 0.0, 'max': 0.5, 'step': 0.01, 'unit': ''},
        {'name': 'Kp (Steady State)', 'base_id': 'kp_steady_state', 'initial': navigation_context['kp_steady_state'], 'min': 0.0, 'max': 2.0, 'step': 0.1, 'unit': ''},
        {'name': 'Ki (Steady State)', 'base_id': 'ki_steady_state', 'initial': navigation_context['ki_steady_state'], 'min': 0.0, 'max': 0.5, 'step': 0.01, 'unit': ''},
        {'name': 'Kd (Steady State)', 'base_id': 'kd_steady_state', 'initial': navigation_context['kd_steady_state'], 'min': 0.0, 'max': 0.5, 'step': 0.01, 'unit': ''},
        {'name': 'Kp (Rough)', 'base_id': 'kp_rough', 'initial': navigation_context['kp_rough'], 'min': 0.0, 'max': 2.0, 'step': 0.1, 'unit': ''},
        {'name': 'Ki (Rough)', 'base_id': 'ki_rough', 'initial': navigation_context['ki_rough'], 'min': 0.0, 'max': 0.5, 'step': 0.01, 'unit': ''},
        {'name': 'Kd (Rough)', 'base_id': 'kd_rough', 'initial': navigation_context['kd_rough'], 'min': 0.0, 'max': 0.5, 'step': 0.01, 'unit': ''}
    ]

    hitches = [{"name": hitch.name.value, "min": hitch.min, "max": hitch.max, "setpoint": hitch.setpoint, 'float': hitch.float} for hitch in robot_manager.hitches.hitches]
    return render(request, "app/settings.html", context=create_context({"hitches": hitches, 
                                                                        "navigation_sliders": navigation_sliders,
                                                                        "navigation_mode": navigation_mode}))

def update_navigation_settings(request):
    if request.method == 'POST':
        robot_manager.navigation.change(navigation_mode=int(request.POST['navigation_mode']),
                                        non_operational_velocity=float(request.POST['non_operational_velocity']),
                                        operational_velocity=float(request.POST['operational_velocity']),
                                        weight_factor=float(request.POST['weight_factor']),
                                        kp_purepursuit=float(request.POST['kp_purepursuit']),
                                        ki_purepursuit=float(request.POST['ki_purepursuit']),
                                        kd_purepursuit=float(request.POST['kd_purepursuit']),
                                        kp_steady_state=float(request.POST['kp_steady_state']),
                                        ki_steady_state=float(request.POST['ki_steady_state']),
                                        kd_steady_state=float(request.POST['kd_steady_state']),
                                        kp_rough=float(request.POST['kp_rough']),
                                        ki_rough=float(request.POST['ki_rough']),
                                        kd_rough=float(request.POST['kd_rough']),
                                        carrot_distance=float(request.POST['carrot_distance']))

    return settings(request)

def update_hitch_settings(request):
    if request.method == 'POST':
        hitch_names = [name.value for name in HitchName]
        hitch_setpoints = {}
        for hitch_name in hitch_names:
            if hitch_name in request.POST:
                if 'float_' + hitch_name in request.POST:
                    hitch_setpoints[hitch_name] = 99
                else:
                    hitch_setpoints[hitch_name] = int(request.POST[hitch_name])
        robot_manager.hitches.change(hitch_setpoints=hitch_setpoints)

    return settings(request)

# Map
def geometry_in_utm(geometry):
    # The map editor (operations, rows, drive-in) works in the robot's UTM coordinates,
    # also for shapes that are stored in another coordinate system
    if geometry.get('empty') or not geometry.get('wkid'):
        return
    target = utm_crs()
    for key in ('paths', 'rings', 'points'):
        if key in geometry:
            geometry[key] = xy_to_crs(geometry[key], 'EPSG:%d' % geometry['wkid'], target)
    geometry['wkid'] = target.to_epsg()

def map_context():
    robot_manager.load_field()
    map_context = with_field_data(robot_manager.field.context)
    field_data = map_context['field_data']
    for geometry in [field_data['traject'], field_data['geofence']] + [t['geometry'] for t in field_data['tasks'].values()]:
        geometry_in_utm(geometry)
    map_context['simulation'] = {
        'active': robot_manager.get_simulation_mode(),
        'speed_factor': int(robot_manager.get_simulation_speed_factor())
    }

    return map_context


def map(request):
    return render(request, "app/map.html", context=create_context(map_context()))

def map_simulation(request):
    robot_manager.set_simulation_mode(request.POST.get("simulation") == "on")
    return HttpResponse()

def map_simulation_speed_factor(request):
    robot_manager.set_simulation_speed_factor(float(request.POST.get("factor")))
    return HttpResponse()

def map_simulation_position(request):
    data = json.loads(request.body)
    robot_manager.set_position_latlon(data['lat'], data['lon'])
    return HttpResponse()

def map_edit_shape(request):
    shape = request.POST.get('shape')
    geometries = json.loads(request.POST.get('geometries'))  # in UTM, see geometry_in_utm
    field = robot_manager.field

    if shape == 'traject':
        shapefile, update = field.shp_traject, field.update_traject
        geometries = geometries[0]
    elif shape == 'geofence':
        shapefile, update = field.shp_geofence, field.update_geofence
    else:  # tasks
        shapefile = field.get_task(shape).shp_task
        update = lambda geometries: field.update_task(task_name=shape, geometries=geometries)

    # Store in the shapefile's own coordinate system and keep its attributes
    geometries = xy_to_crs(geometries, utm_crs(), shapefile.gdf.crs)
    preserving_attributes(shapefile, lambda: update(geometries=geometries))

    robot_manager.update_field()
    return redirect(reverse('core:map'))


def map_edit_traject_operation(request):
    body_unicode = request.body.decode('utf-8')
    body = json.loads(body_unicode)
    operation = traject.Operation(body["operation"])
    commands = body["commands"] if "commands" in body else {}
    new_traject = traject.perform(operation, body["data"], **commands)

    wgs84_crs = 'EPSG:4326'  # WGS 84
    utm_crs = 'EPSG:326%d' % robot_manager.platform_settings.gps.utm_zone

    new_traject_latlng = shp.transform_crs(utm_crs, wgs84_crs, new_traject)

    return JsonResponse({'path': new_traject, 'latlng': new_traject_latlng})


def map_edit_polygon_operation(request):
    body_unicode = request.body.decode('utf-8')
    body = json.loads(body_unicode)
    operation = body["operation"]
    commands = body["commands"] if "commands" in body else {}
    new_polygons = traject.perform(operation, body["data"], **commands)

    wgs84_crs = 'EPSG:4326'  # WGS 84
    utm_crs = 'EPSG:326%d' % robot_manager.platform_settings.gps.utm_zone

    new_polygons_latlng = deepcopy(body["data"])        
    if operation == 'buffer':
        new_polygons = polygon.buffer(body["data"], commands['distance'])
        new_polygons_latlng = shp.transform_crs(utm_crs, wgs84_crs, new_polygons) 
    
    return JsonResponse({'rings': new_polygons, 'latlng': new_polygons_latlng})
    


def map_edit_traject_rows(request):
    body_unicode = request.body.decode('utf-8')
    body = json.loads(body_unicode)
    traject_rows = traject.get_rows(body["data"])

    wgs84_crs = 'EPSG:4326'  # WGS 84
    utm_crs = 'EPSG:326%d' % robot_manager.platform_settings.gps.utm_zone
    traject_rows_latlng = []
    for traject_row in traject_rows:
        traject_rows_latlng.append(shp.transform_crs(utm_crs, wgs84_crs, traject_row))

    return JsonResponse({'latlng': traject_rows_latlng})
