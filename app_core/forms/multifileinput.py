from django import forms
import geopandas as gpd
import tempfile
from django.core.files.uploadedfile import InMemoryUploadedFile
import os
from app_core.utils.geojson import GeoJson


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

    def load_geojson(self):
        uploaded_files = self.cleaned_data.get('files')
        if not uploaded_files:
            return None
        
        target_file = None
        if isinstance(uploaded_files, list):
            for file in uploaded_files:
                if file.name.endswith('.geojson') or file.name.endswith('.json'):
                    target_file = file
                    break
            if not target_file and uploaded_files:
                target_file = uploaded_files[0]  # fallback naar eerste bestand

        else: 
            target_file = uploaded_files

        if not target_file:
            return None
        
        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, "data.geojson")
        geo_file = None

        try:
            with open(temp_path, 'wb') as temp_file:
                for chunk in target_file.chunks():
                    temp_file.write(chunk)
            geo_file = GeoJson(temp_dir, "data")

        except Exception as e:
            print(f"Error processing file: {e}")
            return None
        
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

        return geo_file
