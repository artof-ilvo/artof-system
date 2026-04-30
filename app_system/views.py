from django.shortcuts import render, redirect
from django.http import HttpResponse, JsonResponse
from django.urls import reverse
from .utils.job import AddonManager, ProcessManager
import artof_utils.paths as paths
from artof_utils.redis_manager import redis_manager
from artof_utils.implement_manager import implement_manager
from artof_utils.schemas.implement import Implement

from django.contrib.auth.decorators import login_required
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.models import User

from os import path
import json


# Create your views here.

@login_required
def settings(request):
    return render(request, "system/settings.html")


@login_required
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

@login_required
def edit_account(request):
    user = request.user
    context = {'error': None, 'success': None}

    if request.method == 'POST':
        new_username = request.POST.get('username')
        old_password = request.POST.get('old_password')
        new_password = request.POST.get('new_password')
        confirm_password = request.POST.get('confirm_password')

        # 1. Update de gebruikersnaam
        if new_username and new_username != user.username:
            # Check of de nieuwe naam niet al door een ander wordt gebruikt
            if User.objects.filter(username=new_username).exists():
                context['error'] = 'Deze gebruikersnaam is al in gebruik.'
                return render(request, "system/edit_account.html", context)
            
            user.username = new_username
            user.save()
            context['success'] = 'Gebruikersnaam succesvol gewijzigd!'

        # 2. Update het wachtwoord (alleen als de velden zijn ingevuld)
        if old_password or new_password:
            if not user.check_password(old_password):
                context['error'] = 'Huidig wachtwoord is onjuist.'
            elif new_password != confirm_password:
                context['error'] = 'De nieuwe wachtwoorden komen niet overeen.'
            elif len(new_password) < 6:
                context['error'] = 'Het wachtwoord moet minimaal 6 tekens lang zijn.'
            else:
                user.set_password(new_password)
                user.save()
                # Zorg dat de gebruiker NIET wordt uitgelogd na de wijziging!
                update_session_auth_hash(request, user)
                context['success'] = 'Account succesvol bijgewerkt!'

    return render(request, "system/edit_account.html", context)


@login_required
def processes(request):
    manager = ProcessManager()
    return render(request, "system/process.html", context={"processes": manager.get()})


@login_required
def start_process(request):
    manager = ProcessManager()
    manager.start(request.GET.get('name', ''))
    return redirect(reverse('system:process'))


@login_required
def stop_process(request):
    manager = ProcessManager()
    manager.stop(request.GET.get('name', ''))
    return redirect(reverse('system:process'))


@login_required
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


@login_required
def addons(request):
    manager = AddonManager()
    return render(request, "system/addon.html", context={"addons": manager.get()})


@login_required
def start_addon(request):
    manager = AddonManager()
    manager.start(request.GET.get('name', ''))
    return redirect(reverse('system:addon'))


@login_required
def stop_addon(request):
    manager = AddonManager()
    manager.stop(request.GET.get('name', ''))
    return redirect(reverse('system:addon'))


@login_required
def update_addon(request):
    manager = AddonManager()
    manager.update(request.GET.get('name', ''))
    return redirect(reverse('system:addon'))


@login_required
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

@login_required
def delete_addon(request):
    manager = AddonManager()
    manager.delete(request.GET.get('name', ''))
    return render(request, "system/addon.html", context={"addons": AddonManager().get()})

@login_required
def monitor(request):
    return render(request, "system/monitor.html", context={"variables": redis_manager.variables})

@login_required
def monitor_edit(request):
    body_unicode = request.body.decode('utf-8')
    body = json.loads(body_unicode)
    redis_manager.set_value(body["name"], body["value"])
    return JsonResponse({})


@login_required
def implement(request):
    implements = []
    for idx, implement in enumerate(implement_manager.implements):
        implements.append({'idx': idx, 'name': implement.name})
    return render(request, "system/implement.html", context={'implements': implements})

@login_required
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


@login_required
def implement_remove(request):
    implement_manager.remove_implement(request.GET.get('name'))
    return implement(request)