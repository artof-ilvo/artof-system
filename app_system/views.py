from django.shortcuts import render, redirect
from django.http import HttpResponse, JsonResponse
from django.urls import reverse
from .utils.job import AddonManager, ProcessManager
import artof_utils.paths as paths
from artof_utils.redis_instance import redis_server
from artof_utils.implement import implement_manager
from artof_utils.schemas.implement import Implement, Section
from artof_utils.schemas.settings import HitchName, HitchType, PlatformSettings, Transform, VehicleConfig
from pydantic import ValidationError

from os import path
import copy
import json


# Create your views here.
# Settings
def settings(request):
    return render(request, "system/settings.html")


SETTINGS_FILES = ('settings.json', 'config.json', 'types.json')
PLATFORM_SETTINGS_FILE = 'settings.json'


def _render_platform_edit(request, data, error=None, status=200, raw_json=None):
    context = {
        'settings_data': data,
        'raw_json': raw_json,
        'types': [t.value for t in HitchType],
        'hitch_names': [n.value for n in HitchName],
        'vehicle_configs': [c.value for c in VehicleConfig],
        'error': error,
    }
    return render(request, "system/platform_edit.html", context, status=status)


def _validate_platform_settings(data):
    """Returns an error message, or None when `data` is valid for artof_utils' PlatformSettings."""
    if not isinstance(data, dict):
        return "The settings must be a JSON object."
    try:
        # The model fills in missing keys of the dict it is given: validate a copy.
        PlatformSettings.model_validate(copy.deepcopy(data))
    except ValidationError as e:
        return "Invalid settings: " + "; ".join(
            "%s: %s" % (".".join(str(p) for p in err['loc']), err['msg']) for err in e.errors())
    return None


def edit_settings(request):
    if request.method == 'POST':
        filename = request.POST.get('name', '')
        if filename not in SETTINGS_FILES:
            return HttpResponse("Unknown settings file \"%s\"" % filename, status=400)
        raw = request.POST.get('data', '')
        if filename == PLATFORM_SETTINGS_FILE:
            try:
                data = json.loads(raw)
            except ValueError as e:
                return _render_platform_edit(request, {}, "Invalid JSON: %s" % e, 400, raw_json=raw)
            error = _validate_platform_settings(data)
            if error:
                return _render_platform_edit(request, data, error, 400)
        else:
            data = json.loads(raw)
        filepath = path.join(paths.base, filename)

        # Written as posted (not as the model dumps it), so keys outside the schema are kept.
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=4)

        return redirect(reverse('system:settings'))
    elif request.method == 'GET':
        filename = request.GET.get('filename', '')
        if filename not in SETTINGS_FILES:
            return HttpResponse("Unknown settings file \"%s\"" % filename, status=404)
        filepath = path.join(paths.base, filename)

        context = {"Name": filename, "Json": ""}
        if path.exists(filepath):
            with open(filepath, 'r') as f:
                data = json.load(f)
        else:
            return HttpResponse("Filename \"%s\" does not exist" % filepath, status=404)

        if filename == PLATFORM_SETTINGS_FILE:
            return _render_platform_edit(request, data)
        context["Json"] = json.dumps(data, indent=4)
        return render(request, "system/editor.html", context)
    else:
        # Handle other HTTP methods if needed
        return HttpResponse('Unsupported method', status=405)


# Processes
def processes(request):
    manager = ProcessManager()
    return render(request, "system/process.html", context={"processes": manager.get()})


def start_process(request):
    manager = ProcessManager()
    manager.start(request.GET.get('name', ''))
    return redirect(reverse('system:process'))


def stop_process(request):
    manager = ProcessManager()
    manager.stop(request.GET.get('name', ''))
    return redirect(reverse('system:process'))


def edit_process(request):
    manager = ProcessManager()
    if request.method == 'POST':
        name = request.POST.get('name', '')
        data = json.loads(request.POST.get('data', ''))
        data["Name"] = name
        # Inhibit process editing via Json
        # manager.edit(name, data)

        return redirect(reverse('system:process'))
    elif request.method == 'GET':
        process_name = request.GET.get('name', '')
        process = [process for process in manager.get() if process["Name"] == process_name]
        if len(process) == 0:
            return HttpResponse("Process not found", status=404)

        return render(request, "system/editor.html", context=process[0])
    else:
        # Handle other HTTP methods if needed
        return HttpResponse('Unsupported method', status=405)


# Addons
def addons(request):
    manager = AddonManager()
    return render(request, "system/addon.html", context={"addons": manager.get()})


def start_addon(request):
    manager = AddonManager()
    manager.start(request.GET.get('name', ''))
    return redirect(reverse('system:addon'))


def stop_addon(request):
    manager = AddonManager()
    manager.stop(request.GET.get('name', ''))
    return redirect(reverse('system:addon'))


