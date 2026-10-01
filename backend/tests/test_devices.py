from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ktalk.audio import resolve_device


class DeviceTests(unittest.TestCase):
    def test_saved_device_is_found_after_numeric_index_changes(self):
        manager, pa = MagicMock(), MagicMock()
        manager.get_host_api_info_by_type.return_value = {'index': 4}
        device = {'index': 33, 'hostApi': 4, 'name': 'Headphones', 'isLoopbackDevice': True, 'maxInputChannels': 2}
        manager.get_device_info_generator.return_value = iter([device])
        self.assertEqual(resolve_device(manager, pa, 'system', 10, 'Headphones')['index'], 33)
        manager.get_device_info_by_index.assert_not_called()

    def test_missing_saved_device_does_not_silently_switch_to_another_source(self):
        manager = MagicMock()
        manager.get_host_api_info_by_type.return_value = {'index': 4}
        manager.get_device_info_generator.return_value = iter([])
        with self.assertRaises(ValueError):
            resolve_device(manager, MagicMock(), 'microphone', 1, 'Disconnected mic')
        manager.get_default_wasapi_loopback.assert_not_called()

    def test_default_output_is_resolved_at_each_start(self):
        manager = MagicMock()
        manager.get_default_wasapi_loopback.return_value = {'index': 21}
        self.assertEqual(resolve_device(manager, MagicMock(), 'system', None)['index'], 21)


if __name__ == '__main__':
    unittest.main()
