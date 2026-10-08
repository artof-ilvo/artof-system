"""
Shapefile attributes are kept on upload and edits.

These tests create fields on disk: run them against a copy of the ILVO directory, e.g.
    cp -r /var/lib/ilvo /tmp/ilvo-test
    ILVO_PATH=/tmp/ilvo-test python manage.py test app_core.test_shapefiles
"""
import json
import os
import shutil
import tempfile
from glob import glob
from types import SimpleNamespace
from unittest import mock

import geopandas as gpd
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from django.urls import reverse
from shapely.geometry import LineString, MultiLineString, Polygon

import artof_utils.paths as paths
from artof_utils.schemas.field import Field

from .utils.shapefiles import (ShapefileError, attribute_table, load_uploaded_gdf, prepare_upload,
                               preserving_attributes, utm_crs, xy_to_crs)
from .views import geometry_in_utm

FIELD_NAME = 'zz_attribute_test'
# Around ILVO Merelbeke in UTM 31N
X, Y = 560000.0, 5648000.0


def setUpModule():
    if os.path.realpath(paths.base) == os.path.realpath('/var/lib/ilvo'):
        raise RuntimeError('Run these tests with ILVO_PATH set to a copy of /var/lib/ilvo, they write field data.')


def traject_gdf(crs='EPSG:32631'):
    gdf = gpd.GeoDataFrame(
        {'row_id': [1, 2], 'crop': ['wheat', 'barley'], 'width': [0.75, 1.5]},
        geometry=[LineString([(X, Y), (X, Y + 50)]), LineString([(X + 3, Y + 50), (X + 3, Y)])],
        crs='EPSG:32631')
    return gdf.to_crs(crs)


def polygon_gdf(crs='EPSG:32631'):
    gdf = gpd.GeoDataFrame(
        {'name': ['plot A'], 'area_ha': [0.25]},
        geometry=[Polygon([(X - 5, Y - 5), (X + 20, Y - 5), (X + 20, Y + 60), (X - 5, Y + 60)])],
        crs='EPSG:32631')
    return gdf.to_crs(crs)


def uploaded_files(gdf, skip=()):
    """The parts of `gdf` written as a shapefile, as Django uploaded files."""
    with tempfile.TemporaryDirectory() as folder:
        gdf.to_file(os.path.join(folder, 'upload.shp'))
        return [SimpleUploadedFile(os.path.basename(part), open(part, 'rb').read())
                for part in sorted(glob(os.path.join(folder, 'upload.*')))
                if os.path.splitext(part)[1] not in skip]


def read_shape(*parts):
    return gpd.read_file(glob(os.path.join(paths.fields, FIELD_NAME, *parts, '*.shp'))[0])


def read_bytes(*parts):
    return open(glob(os.path.join(paths.fields, FIELD_NAME, *parts, '*.dbf'))[0], 'rb').read()


def attributes(gdf):
    return attribute_table(gdf).to_dict('records')