def update_addon(request):
    manager = AddonManager()
    manager.update(request.GET.get('name', ''))
    return redirect(reverse('system:addon'))


def edit_addon(request):
    manager = AddonManager()
    if request.method == 'POST':
        name = request.POST.get('name', '')
        data = json.loads(request.POST.get('data', ''))
        data["Name"] = name
        manager.edit(name, data)

        return redirect(reverse('system:addon'))

    elif request.method == 'GET':
        addon_name = request.GET.get('name', '')
        if addon_name == "new_addon":
            addon = manager.new_addon()
        else:
            addon = [addon for addon in manager.get() if addon["Name"] == addon_name]
            if len(addon) == 0:
                return HttpResponse("Addon not found", status=404)
            else:
                addon = addon[0]

        return render(request, "system/editor.html", context=addon)
    else:
        # Handle other HTTP methods if needed
        return HttpResponse('Unsupported method', status=405)

def delete_addon(request):
    manager = AddonManager()
    manager.delete(request.GET.get('name', ''))
    return render(request, "system/addon.html", context={"addons": AddonManager().get()})

# Monitor
def monitor(request):
    return render(request, "system/monitor.html", context={"variables": redis_server.variables})

def monitor_edit(request):
    body_unicode = request.body.decode('utf-8')
    body = json.loads(body_unicode)
    redis_server.set_value(body["name"], body["value"])
    return JsonResponse({})


# Implement
def implement(request):
    implements = []
    for idx, implement in enumerate(implement_manager.implements):
        implements.append({'idx': idx, 'name': implement.name})
    return render(request, "system/implement.html", context={'implements': implements})

def _platform_context():
    """Robot outline and hitches from settings.json, for the implement preview."""
    try:
        with open(paths.platform_settings, 'r') as f:
            platform = json.load(f)
    except (OSError, ValueError):
        return {'robot': None, 'hitches': []}
    hitches = [{key: hitch.get(key) for key in ('name', 'types', 'transform', 'link_length')}
               for hitch in platform.get('hitches', [])]
    return {'robot': platform.get('robot'), 'hitches': hitches}


def _unsafe_implement_name(name):
    """True when `name` would not stay inside the implement directory as `<name>.json`."""
    return any(c in name for c in '/\\') or name.startswith('.')


def _validate_implement_name(name, original_name):
    """Returns an error message, or None when `name` can be used as implement file name."""
    if not name or name.strip() != name:
        return "The implement needs a name without leading or trailing spaces."
    if _unsafe_implement_name(name):
        return "The name cannot contain slashes or start with a dot."
    if name != original_name and path.exists(path.join(paths.implements, '%s.json' % name)):
        return "An implement named \"%s\" already exists." % name
    return None


def _render_implement_edit(request, data, original_name, error=None, status=200, raw_json=None):
    context = {
        'implement_data': data,
        'raw_json': raw_json,
        'platform_data': _platform_context(),
        'original_name': original_name,
        'types': [t.value for t in HitchType],
        'error': error,
    }
    return render(request, "system/implement_edit.html", context, status=status)


def implement_edit(request):
    if request.method == 'POST':
        original_name = request.POST.get('original_name', '')
        raw = request.POST.get('data', '')
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("The implement must be a JSON object.")
            implement_ = Implement(**data)
        except ValidationError as e:
            errors = "; ".join("%s: %s" % (".".join(str(p) for p in err['loc']), err['msg']) for err in e.errors())
            return _render_implement_edit(request, data, original_name, "Invalid implement: %s" % errors, 400)
        except ValueError as e:
            return _render_implement_edit(request, {'name': original_name}, original_name,
                                          "Invalid JSON: %s" % e, 400, raw_json=raw)

        error = _validate_implement_name(implement_.name, original_name)
        if error:
            return _render_implement_edit(request, data, original_name, error, 400)

        implement_manager.update_implement(implement_.name, implement_)
        if original_name and original_name != implement_.name:
            implement_manager.remove_implement(original_name)
        return redirect(reverse('system:implement'))
    elif request.method == 'GET':
        name = request.GET.get('name')
        if name == 'new':
            section = Section(id='S', width=0.5, up=0.05, down=0.05, transform=Transform(T=[0.0, -1.0, 0.0]))
            return _render_implement_edit(request, Implement(name='', sections=[section]).context, '')
        if not name or _unsafe_implement_name(name) or not path.exists(path.join(paths.implements, '%s.json' % name)):
            return HttpResponse("Implement \"%s\" not found" % name, status=404)
        return _render_implement_edit(request, implement_manager.get_implement(name).context, name)
    else:
        # Handle other HTTP methods if needed
        return HttpResponse('Unsupported method', status=405)


def implement_remove(request):
    implement_manager.remove_implement(request.GET.get('name'))
    return implement(request)
