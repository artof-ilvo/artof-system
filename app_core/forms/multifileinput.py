from django import forms
import os
import tempfile
from artof_utils.shapefile import Shapefile
from ..utils.shapefiles import load_uploaded_gdf, prepare_upload


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
        """
        Loads the uploaded shapefile as it will be stored (see prepare_upload), for a preview.
        Returns (Shapefile, note); raises ShapefileError when the upload is not a valid shapefile.
        """
        gdf, note = prepare_upload(load_uploaded_gdf(self.files.getlist('files')))

        # artof_utils builds the preview (lat/lng) from a shapefile on disk
        with tempfile.TemporaryDirectory() as folder:
            gdf.to_file(os.path.join(folder, 'upload.shp'))
            return Shapefile(folder), note
