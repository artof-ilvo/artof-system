"""
Implement editor (system:implement_edit).

These tests write implement files: run them against a copy of the ILVO directory, e.g.
    cp -r /var/lib/ilvo /tmp/ilvo-test
    ILVO_PATH=/tmp/ilvo-test python manage.py test app_system
"""
import json
import os

from django.test import SimpleTestCase
from django.urls import reverse

import artof_utils.paths as paths

NAME = 'zz_implement_test'
RENAMED = 'zz_implement_test_renamed'

SECTION = {'id': 'N', 'width': 0.15, 'up': 0.05, 'down': 0.05, 'repeats': 4, 'offset': 0.15,
           'transform': {'T': [-0.3, -0.9, -0.4], 'R': [0, 0, 0]}}


def setUpModule():
    if os.path.realpath(paths.base) == os.path.realpath('/var/lib/ilvo'):
        raise RuntimeError('Run these tests with ILVO_PATH set to a copy of /var/lib/ilvo, they write implements.')


def implement_file(name):
    return os.path.join(paths.implements, '%s.json' % name)


class ImplementEditTest(SimpleTestCase):
    def tearDown(self):
        for name in (NAME, RENAMED):
            if os.path.exists(implement_file(name)):
                os.remove(implement_file(name))

    def post(self, data, original_name=''):
        raw = data if isinstance(data, str) else json.dumps(data)
        return self.client.post(reverse('system:implement_edit'), {'data': raw, 'original_name': original_name})

    def test_new_renders_form_with_platform(self):
        response = self.client.get(reverse('system:implement_edit'), {'name': 'new'})
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'system/implement_edit.html')
        self.assertEqual(response.context['original_name'], '')
        self.assertEqual(len(response.context['implement_data']['sections']), 1)
        self.assertIn('hitches', response.context['platform_data'])

    def test_existing_renders(self):
        self.post({'name': NAME, 'types': ['continuous'], 'sections': [SECTION]})
        response = self.client.get(reverse('system:implement_edit'), {'name': NAME})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context['implement_data']['sections'][0]['repeats'], 4)

    def test_unknown_or_unsafe_name_is_404(self):
        for name in ('does-not-exist', '../settings'):
            response = self.client.get(reverse('system:implement_edit'), {'name': name})
            self.assertEqual(response.status_code, 404, name)

    def test_valid_post_writes_file(self):
        response = self.post({'name': NAME, 'types': ['continuous'], 'on_taskmap': False, 'sections': [SECTION]})
        self.assertRedirects(response, reverse('system:implement'), fetch_redirect_response=False)
        with open(implement_file(NAME)) as f:
            saved = json.load(f)
        self.assertEqual(saved['types'], ['continuous'])
        self.assertFalse(saved['on_taskmap'])
        self.assertEqual(saved['sections'][0]['offset'], 0.15)

    def test_invalid_json_keeps_text_and_writes_nothing(self):
        response = self.post('{"name": "%s", ' % NAME)
        self.assertEqual(response.status_code, 400)
        self.assertIn('Invalid JSON', response.context['error'])
        self.assertEqual(response.context['raw_json'], '{"name": "%s", ' % NAME)
        self.assertFalse(os.path.exists(implement_file(NAME)))

    def test_schema_error_writes_nothing(self):
        response = self.post({'name': NAME, 'types': ['flying'], 'sections': []})
        self.assertEqual(response.status_code, 400)
        self.assertIn('types', response.context['error'])
        self.assertFalse(os.path.exists(implement_file(NAME)))

    def test_unsafe_or_empty_name_is_rejected(self):
        for name in ('../zz_escape', '', '.hidden'):
            response = self.post({'name': name, 'types': [], 'sections': []})
            self.assertEqual(response.status_code, 400, name)
        self.assertFalse(os.path.exists(os.path.join(paths.base, 'zz_escape.json')))

    def test_rename_removes_old_file(self):
        self.post({'name': NAME, 'types': ['continuous'], 'sections': [SECTION]})
        response = self.post({'name': RENAMED, 'types': ['continuous'], 'sections': [SECTION]}, original_name=NAME)
        self.assertEqual(response.status_code, 302)
        self.assertTrue(os.path.exists(implement_file(RENAMED)))
        self.assertFalse(os.path.exists(implement_file(NAME)))

    def test_new_implement_cannot_overwrite_existing(self):
        self.post({'name': NAME, 'types': ['continuous'], 'sections': [SECTION]})
        response = self.post({'name': NAME, 'types': ['discrete'], 'sections': []})
        self.assertEqual(response.status_code, 400)
        with open(implement_file(NAME)) as f:
            self.assertEqual(json.load(f)['types'], ['continuous'])
