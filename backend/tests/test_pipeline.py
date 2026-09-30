import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import MagicMock, patch
from contextlib import nullcontext

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import webrtcvad
from ktalk.audio import Capture, to_mono_16k
from ktalk.protocol import EventWriter, Settings
from ktalk.segmentation import FRAME_BYTES, SpeechSegmenter

SILENCE = bytes(FRAME_BYTES)
VOICE = b'\x10\x01' * (FRAME_BYTES // 2)


class PipelineTests(unittest.TestCase):
    def test_silence_never_reaches_recognition_and_memory_is_bounded(self):
        gate = SpeechSegmenter(partials=False)
        for index in range(10000):
            self.assertIsNone(gate.push(SILENCE, False, index * 0.03))
        self.assertEqual(len(gate.frames), 0)
        self.assertLessEqual(len(gate.pre_roll), 10)
        self.assertIsNone(gate.flush())

    def test_speech_has_preroll_and_flushes_after_pause(self):
        gate = SpeechSegmenter(partials=False)
        frames = [False] * 10 + [True] * 20 + [False] * 15
        results = []
        for index, voiced in enumerate(frames):
            utterance = gate.push(VOICE if voiced else SILENCE, voiced, index * 0.03)
            if utterance:
                results.append(utterance)
        self.assertEqual(len(results), 1)
        self.assertLess(results[0].start, 0.3)
        self.assertAlmostEqual(results[0].end, 1.2)
        self.assertEqual(len(results[0].pcm) % FRAME_BYTES, 0)
        self.assertIsNone(gate.flush())

    def test_long_speech_is_split_without_duplicate_pcm(self):
        gate = SpeechSegmenter(max_seconds=2.4, partials=False)
        results = []
        for index in range(180):
            utterance = gate.push(VOICE, True, index * 0.03)
            if utterance:
                results.append(utterance)
        results.append(gate.flush())
        self.assertEqual(len(results), 3)
        self.assertEqual(sum(len(result.pcm) for result in results), 180 * FRAME_BYTES)
        self.assertTrue(all(len(result.pcm) <= 80 * FRAME_BYTES for result in results))

    def test_short_click_is_rejected_and_stop_preserves_partial_speech(self):
        gate = SpeechSegmenter(partials=False)
        for index in range(3):
            gate.push(VOICE, True, index * 0.03)
        self.assertIsNone(gate.flush())
        for index in range(12):
            gate.push(VOICE, True, index * 0.03)
        self.assertEqual(len(gate.flush().pcm), 12 * FRAME_BYTES)

    def test_wrong_frame_size_is_rejected(self):
        with self.assertRaises(ValueError):
            SpeechSegmenter().push(b'\x00', False, 0)

    def test_native_stereo_rates_become_valid_vad_frames(self):
        for rate in (44100, 48000, 96000):
            stereo = np.zeros((round(rate * 0.03), 2), dtype='<i2')
            frame = to_mono_16k(stereo.tobytes(), 2, rate)
            self.assertEqual(len(frame), FRAME_BYTES)
            self.assertFalse(webrtcvad.Vad(2).is_speech(frame, 16000))

    def test_downmix_avoids_int16_overflow(self):
        stereo = np.full((480, 2), 30000, dtype='<i2')
        mono = np.frombuffer(to_mono_16k(stereo.tobytes(), 2, 16000), dtype='<i2')
        np.testing.assert_array_equal(mono, 30000)

    def test_resampling_suppresses_frequencies_above_nyquist(self):
        times = np.arange(1440) / 48000
        wave = (15000 * np.sin(2 * np.pi * 12000 * times)).astype('<i2')
        down = np.frombuffer(to_mono_16k(wave.tobytes(), 1, 48000), dtype='<i2')
        self.assertLess(float(np.std(down[20:-20])), 100)

    def test_invalid_settings_rejected(self):
        for values in ({'model': '../private'}, {'system': True}, {'vad_mode': 4}, {'max_seconds': float('nan')}, {'language': 'xx'}):
            with self.assertRaises((ValueError, TypeError)):
                Settings.parse(values)

    def test_events_are_utf8_json_lines(self):
        output = io.StringIO()
        emit = EventWriter(output)
        emit('caption', text='Olá\nmundo')
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertEqual(json.loads(output.getvalue())['text'], 'Olá\nmundo')

    def test_stop_during_silence_does_not_report_a_disconnected_device(self):
        stop, gate, running = threading.Event(), threading.Event(), threading.Event()
        gate.set()
        stream = MagicMock()
        stream.start_stream.side_effect = running.set
        stream.is_active.side_effect = lambda: not stop.is_set()
        manager = MagicMock()
        manager.get_default_wasapi_loopback.return_value = {'index': 1, 'isLoopbackDevice': True,
            'name': 'Test output', 'hostApi': 0, 'defaultSampleRate': 48000, 'maxInputChannels': 2}
        manager.get_host_api_info_by_type.return_value = {'index': 0}
        manager.open.return_value = stream
        events = []
        capture = Capture('system', None, Settings(), stop, gate, [0], lambda *_: None,
                          lambda event, **data: events.append((event, data)))
        with patch('ktalk.audio.audio_library', return_value=MagicMock()), patch('ktalk.audio.audio_manager', return_value=nullcontext(manager)):
            capture.start()
            self.assertTrue(running.wait(2))
            stop.set()
            capture.join(2)
        self.assertFalse(capture.is_alive())
        self.assertIsNone(capture.error)
        self.assertFalse(any(event == 'error' for event, _ in events))
        stream.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
