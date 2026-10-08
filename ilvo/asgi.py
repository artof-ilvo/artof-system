"""
ASGI config for ilvo project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.0/howto/deployment/asgi/
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler
from django.core.asgi import get_asgi_application
from channels.auth import AuthMiddlewareStack
from ilvo import routing

# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.
django_asgi_app = get_asgi_application()


class StaticFilesHandler(ASGIStaticFilesHandler):
    """
    Serves /static/ directly from the app (also when DEBUG=0), so the robot image
    needs no separate web server or collectstatic step. Files are revalidated on
    every load, so browsers pick up new JavaScript after an image update.
    """
    async def get_response_async(self, request):
        response = await super().get_response_async(request)
        response['Cache-Control'] = 'no-cache'
        return response


application = ProtocolTypeRouter({
    "http": StaticFilesHandler(django_asgi_app),
    "websocket": URLRouter(routing.websocket_urlpatterns),
})