class UploadTests(SimpleTestCase):
    def test_keeps_attributes_and_projected_crs(self):
        gdf, note = prepare_upload(load_uploaded_gdf(uploaded_files(polygon_gdf('EPSG:31370'))), 'Polygon')
        self.assertEqual(gdf.crs.to_epsg(), 31370)
        self.assertEqual(attributes(gdf), [{'name': 'plot A', 'area_ha': 0.25}])
        self.assertEqual(note, '')

    def test_splits_multi_parts_keeping_attributes(self):
        multi = gpd.GeoDataFrame({'row_id': [7]}, geometry=[MultiLineString(list(traject_gdf().geometry))], crs='EPSG:32631')
        gdf, _ = prepare_upload(load_uploaded_gdf(uploaded_files(multi)), 'LineString')
        self.assertEqual(list(gdf.geom_type), ['LineString', 'LineString'])
        self.assertEqual(attributes(gdf), [{'row_id': 7}, {'row_id': 7}])

    def test_reprojects_geographic_crs_keeping_attributes(self):
        gdf, note = prepare_upload(load_uploaded_gdf(uploaded_files(traject_gdf('EPSG:4326'))), 'LineString')
        self.assertEqual(gdf.crs, utm_crs())
        self.assertIn('Converted', note)
        self.assertEqual(attributes(gdf)[0], {'row_id': 1, 'crop': 'wheat', 'width': 0.75})
        self.assertAlmostEqual(gdf.geometry[0].coords[0][0], X, places=1)

    def test_errors(self):
        with self.assertRaisesRegex(ShapefileError, r'\.prj'):
            load_uploaded_gdf(uploaded_files(traject_gdf(), skip=('.prj',)))
        with self.assertRaisesRegex(ShapefileError, r'no \.shp'):
            load_uploaded_gdf(uploaded_files(traject_gdf(), skip=('.shp',)))
        with self.assertRaisesRegex(ShapefileError, 'Expected Polygon'):
            prepare_upload(load_uploaded_gdf(uploaded_files(traject_gdf())), 'Polygon')

    def test_xy_to_crs_round_trip(self):
        coordinates = [[[X, Y], [X, Y + 50]]]
        lambert = xy_to_crs(coordinates, 'EPSG:32631', 'EPSG:31370')
        back = xy_to_crs(lambert, 'EPSG:31370', 'EPSG:32631')
        self.assertAlmostEqual(back[0][1][1], Y + 50, places=3)
        self.assertGreater(lambert[0][0][0], 0)


