from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ktalk.transcription import Transcriber, acceptable, is_repetitive


class Model:
    def __init__(self):
        self.calls = []
        self.confidence = 0.95
        self.text = 'Bom dia.'
        self.no_speech = 0.01

    def transcribe(self, audio, **options):
        self.calls.append(options)
        info = SimpleNamespace(language=options['language'] or 'pt', language_probability=self.confidence)
        segment = SimpleNamespace(text=self.text, no_speech_prob=self.no_speech, avg_logprob=-1 if self.no_speech > 0.6 else -0.1)
        return iter([segment]), info


class TranscriptionTests(unittest.TestCase):
    def test_repeated_hallucination_is_discarded_but_normal_repetition_survives(self):
        self.assertTrue(is_repetitive('é mais ou menos, ' * 40))
        self.assertFalse(is_repetitive('Não, não. Eu não disse isso. Vamos começar de novo.'))
        self.assertFalse(acceptable(SimpleNamespace(text='é mais ou menos, ' * 40), 2.4))

    def test_low_confidence_and_impossible_word_rate_are_rejected(self):
        self.assertFalse(acceptable(SimpleNamespace(text='Olá', no_speech_prob=0.9, avg_logprob=-0.1), 1))
        self.assertFalse(acceptable(SimpleNamespace(text='Olá', no_speech_prob=0.1, avg_logprob=-1.5), 1))
        self.assertFalse(acceptable(SimpleNamespace(text=' '.join(f'palavra{i}' for i in range(40)), no_speech_prob=0.1, avg_logprob=-0.1), 0.6))

    def test_decoder_has_length_and_repetition_limits(self):
        model = Model()
        Transcriber(model, 'en').transcribe('system', [0] * 16000)
        self.assertLessEqual(model.calls[0]['max_new_tokens'], 32)
        self.assertFalse(model.calls[0]['condition_on_previous_text'])
        self.assertGreater(model.calls[0]['no_repeat_ngram_size'], 0)

    def test_auto_language_stabilizes_per_source_and_resets_per_session(self):
        model = Model()
        transcriber = Transcriber(model)
        transcriber.transcribe('system', [])
        transcriber.transcribe('system', [])
        transcriber.transcribe('microphone', [])
        Transcriber(model).transcribe('system', [])
        self.assertEqual([call['language'] for call in model.calls], [None, 'pt', None, None])

    def test_uncertain_language_or_silence_is_not_locked(self):
        model = Model()
        transcriber = Transcriber(model)
        model.confidence = 0.2
        transcriber.transcribe('system', [])
        self.assertFalse(transcriber.detected)
        model.confidence = 0.95
        model.no_speech = 0.99
        results, _ = transcriber.transcribe('system', [])
        self.assertFalse(results)
        self.assertFalse(transcriber.detected)

    def test_manual_language_remains_authoritative(self):
        model = Model()
        transcriber = Transcriber(model, 'en')
        transcriber.transcribe('system', [])
        transcriber.transcribe('microphone', [])
        self.assertEqual([call['language'] for call in model.calls], ['en', 'en'])


if __name__ == '__main__':
    unittest.main()
