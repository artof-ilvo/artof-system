from django.urls import path
from . import views

app_name = 'core'

urlpatterns = [
    path('', views.field),
    path('navigation/state', views.navigation_state, name='navigation_state'),
    path('notification/acknowledge', views.notification_acknowledge, name='notification_acknowledge'),
    path('map/', views.map, name='map'),
    path('map/simulation', views.map_simulation, name='map_simulation'),
    path('map/simulation/speed', views.map_simulation_speed_factor, name='map_simulation_speed'),
    path('map/simulation/position', views.map_simulation_position, name='map_simulation_position'),
    path('map/edit/shape', views.map_edit_shape, name='map_edit_shape'),
    path('map/edit/traject/operation', views.map_edit_traject_operation, name='map_edit_traject_operation'),
    path('map/edit/polygon/operation', views.map_edit_polygon_operation, name='map_edit_polygon_operation'),
    path('map/edit/traject/rows', views.map_edit_traject_rows, name='map_edit_traject_rows'),
    path('field/', views.field, name='field'),
    path('field/download', views.field_download, name='field_download'),
    path('field/edit', views.field_edit, name='field_edit'),
    path('field/edit/name', views.field_edit_name, name='field_edit_name'),
    path('field/edit/traject', views.field_edit_traject, name='field_edit_traject'),
    path('field/edit/geofence', views.field_edit_geofence, name='field_edit_geofence'),
    path('field/edit/task', views.field_edit_task, name='field_edit_task'),
    path('field/edit/task/add', views.field_edit_task_add, name='field_edit_task_add'),
    path('field/edit/task/remove', views.field_edit_task_remove, name='field_edit_task_remove'),
    path('field/edit/shapefile', views.field_edit_shapefile, name='field_edit_shapefile'),
    path('field/select', views.field_select, name='field_select'),
    path('field/duplicate', views.field_duplicate, name='field_duplicate'),
    path('field/delete', views.field_delete, name='field_delete'),
    path('field/delete/new', views.delete_new_field, name='delete_new_field'),
    path('settings/', views.settings, name='settings'),
    path('settings/update/hitch', views.update_hitch_settings, name='update_hitch_settings'),
    path('settings/update/navigation', views.update_navigation_settings, name='update_navigation_settings')
]
