from artof_utils.robot import robot_manager
from artof_utils.redis_instance import redis_server
from artof_utils.schemas.state import State
from artof_utils.shapefile import transform_coordinates
import numpy as np

class Robot:
    def __init__(self) -> None:
        self.width = robot_manager.platform_settings.robot.width
        self.length = robot_manager.platform_settings.robot.length

    def shape(self, transform):
        point_ul = [- (self.width / 2), - (self.length / 2)]
        point_ur = [+ (self.width / 2), - (self.length / 2)]
        point_lr = [+ (self.width / 2), + (self.length / 2)]
        point_ll = [- (self.width / 2), + (self.length / 2)]
        points = np.array([point_ul, point_ur, point_lr, point_ll, point_ul])

        points = transform * points

    def update(self):
        state = redis_server.get_state("robot_center_state")
        
        return self.shape(state)
