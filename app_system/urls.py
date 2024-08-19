from django.urls import path
from . import views

app_name = 'system'

urlpatterns = [
    path('', views.settings, name='settings'),
    path('settings/', views.settings, name='settings'),
    path('settings/edit', views.edit_settings, name='edit_settings'),
    path('process/', views.processes, name='process'),
    path('process/start', views.start_process, name='start_process'),
    path('process/stop', views.stop_process, name='stop_process'),
    path('process/edit', views.edit_process, name='edit_process'),
    path('addon/', views.addons, name='addon'),
    path('addon/start', views.start_addon, name='start_addon'),
    path('addon/stop', views.stop_addon, name='stop_addon'),
    path('addon/update', views.update_addon, name='update_addon'),
    path('addon/edit', views.edit_addon, name='edit_addon'),
    path('addon/delete', views.delete_addon, name='delete_addon'),
    path('monitor/', views.monitor, name='monitor'),
    path('monitor/edit', views.monitor_edit, name='monitor_edit'),
    path('implement/', views.implement, name='implement'),
    path('implement/edit', views.implement_edit, name='implement_edit'),
    path('implement/remove', views.implement_remove, name='implement_remove')
]
