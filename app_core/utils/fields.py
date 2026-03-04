import os
from os import path
from shutil import rmtree, copytree, move
from pydantic import BaseModel

import artof_utils.paths as paths
from artof_utils.schemas.field import Field
from artof_utils.redis_manager import redis_manager

def get_field_names() -> list[str]:
    """Haalt dynamisch alle veldmappen op van de harde schijf."""
    if not path.exists(paths.fields):
        return []
    return [f.name for f in os.scandir(paths.fields) if f.is_dir()]

class Fields(BaseModel):
    current_field: str = ""
    fields: list[str] = []

    def __init__(self):
        """
        The calculations are performed on the dictionary objects whereas it is not necessary to interpret the Field
        :return: json object listing the fields and there distance to current_state in [m]
        """
        super().__init__(current_field=self.get_current_field_name(), fields=get_field_names())

    def select_field(self, field_name):
        assert field_name in self.fields, f"Field {field_name} does not exist."

        if field_name != self.current_field:
            redis_manager.set_n_values({'pc.field.name': field_name, 'pc.field.updated': True})

    def delete_field(self, field_name):
        assert field_name != self.current_field, f"Field {field_name} is currently active."

        if self.exists(field_name):
            field_path = path.join(paths.base, "field", field_name)
            rmtree(field_path, ignore_errors=True)

    def duplicate_field(self, field_name) -> Field:
        assert field_name in self.fields, f"Field {field_name} does not exist."

        field_path = path.join(paths.base, "field", field_name)
        new_field_name = f"{field_name}_copy"
        new_field_path = path.join(paths.base, "field", new_field_name)
        copytree(str(field_path), str(new_field_path), dirs_exist_ok=True)

    def create_field(self, field_name) -> Field:
        assert field_name not in self.fields, f"Field {field_name} already exists."

        new_field_path = path.join(paths.base, "field", field_name)
        os.makedirs(new_field_path, exist_ok=True)

    def rename_field(self, old_name: str, new_name: str):
        assert old_name in self.fields, f"Veld {old_name} bestaat niet."
        assert new_name not in self.fields, f"Veld {new_name} bestaat al."

        old_path = path.join(paths.fields, old_name)
        new_path = path.join(paths.fields, new_name)

        move(old_path, new_path)

        if self.current_field == old_name:
            from artof_utils.redis_manager import redis_manager
            redis_manager.set_n_values({'pc.field.name': new_name, 'pc.field.updated': True})
            self.current_field = new_name

        self.fields = [new_name if f == old_name else f for f in self.fields]

    def exists(self, field_name):
        return field_name in self.fields
    
    @staticmethod
    def get_current_field_name() -> str:
        """Leest het actieve veld uit Redis."""
        current = redis_manager.get_value('pc.field.name')
        if isinstance(current, bytes):
            return current.decode('utf-8')
        return current if current else ""

    @property
    def context(self):
        return self.model_dump()