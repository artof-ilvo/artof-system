from django import forms
import geopandas as gpd
import tempfile
from django.core.files.uploadedfile import InMemoryUploadedFile
import os
from artof_utils.shapefile import Shapefile


class MultipleFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class MultipleFileField(forms.FileField):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("widget", MultipleFileInput())
        super().__init__(*args, **kwargs)

    def clean(self, data, initial=None):
        single_file_clean = super().clean
        if isinstance(data, (list, tuple)):
            result = [single_file_clean(d, initial) for d in data]
        else:
            result = single_file_clean(data, initial)
        return result


class FileFieldForm(forms.Form):
    files = MultipleFileField()

    def load_shapefile(self):
        tmp_files = []
        shp_file = None
        files = self.files.getlist('files')

        if not files:
            return shp_file

        try:
            # Get the temporary system directory
            temp_dir = tempfile.gettempdir()

            for file in files:
                if isinstance(file, InMemoryUploadedFile):
                    with open(os.path.join(temp_dir, file.name), 'wb') as temp_file:
                        temp_file.write(file.read())
                        tmp_files.append(temp_file.name)
            shp_file = Shapefile(temp_dir)

        finally:
            # Close and remove the temporary file
            for temp_file in tmp_files:
                if os.path.exists(temp_file):
                    os.remove(temp_file)

        return shp_file
