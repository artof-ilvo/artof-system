from django.urls import re_path
from .consumers import RedisConsumer, RobotConsumer, StatusConsumer, VisualisationConsumer

websocket_urlpatterns = [
    re_path(r'ws/redis/$', RedisConsumer.as_asgi(), name='ws_redis'),
    re_path(r'ws/robot/$', RobotConsumer.as_asgi(), name='ws_robot'),
    re_path(r'ws/status/$', StatusConsumer.as_asgi(), name='ws_status'),
    re_path(r'ws/visualisation/$', VisualisationConsumer.as_asgi(), name='ws_visualisation'),
    # Add other WebSocket paths and consumers as needed
]