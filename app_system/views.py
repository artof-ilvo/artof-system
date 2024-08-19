from django.shortcuts import render, redirect
from django.http import HttpResponse, JsonResponse
from django.urls import reverse
from .utils.job import AddonManager, ProcessManager
import artof_utils.paths as paths
from artof_utils.redis_instance import redis_server
from artof_utils.implement import implement_manager
from artof_utils.schemas.implement import Implement

from os import path
import json


# Create your views here.
# Settings
def settings(request):
    return render(request, "system/settings.html")


def edit_settings(request):
    if request.method == 'POST':
        filename = request.POST.get('name', '')
        data = json.loads(request.POST.get('data', ''))
        filepath = path.join(paths.base, filename)

        with open(filepath, 'w') as f:
            json.dump(data, f, indent=4)

        return redirect(reverse('system:settings'))
    elif request.method == 'GET':
        filename = request.GET.get('filename', '')
        filepath = path.join(paths.base, filename)

        context = {"Name": filename, "Json": ""}
        if path.exists(filepath):
            with open(filepath, 'r') as f:
                context["Json"] = json.dumps(json.load(f), indent=4)
        else:
            return HttpResponse("Filename \"%s\" does not exist" % filepath, status=404)

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

def implement_edit(request):
    if request.method == 'POST':
        data = json.loads(request.POST.get('data'))
        implement_ = Implement(**data)
        implement_manager.update_implement(data['name'], implement_)
        return redirect(reverse('system:implement'))
    elif request.method == 'GET':
        name = request.GET.get('name')
        implement_ = implement_manager.get_implement(name)
        data = implement_.context
        context = {"Json": json.dumps(data, indent=4), "Name": data['name'] + ".json"}
        return render(request, "system/editor.html", context)
    else:
        # Handle other HTTP methods if needed
        return HttpResponse('Unsupported method', status=405)


def implement_remove(request):
    implement_manager.remove_implement(request.GET.get('name'))
    return implement(request)
