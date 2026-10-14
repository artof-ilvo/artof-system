"""
Implement editor (system:implement_edit).

These tests write implement files: run them against a copy of the ILVO directory, e.g.
    cp -r /var/lib/ilvo /tmp/ilvo-test
    ILVO_PATH=/tmp/ilvo-test python manage.py test app_system
"""
import json
import os
from unittest import mock

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


class PlatformSettingsEditTest(SimpleTestCase):
    def setUp(self):
        with open(paths.platform_settings) as f:
            self.original_text = f.read()
        self.original = json.loads(self.original_text)

    def tearDown(self):
        with open(paths.platform_settings, 'w') as f:
            f.write(self.original_text)

    def post(self, data, name='settings.json'):
        raw = data if isinstance(data, str) else json.dumps(data)
        return self.client.post(reverse('system:edit_settings'), {'data': raw, 'name': name})

    def saved(self):
        with open(paths.platform_settings) as f:
            return json.load(f)

    def test_settings_json_renders_form(self):
        response = self.client.get(reverse('system:edit_settings'), {'filename': 'settings.json'})
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'system/platform_edit.html')
        self.assertEqual(response.context['settings_data'], self.original)

    def test_other_files_keep_json_editor(self):
        response = self.client.get(reverse('system:edit_settings'), {'filename': 'types.json'})
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'system/editor.html')

    def test_unknown_file_is_refused(self):
        response = self.client.get(reverse('system:edit_settings'), {'filename': '../etc/passwd'})
        self.assertEqual(response.status_code, 404)
        response = self.post({'a': 1}, name='../zz_escape.json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(paths.base), 'zz_escape.json')))

    def test_valid_post_keeps_keys_outside_schema(self):
        data = json.loads(self.original_text)
        data['robot']['width'] = 1.234
        data['gps']['antenna_rotation'] = 45
        response = self.post(data)
        self.assertRedirects(response, reverse('system:settings'), fetch_redirect_response=False)
        saved = self.saved()
        self.assertEqual(saved['robot']['width'], 1.234)
        self.assertEqual(saved['gps']['antenna_rotation'], 45)
        # The schema fills in transform_center/head; they are not written unless posted.
        self.assertNotIn('transform_center', saved['robot'])

    def test_invalid_json_keeps_text_and_writes_nothing(self):
        response = self.post('{"name": ')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.context['raw_json'], '{"name": ')
        self.assertEqual(self.saved(), self.original)

    def test_schema_error_writes_nothing(self):
        data = json.loads(self.original_text)
        data['hitches'][0]['name'] = 'XX'
        response = self.post(data)
        self.assertEqual(response.status_code, 400)
        self.assertIn('hitches', response.context['error'])
        self.assertEqual(self.saved(), self.original)

    def test_hitch_without_id_is_saved(self):
        data = json.loads(self.original_text)
        data['hitches'][0].pop('id', None)
        response = self.post(data)
        self.assertEqual(response.status_code, 302)
        self.assertNotIn('id', self.saved()['hitches'][0])

    def test_hitch_name_missing_from_config_is_refused(self):
        data = json.loads(self.original_text)
        data['hitches'][0]['name'] = 'R'
        response = self.post(data)
        self.assertEqual(response.status_code, 400)
        self.assertIn('config.json has no PLC variables for hitch R', response.context['error'])
        self.assertEqual(self.saved(), self.original)

    def test_new_hitch_name_in_config_is_accepted(self):
        config_path = os.path.join(paths.base, 'config.json')
        with open(config_path) as f:
            config_text = f.read()
        config = json.loads(config_text)
        for part in ('control', 'monitor'):
            config['variables']['plc'][part]['hitch_r'] = 'hitch_%s' % part
        try:
            with open(config_path, 'w') as f:
                json.dump(config, f)
            data = json.loads(self.original_text)
            data['hitches'][0]['name'] = 'R'
            self.assertEqual(self.post(data).status_code, 302)
            self.assertEqual(self.saved()['hitches'][0]['name'], 'R')
        finally:
            with open(config_path, 'w') as f:
                f.write(config_text)

    def test_duplicate_hitch_names_are_refused(self):
        data = json.loads(self.original_text)
        data['hitches'].append(json.loads(json.dumps(data['hitches'][0])))
        self.assertEqual(self.post(data).status_code, 400)


class FakeAddonManager:
    """Stands in for AddonManager so these tests do not touch the `system` key the system manager reads."""
    jobs = []
    edits = []

    def __init__(self):
        pass

    def get(self):
        return [dict(job, Json='', Idx=1, StartTime='', Status='Running' if job.get('Running') else 'Stopped',
                     ContainerId=job.get('ContainerId', 'N/A')[:12]) for job in FakeAddonManager.jobs]

    def new_addon(self):
        from app_system.utils.job import AddonManager
        return AddonManager.new_addon(self)

    def edit(self, name, value):
        FakeAddonManager.edits.append((name, value))


ADDON = {'Name': 'taskmap', 'AutoStart': True,
         'DockerRegistry': {'serveraddress': 'https://registry.hub.docker.com/v2/'},
         'DockerConfig': {'Image': 'axelwillekens/artof-taskmap-addon:dev',
                          'Env': ['TASKMAP_MIN_DISTANCE=0.1'],
                          'HostConfig': {'Binds': ['/var/lib/ilvo:/var/lib/ilvo'], 'NetworkMode': 'host',
                                         'RestartPolicy': {'Name': 'on-failure', 'MaximumRetryCount': 3}}}}
