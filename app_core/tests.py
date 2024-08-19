from django.test import TestCase
from .forms.task import TaskFormSet

from .utils.visualisation import Robot
from artof_utils.schemas.state import State

# Create your tests here.
class TaskFormSetTest(TestCase):
    def test_formset(self):
        # Create a formset with a prefix
        query_params = {'form-TOTAL_FORMS': '2', 'form-INITIAL_FORMS': '2', 'form-MIN_NUM_FORMS': '0', 'form-MAX_NUM_FORMS': '1000', 'form-0-task_name': 'Task1', 'form-0-files': '', 'form-0-hitch': 'FB', 'form-0-type': 'hitch', 'form-0-implement': 'none', 'form-1-task_name': 'Task2', 'form-1-files': '', 'form-1-hitch': 'FB', 'form-1-type': 'continuous', 'form-1-implement': 'none'}
        formset_data = {key: value for key, value in query_params.items() if key.startswith('form')}
        # Initialize the formset with the filtered data
        formset = TaskFormSet(data=formset_data, prefix='form')

        # Check that the formset is valid
        self.assertTrue(formset.is_valid())

        # Access the cleaned data and verify specific values
        cleaned_data = formset.cleaned_data
        self.assertEqual(cleaned_data[0]['task_name'], 'Task1')
        self.assertEqual(cleaned_data[1]['task_name'], 'Task2')