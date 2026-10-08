"""
As-applied recording toggle and Applied page endpoints.

The endpoints read the as-applied sessions of a field: run against a copy of the ILVO directory, e.g.
    cp -r /var/lib/ilvo /tmp/ilvo-test
    ILVO_PATH=/tmp/ilvo-test python manage.py test app_core.test_applied
"""
import json
import shutil
from unittest import mock

from django.test import SimpleTestCase
from django.urls import reverse

import artof_utils.paths as paths
from artof_utils import as_applied
from artof_utils.schemas.field import get_field_names

from . import views

FIELD = sorted(get_field_names())[0] if paths.loaded else ''


class RecordToggleTest(SimpleTestCase):
    def post(self, record):
        return self.client.post(reverse('core:map_as_applied_record'), {'record': 'on'} if record else {})

    @mock.patch.object(views.as_applied, 'recorder_alive', return_value=True)
    @mock.patch.object(views.as_applied, 'is_recording', return_value=True)
    @mock.patch.object(views.as_applied, 'set_recording')
    @mock.patch.object(views.as_applied, 'auto_mode_active', return_value=False)
    def test_toggle_outside_auto_mode(self, auto_mode_active, set_recording, *_):
        response = self.post(True)
        self.assertEqual(response.status_code, 200)
        set_recording.assert_called_once_with(views.redis_server, True)

    @mock.patch.object(views.as_applied, 'recorder_alive', return_value=True)
    @mock.patch.object(views.as_applied, 'is_recording', return_value=True)
    @mock.patch.object(views.as_applied, 'set_recording')
    @mock.patch.object(views.as_applied, 'auto_mode_active', return_value=True)
    def test_toggle_refused_in_auto_mode(self, auto_mode_active, set_recording, *_):
        response = self.post(False)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.json()['auto_mode'])
        set_recording.assert_not_called()


class AppliedEndpointsTest(SimpleTestCase):
    """Uses a session recorded into the field of the ILVO copy; removed afterwards."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if paths.ilvo_path.rstrip('/') == '/var/lib/ilvo':
            raise RuntimeError('Run these tests against a copy of the ILVO directory, see the module docstring')
        recorder = as_applied.AsAppliedRecorder(FIELD, 'EPSG:32631')
        cls.session = recorder.session
        for i in range(4):
            y = 5647960.0 + i
            ring = [[554300.0, y], [554301.0, y], [554301.0, y + 0.1], [554300.0, y + 0.1], [554300.0, y]]
            recorder.update({'impl': {'sections': [{'id': 'A', 'rate': 50 * i, 'xy': ring}]}})
            recorder.log_point([554300.5, y], {'speed': 0.5 * i, 'busy': i % 2 == 0, 'mode': 'auto'})
        recorder.flush()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(as_applied.session_dir(FIELD, cls.session), ignore_errors=True)
        super().tearDownClass()

    def get(self, url_name, **params):
        return self.client.get(reverse(url_name), {'field': FIELD, 'session': self.session, **params})

    def test_layer_columns(self):
        response = self.get('core:applied_layer', layer='points')
        self.assertEqual(response.json()['count'], 4)
        self.assertEqual(response.json()['columns'], {'time': 'text', 'speed': 'number', 'busy': 'bool', 'mode': 'text'})

    def test_attribute_summary(self):
        self.assertEqual(self.get('core:applied_attribute', layer='points', name='speed').json(),
                         {'name': 'speed', 'kind': 'number', 'min': 0.0, 'max': 1.5, 'values': [0.0, 0.5, 1.0, 1.5]})
        self.assertEqual(self.get('core:applied_attribute', layer='points', name='busy').json()['values'],
                         ['false', 'true'])

    def test_filtered_features(self):
        filters = json.dumps([{'name': 'busy', 'values': ['true']}, {'name': 'speed', 'min': 0.5}])
        response = self.get('core:applied_features', layer='points', color='speed', filters=filters)
        self.assertEqual((response['X-Shown'], response['X-Total']), ('1', '4'))
        self.assertEqual([f['properties']['value'] for f in response.json()['features']], [1.0])

    def test_feature_and_errors(self):
        self.assertEqual(self.get('core:applied_feature', layer='points', fid=2).json()['speed'], 0.5)
        self.assertEqual(self.get('core:applied_feature', layer='points', fid=99).status_code, 400)
        self.assertEqual(self.get('core:applied_layer', layer='traject').status_code, 400)
        self.assertEqual(self.client.get(reverse('core:applied_layer'),
                                         {'field': FIELD, 'session': '../x', 'layer': 'points'}).status_code, 400)
        self.assertEqual(self.get('core:applied_attribute', layer='points', name='nope').status_code, 400)
