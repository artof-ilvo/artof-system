from pydantic import BaseModel


class Field:
    def __init__(self, name):
        self.name = name