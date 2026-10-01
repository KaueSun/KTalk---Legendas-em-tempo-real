from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ktalk.audio import Capture
from ktalk.protocol import Settings
from ktalk.segmentation import FRAME_BYTES


class CaptureTests(unittest.TestCase):
    def test_loopback_callback_silence_confirms_last_phrase_and_clears_meter(self):
        stop, gate = threading.Event(), threading.Event()
        gate.set()
        manager, stream = MagicMock(), MagicMock()
        manager.get_host_api_info_by_type.return_value = {'index': 4}
        device = {'index': 7, 'hostApi': 4, 'name': 'Output',
                  'isLoopbackDevice': True, 'defaultSampleRate': 16000, 'maxInputChannels': 1}
        stream.is_active.return_value = True

        def open_stream(**options):
            def start_stream():
                # WASAPI can stop delivering callbacks as soon as playback ends.
                for _ in range(20):
                    options['stream_callback'](b'\x01\x00' * (FRAME_BYTES // 2), 480, None, 0)
            stream.start_stream.side_effect = start_stream
            return stream

        manager.open.side_effect = open_stream
        segments, events = [], []

        def enqueue(source, utterance):
            segments.append(utterance)
            if utterance.final:
                stop.set()

        detector = MagicMock()
        detector.classify.return_value = (True, {'level': 0.5, 'dbfs': -12, 'clipping': False})
        resampler = MagicMock(delay_seconds=0)
        resampler.process.side_effect = lambda data: data
        with patch('ktalk.audio.audio_library'), \
             patch('ktalk.audio.audio_manager') as context, \
             patch('ktalk.audio.resolve_device', return_value=device), \
             patch('ktalk.audio.VoiceDetector', return_value=detector), \
             patch('ktalk.audio.StreamingResampler', return_value=resampler):
            context.return_value.__enter__.return_value = manager
            capture = Capture('system', None, Settings(), stop, gate, [time.monotonic()],
                              enqueue, lambda kind, **data: events.append((kind, data)))
            capture.start()
            capture.join(3)
            try:
                self.assertFalse(capture.is_alive(), 'Silence must finalize without a Stop command')
                self.assertIsNone(capture.error)
                self.assertEqual(len([part for part in segments if part.final]), 1)
                self.assertTrue(any(kind == 'level' and data['level'] == 0 for kind, data in events))
                stream.close.assert_called_once()
            finally:
                stop.set()
                capture.join(1)


if __name__ == '__main__':
    unittest.main()