RUNNING = {'ContainerId': '0af8ab3207e852b7', 'Running': True, 'Pid': 12, 'ExitCode': -1, 'ErrorMessage': '',
           'StartTimeISO': '2026-10-09T11:33:16', 'StartCommand': False, 'StopCommand': False,
           'UpdateCommand': False}


@mock.patch('app_system.views.AddonManager', FakeAddonManager)
class AddonEditTest(SimpleTestCase):
    def setUp(self):
        FakeAddonManager.jobs = [dict(json.loads(json.dumps(ADDON)), **RUNNING)]
        FakeAddonManager.edits = []

    def post(self, data, original_name=''):
        raw = data if isinstance(data, str) else json.dumps(data)
        return self.client.post(reverse('system:edit_addon'), {'data': raw, 'original_name': original_name})

    def new(self, **changes):
        data = json.loads(json.dumps(ADDON))
        data['Name'] = 'other'
        for key, value in changes.items():
            data[key] = value
        return data

    def test_new_form_has_no_placeholder_or_empty_login(self):
        response = self.client.get(reverse('system:edit_addon'), {'name': 'new_addon'})
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'system/addon_edit.html')
        data = response.context['addon_data']
        self.assertEqual(data['DockerConfig']['Image'], '')
        self.assertNotIn('username', data['DockerRegistry'])

    def test_existing_form_hides_runtime_keys(self):
        response = self.client.get(reverse('system:edit_addon'), {'name': 'taskmap'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context['addon_data'], ADDON)
        self.assertTrue(response.context['status_info']['running'])

    def test_new_addon_is_added(self):
        response = self.post(self.new())
        self.assertEqual(response.status_code, 302)
        self.assertEqual(FakeAddonManager.edits, [('other', self.new())])

    def test_edit_keeps_runtime_keys(self):
        data = json.loads(json.dumps(ADDON))
        data['DockerConfig']['Env'] = ['TASKMAP_MIN_DISTANCE=0.5']
        response = self.post(data, original_name='taskmap')
        self.assertEqual(response.status_code, 302)
        name, saved = FakeAddonManager.edits[0]
        self.assertEqual(saved['ContainerId'], RUNNING['ContainerId'])
        self.assertEqual(saved['DockerConfig']['Env'], ['TASKMAP_MIN_DISTANCE=0.5'])

    def test_inputs_that_crash_the_system_manager_are_refused(self):
        no_image = self.new()
        del no_image['DockerConfig']['Image']
        placeholder = self.new()
        placeholder['DockerConfig']['Image'] = 'registryserver/image_name'
        for data in (no_image, placeholder, self.new(DockerConfig='x'), self.new(Name=''),
                     self.new(Name='bad name'), self.new(Name='taskmap')):
            response = self.post(data)
            self.assertEqual(response.status_code, 400, data)
        self.assertEqual(FakeAddonManager.edits, [])

    def test_rename_is_refused(self):
        data = json.loads(json.dumps(ADDON))
        data['Name'] = 'taskmap2'
        self.assertEqual(self.post(data, original_name='taskmap').status_code, 400)
        self.assertEqual(FakeAddonManager.edits, [])

    def test_invalid_json_keeps_text(self):
        response = self.post('{"Name": ', original_name='taskmap')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.context['raw_json'], '{"Name": ')


class FakeRedis:
    """Records writes instead of touching the robot's Redis."""
    variables = {'flag': {'type': 'bool'}, 'speed': {'type': 'double'}}

    def __init__(self, value):
        self.value = value
        self.writes = []

    def get_value(self, name):
        return self.value

    def set_value(self, name, value):
        self.writes.append((name, value))
        self.value = value


@mock.patch('app_system.views.PULSE_SECONDS', 0)
class MonitorPulseTest(SimpleTestCase):
    def pulse(self, redis, name='flag'):
        with mock.patch('app_system.views.redis_server', redis):
            return self.client.post(reverse('system:monitor_pulse'), json.dumps({'name': name}),
                                    content_type='application/json')

    def test_pulses_false_to_true_and_back(self):
        redis = FakeRedis(False)
        self.assertEqual(self.pulse(redis).status_code, 200)
        self.assertEqual(redis.writes, [('flag', True), ('flag', False)])

    def test_pulses_true_to_false_and_back(self):
        redis = FakeRedis(True)
        self.assertEqual(self.pulse(redis).status_code, 200)
        self.assertEqual(redis.writes, [('flag', False), ('flag', True)])

    def test_refuses_non_booleans(self):
        redis = FakeRedis(1.0)
        self.assertEqual(self.pulse(redis, 'speed').status_code, 400)
        self.assertEqual(self.pulse(redis, 'missing').status_code, 400)
        self.assertEqual(redis.writes, [])

    def test_refuses_a_second_pulse_while_one_runs(self):
        redis = FakeRedis(False)
        with mock.patch('app_system.views._pulsing', {'flag'}):
            self.assertEqual(self.pulse(redis).status_code, 409)
        self.assertEqual(redis.writes, [])
