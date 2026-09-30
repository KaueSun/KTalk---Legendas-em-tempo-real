from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ktalk.engine import Engine
from ktalk.protocol import Settings
from ktalk.segmentation import Utterance


class FakeCapture(threading.Thread):
    """A deterministic utterance source; does not access audio hardware."""
    instances = []

    def __init__(self, source, device_id, settings, stop, gate, started, enqueue, emit):
        super().__init__(daemon=True)
        self.ready = threading.Event()
        self.error = None
        self.stop_event, self.gate, self.enqueue, self.source = stop, gate, enqueue, source
        self.instances.append(self)

    def run(self):
        self.ready.set()
        while not self.gate.wait(0.01):
            if self.stop_event.is_set():
                return
        self.enqueue(self.source, Utterance(bytes(32000), 0, 1))
        self.stop_event.wait(3)


class FakeModel:
    def transcribe(self, _audio, **_kwargs):
        result = SimpleNamespace(text=' Olá, mundo. ', start=0, end=0.9, no_speech_prob=0.01, avg_logprob=-0.1)
        return iter([result]), SimpleNamespace(language='pt')


class EngineTests(unittest.TestCase):
    def test_monitor_only_never_loads_models_or_creates_captions(self):
        monitoring = threading.Event()
        original_emit = self.engine.emit
        def emit(kind, **data):
            original_emit(kind, **data)
            if kind == 'status' and data['status'] == 'monitoring':
                monitoring.set()
        self.engine.emit = emit
        self.engine.model = None
        with patch('ktalk.engine.Capture', FakeCapture), patch('ktalk.engine.load_model') as load, patch('ktalk.engine.prepare_translation') as translate:
            self.engine.start(Settings(), monitor_only=True)
            self.assertTrue(monitoring.wait(2))
            self.engine.stop()
            self.assertTrue(self.idle.wait(3))
        load.assert_not_called()
        translate.assert_not_called()
        self.assertFalse(any(event['type'] in ('caption', 'session') for event in self.events))

    def setUp(self):
        self.events = []
        self.idle = threading.Event()
        self.caption = threading.Event()
        FakeCapture.instances = []

        def emit(event_type, **data):
            self.events.append({'type': event_type, **data})
            if event_type == 'caption':
                self.caption.set()
            if event_type == 'status' and data['status'] == 'idle':
                self.idle.set()
        self.engine = Engine(emit)
        self.engine.model = FakeModel()
        self.engine.model_name = 'tiny'

    def tearDown(self):
        self.engine.stop()
        thread = self.engine.thread
        if thread:
            thread.join(3)

    def test_two_sources_stop_drain_and_restart_without_duplicate_session(self):
        with patch('ktalk.engine.Capture', FakeCapture):
            for _ in range(2):
                self.caption.clear()
                self.idle.clear()
                self.engine.start(Settings(source='both', model='tiny', mode='caption'))
                self.assertTrue(self.caption.wait(2))
                with self.assertRaises(ValueError):
                    self.engine.start(Settings(model='tiny', mode='caption'))
                self.engine.stop()
                self.assertTrue(self.idle.wait(3))
                self.assertFalse(self.engine.active)
        sessions = [event for event in self.events if event['type'] == 'session']
        captions = [event for event in self.events if event['type'] == 'caption']
        self.assertEqual(len(sessions), 2)
        self.assertNotEqual(sessions[0]['id'], sessions[1]['id'])
        self.assertEqual(len(captions), 4)
        self.assertEqual({event['source'] for event in captions}, {'system', 'microphone'})
        self.assertTrue(all(event['text'] == 'Olá, mundo.' for event in captions))

    def test_cancel_during_model_load_never_opens_capture(self):
        load_started = threading.Event()
        continue_load = threading.Event()

        def load(*_args, **_kwargs):
            load_started.set()
            continue_load.wait(3)
            return FakeModel()

        self.engine.model = None
        with patch('ktalk.engine.load_model', load), patch('ktalk.engine.Capture', FakeCapture):
            self.engine.start(Settings(model='tiny', mode='caption'))
            self.assertTrue(load_started.wait(2))
            self.engine.stop()
            continue_load.set()
            self.assertTrue(self.idle.wait(3))
        self.assertEqual(FakeCapture.instances, [])
        self.assertFalse(any(event['type'] == 'session' for event in self.events))

    def test_capture_failure_stops_all_sources_and_returns_to_idle(self):
        class FailedCapture(FakeCapture):
            def run(self):
                self.error = RuntimeError('device unavailable')
                self.ready.set()
        with patch('ktalk.engine.Capture', FailedCapture):
            self.engine.start(Settings(source='both', model='tiny', mode='caption'))
            self.assertTrue(self.idle.wait(3))
        self.assertFalse(self.engine.active)
        self.assertTrue(self.engine.stop_event.is_set())
        self.assertFalse(any(event['type'] == 'session' for event in self.events))


if __name__ == '__main__':
    unittest.main()
