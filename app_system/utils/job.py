from artof_utils.redis_instance import redis_server
from .format_time import format_datetime
from enum import Enum
import json
import time

class JobType(Enum):
    ADDON = 'ilvoAddons'
    PROCESS = 'ilvoProcesses'


class JobManager:
    def __init__(self, job_type: JobType):
        self.job_type = job_type
        self.redis_json = redis_server.get_json_value("system")
        self.jobs = self.redis_json[self.job_type.value]

    def get(self):
        return self.jobs

    def wait_for_confirmation(self, name, variable: str, value: bool):
        system = redis_server.get_json_value("system")
        for job in system[self.job_type.value]:
            if job["Name"] == name:
                if job[variable] == value:
                    self.jobs = system[self.job_type.value]
                    return True
        return False

    def start(self, name):
        system = redis_server.get_json_value("system")
        for job in system[self.job_type.value]:
            if job["Name"] == name:
                job["StartCommand"] = True
                break
        redis_server.set_json_value("system", system)
        redis_server.set_value("pc.execution.notification", "Job %s has started." % name)

    def stop(self, name):
        system = redis_server.get_json_value("system")
        for process in system[self.job_type.value]:
            if process["Name"] == name:
                process["StopCommand"] = True
                break
        redis_server.set_json_value("system", system)
        redis_server.set_value("pc.execution.notification", "Job %s has stopped." % name)

    def update(self, name):
        system = redis_server.get_json_value("system")
        for process in system[self.job_type.value]:
            if process["Name"] == name:
                process["UpdateCommand"] = True
                break
        redis_server.set_json_value("system", system)
        redis_server.set_value("pc.execution.notification", "Job %s was updated. Give some time for the changes to apply." % name)

    def edit(self, name, new_value: dict):
        system = redis_server.get_json_value("system")
        idx = -1
        for i in range(len(system[self.job_type.value])):
            process = system[self.job_type.value][i]
            if process["Name"] == name:
                idx = i
                break

        if idx > -1:
            system[self.job_type.value][idx] = new_value
        else:
            system[self.job_type.value].append(new_value)

        redis_server.set_json_value("system", system)

    def delete(self, name):
        system = redis_server.get_json_value("system")
        idx = -1
        for i in range(len(system[self.job_type.value])):
            process = system[self.job_type.value][i]
            if process["Name"] == name:
                idx = i
                break

        if idx > -1:
            del system[self.job_type.value][idx]

        redis_server.set_json_value("system", system)


class ProcessManager(JobManager):
    def __init__(self):
        super().__init__(JobType.PROCESS)

    def get(self):
        processes = []
        for i in range(len(self.jobs)):
            process = self.jobs[i]
            process["Json"] = json.dumps(process, indent=4, sort_keys=True)
            process["Idx"] = i + 1
            process["StartTime"] = format_datetime(process["StartTimeISO"])
            process["Status"] = "Running" if process["Running"] else "Stopped"
            processes.append(process)
        return processes


class AddonManager(JobManager):
    def __init__(self):
        super().__init__(JobType.ADDON)

    def get(self):
        addons = []
        for i in range(len(self.jobs)):
            addon = self.jobs[i]
            addon["Json"] = json.dumps(addon, indent=4, sort_keys=True)
            addon["Idx"] = i + 1
            addon["ContainerId"] = addon["ContainerId"][:12] if "ContainerId" in addon else "N/A"
            addon["StartTime"] = format_datetime(addon["StartTimeISO"]) if "StartTimeISO" in addon else "N/A"
            addon["Status"] = "Running" if addon["Running"] else "Stopped"
            addons.append(addon)
        return addons

    def new_addon(self):
        addon = {
            "Name": "new_addon",
            "DockerRegistry": {
                "username": "",
                "password": "",
                "serveraddress": "https://hub.docker.com/v2/"
            },
            "DockerConfig": {
                "Image": "registryserver/image_name",
                "HostConfig": {
                    "Binds": [
                        "/var/lib/ilvo:/var/lib/ilvo"
                    ],
                    "NetworkMode": "host",
                    "RestartPolicy": {
                        "Name": "on-failure",
                        "MaximumRetryCount": 3
                    }
                }
            }
        }
        
        addon["Json"] = json.dumps(addon, indent=4)
        return addon
