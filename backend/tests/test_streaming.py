from pathlib import Path
import sys
import unittest
from queue import Empty

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from ktalk.dsp import StreamingResampler, VoiceDetector
from ktalk.segmentation import SpeechSegmenter, FRAME_BYTES, Utterance
from ktalk.work_queue import LatestQueue


class StreamingTests(unittest.TestCase):
    def test_progressive_captions_keep_identity_and_end_with_one_final(self):
        segmenter = SpeechSegmenter()
        updates = []
        for index in range(60):
            update = segmenter.push(bytes(FRAME_BYTES), index < 50, index * 0.03)
            if update:
                updates.append(update)
        self.assertGreaterEqual(len(updates), 3)
        self.assertFalse(updates[0].final)
        self.assertLessEqual(updates[0].end, 0.6)
        self.assertEqual(len({item.id for item in updates}), 1)
        self.assertEqual(sum(item.final for item in updates), 1)
        self.assertTrue(updates[-1].final)
        self.assertEqual([item.revision for item in updates], sorted(set(item.revision for item in updates)))
        self.assertIsNone(segmenter.flush())

    def test_stop_promotes_the_existing_partial_without_duplicate_identity(self):
        segmenter = SpeechSegmenter()
        partial = None
        for index in range(20):
            partial = segmenter.push(bytes(FRAME_BYTES), True, index * 0.03) or partial
        final = segmenter.flush()
        self.assertEqual(partial.id, final.id)
        self.assertEqual(partial.pcm, final.pcm)
        self.assertGreater(final.revision, partial.revision)
        self.assertTrue(final.final)

    def test_queue_coalesces_revisions_and_keeps_sources_independent(self):
        queue = LatestQueue(limit=2)
        for revision in range(1, 101):
            queue.put('system', Utterance(b'', 0, 1, 'a', revision, revision == 100))
        queue.put('system', Utterance(b'', 0, 1, 'a', 20, False))
        queue.put('microphone', Utterance(b'', 0, 1, 'a', 1, True))
        source, latest = queue.get()
        self.assertEqual((source, latest.revision, latest.final), ('system', 100, True))
        self.assertEqual(queue.get()[0], 'microphone')
        self.assertTrue(queue.empty())
        with self.assertRaises(Empty):
            queue.get(timeout=0)

    def test_overload_discards_oldest_phrase_without_growing_queue(self):
        queue = LatestQueue(limit=2)
        queue.put('system', Utterance(b'', 0, 1, 'a'))
        queue.put('system', Utterance(b'', 0, 1, 'b'))
        evicted = queue.put('system', Utterance(b'', 0, 1, 'c'))
        self.assertEqual(evicted[1].id, 'a')
        self.assertEqual([queue.get()[1].id for _ in range(2)], ['b', 'c'])

    def test_continuous_resampling_is_independent_of_callback_boundaries(self):
        rate = 44100
        signal = (14000 * np.sin(2 * np.pi * 420 * np.arange(rate) / rate)).astype('<i2')
        stereo = np.column_stack([signal, signal]).tobytes()
        reference = StreamingResampler(rate, 2).process(stereo)
        stream = StreamingResampler(rate, 2)
        chunks = b''.join(stream.process(stereo[i:i + 1764]) for i in range(0, len(stereo), 1764))
        np.testing.assert_array_equal(np.frombuffer(chunks, '<i2'), np.frombuffer(reference, '<i2'))
        self.assertGreater(len(chunks), 30000)

    def test_silence_and_stationary_noise_do_not_create_speech(self):
        detector = VoiceDetector()
        rng = np.random.default_rng(7)
        for noise in (False, True):
            for _ in range(100):
                pcm = (rng.normal(0, 500, 480).astype('<i2').tobytes() if noise else bytes(FRAME_BYTES))
                speech, metrics = detector.classify(pcm)
                self.assertFalse(speech)
                if not noise:
                    self.assertEqual(metrics['level'], 0)


if __name__ == '__main__':
    unittest.main()
