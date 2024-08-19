import json
from artof_utils.redis_instance import redis_server
from artof_utils.robot import robot_manager

import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer


class CustomConsumer(AsyncWebsocketConsumer):
    update_time_ms = 200  # Adjust the interval as needed
    connections = set()
    
    async def connect(self):
        await self.accept()
        self.connections.add(self)
        print("%d established connections" % len(self.connections))
        asyncio.ensure_future(self.send_variables())
    
    async def disconnect(self, close_code):
        if self in self.connections:
            self.connections.remove(self)
        print("%d established connections" % len(self.connections))
        # Do we need to set await here?
        return await super().disconnect(close_code)
    
    async def send_variables(self):
        while True:
            await asyncio.sleep(self.update_time_ms / 1000)
            try:
                await self.send(text_data=json.dumps(self.get_data()))
            except Exception:
                if self in self.connections:
                    self.connections.remove(self)
                break

    async def receive(self, text_data=None, bytes_data=None):
        pass

    def get_data(self):
        pass

class RedisConsumer(CustomConsumer):
    def get_data(self):
        return {'variables': redis_server.get_all_values() }

class StatusConsumer(CustomConsumer):    
    def get_data(self):
        return robot_manager.status()

class RobotConsumer(CustomConsumer):
    def get_data(self):
        return robot_manager.context()
    
    async def receive(self, text_data=None, bytes_data=None):
        if text_data is not None:
            data = json.loads(text_data)

            vx, omega = robot_manager.get_velocity()
            omega = 0.0
            if data['command'] in ['up', 'down']:
                vx = data['value']
            if data['command'] in ['left', 'right']:
                omega = data['value']

            robot_manager.set_velocity(vx, omega)