class FieldTests(SimpleTestCase):
    def setUp(self):
        shutil.rmtree(os.path.join(paths.fields, FIELD_NAME), ignore_errors=True)
        self.field = Field(FIELD_NAME)

    def tearDown(self):
        shutil.rmtree(os.path.join(paths.fields, FIELD_NAME), ignore_errors=True)

    def save(self, view, input_mode, data=None, files=()):
        payload = {'name': FIELD_NAME, 'input_mode': input_mode, 'data': json.dumps(data or {'empty': False})}
        if files:
            payload['files'] = files
        return self.client.post(reverse(view), payload)

    def test_upload_keeps_traject_attributes(self):
        response = self.save('core:field_edit_traject', 'file', files=uploaded_files(traject_gdf()))
        self.assertEqual(response.status_code, 200)
        stored = read_shape('traject')
        self.assertEqual(attributes(stored), attributes(traject_gdf()))
        self.assertEqual(stored.crs.to_epsg(), 32631)

    def test_upload_keeps_geofence_attributes_and_crs(self):
        response = self.save('core:field_edit_geofence', 'file', files=uploaded_files(polygon_gdf('EPSG:31370')))
        self.assertEqual(response.status_code, 200)
        stored = read_shape('geofence')
        self.assertEqual(attributes(stored), [{'name': 'plot A', 'area_ha': 0.25}])
        self.assertEqual(stored.crs.to_epsg(), 31370)

    def test_upload_keeps_task_attributes(self):
        self.field.add_new_task()
        task = {'name': 'Task1', 'type': 'hitch', 'implement': '', 'hitch': 'FB', 'geometry': {}}
        response = self.save('core:field_edit_task', 'file', data=task, files=uploaded_files(polygon_gdf()))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(attributes(read_shape('tasks', 'Task1')), [{'name': 'plot A', 'area_ha': 0.25}])

    def test_invalid_upload_returns_message(self):
        response = self.save('core:field_edit_traject', 'file', files=uploaded_files(traject_gdf(), skip=('.prj',)))
        self.assertEqual(response.status_code, 400)
        self.assertIn('.prj', response.json()['message'])

    def test_preview(self):
        response = self.client.post(reverse('core:field_edit_shapefile'), {'files': uploaded_files(traject_gdf('EPSG:4326'))})
        self.assertEqual(response.status_code, 200)
        preview = response.json()
        self.assertIn('Converted', preview['note'])
        self.assertEqual(len(preview['latlng']), 2)
        self.assertAlmostEqual(preview['latlng'][0][0][0], 50.97, places=1)  # latitude first

    def test_original_mode_leaves_shapefile_untouched(self):
        self.save('core:field_edit_traject', 'file', files=uploaded_files(traject_gdf()))
        before = read_bytes('traject')
        self.save('core:field_edit_traject', 'original', data={'empty': False, 'latlng': [[[51.0, 3.7], [51.1, 3.8]]]})
        self.assertEqual(read_bytes('traject'), before)

    def test_draw_mode_keeps_attributes(self):
        self.save('core:field_edit_geofence', 'file', files=uploaded_files(polygon_gdf()))
        ring = [[50.98, 3.77], [50.98, 3.78], [50.99, 3.78], [50.99, 3.77], [50.98, 3.77]]
        self.save('core:field_edit_geofence', 'draw', data={'empty': False, 'latlng': [ring]})
        stored = read_shape('geofence')
        self.assertEqual(attributes(stored), [{'name': 'plot A', 'area_ha': 0.25}])
        self.assertAlmostEqual(stored.to_crs('EPSG:4326').geometry[0].exterior.coords[0][1], 50.98, places=4)

    def test_geofence_drive_mode_does_not_change_traject(self):
        self.save('core:field_edit_traject', 'file', files=uploaded_files(traject_gdf()))
        before = read_bytes('traject')
        self.save('core:field_edit_geofence', 'drive')
        self.assertEqual(read_bytes('traject'), before)

    def test_preserving_attributes(self):
        shapefile = self.field.shp_traject
        # Placeholder shapefile: no attributes to keep, GDAL's automatic FID is not one
        self.assertTrue(attribute_table(Field(FIELD_NAME).shp_traject.gdf).columns.empty)

        shapefile.update(traject_gdf())
        same_count = [[[X, Y], [X, Y + 40]], [[X + 3, Y + 40], [X + 3, Y]]]
        preserving_attributes(shapefile, lambda: shapefile.update(same_count, 'LineString'))
        self.assertEqual(attributes(read_shape('traject')), attributes(traject_gdf()))

        preserving_attributes(shapefile, lambda: shapefile.update([[X, Y], [X, Y + 10]], 'LineString'))
        self.assertEqual(attributes(read_shape('traject')), [{'row_id': 1, 'crop': 'wheat', 'width': 0.75}])

    def test_map_edit_in_utm_keeps_crs_and_attributes(self):
        self.field.update_geofence(polygon_gdf('EPSG:31370'))
        field = Field(FIELD_NAME)

        # The map page gets the geofence in UTM ...
        geometry = json.loads(field.context['field_json'])['geofence']
        geometry_in_utm(geometry)
        self.assertEqual(geometry['wkid'], 32631)
        self.assertAlmostEqual(geometry['rings'][0][0][0], X - 5, places=2)

        # ... and uploads an edited (buffered) version in UTM
        buffered = [[[X - 6, Y - 6], [X + 21, Y - 6], [X + 21, Y + 61], [X - 6, Y + 61], [X - 6, Y - 6]]]
        robot = SimpleNamespace(field=field, update_field=mock.Mock())
        with mock.patch('app_core.views.robot_manager', robot):
            response = self.client.post(reverse('core:map_edit_shape'), {'shape': 'geofence', 'geometries': json.dumps(buffered)})
        self.assertEqual(response.status_code, 302)
        robot.update_field.assert_called_once()

        stored = read_shape('geofence')
        self.assertEqual(stored.crs.to_epsg(), 31370)
        self.assertEqual(attributes(stored), [{'name': 'plot A', 'area_ha': 0.25}])
        self.assertAlmostEqual(stored.to_crs('EPSG:32631').geometry[0].exterior.coords[0][0], X - 6, places=2)
