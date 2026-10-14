"""
Shapefile upload form: several files in one field, and only shapefile parts allowed.
"""
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from django.utils.datastructures import MultiValueDict

from .forms.multifileinput import FileFieldForm
from .forms.validators import validate_shapefile


def upload(name):
    return SimpleUploadedFile(name, b'data')


class FileFieldFormTest(SimpleTestCase):
    def form(self, *names):
        return FileFieldForm(files=MultiValueDict({'files': [upload(name) for name in names]}))

    def test_accepts_several_files(self):
        form = self.form('field.shp', 'field.shx', 'field.dbf')
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual([file.name for file in form.cleaned_data['files']], ['field.shp', 'field.shx', 'field.dbf'])

    def test_accepts_a_single_file(self):
        form = FileFieldForm(files={'files': upload('field.shp')})
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data['files'].name, 'field.shp')


class ValidateShapefileTest(SimpleTestCase):
    def test_accepts_shapefile_parts(self):
        validate_shapefile([upload(f'field{ext}') for ext in ('.shp', '.shx', '.dbf', '.prj', '.cpg')])

    def test_refuses_other_files(self):
        with self.assertRaises(ValidationError):
            validate_shapefile([upload('field.shp'), upload('field.geojson')])
