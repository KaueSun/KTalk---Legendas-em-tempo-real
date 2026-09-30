"""Bounded decoding, confidence checks and repetition rejection for live speech."""
from collections import Counter
import math
import re


def is_repetitive(text):
    words = re.findall(r'\w+', text.casefold())
    if len(words) < 9:
        return False
    for size in (2, 3, 4):
        phrases = Counter(tuple(words[index:index + size]) for index in range(len(words) - size + 1))
        if any(count >= 3 and count * size >= len(words) * 0.5 for count in phrases.values()):
            return True
    return False


def acceptable(segment, duration):
    text = segment.text.strip()
    return bool(text) and not is_repetitive(text) and (
        segment.no_speech_prob < 0.65 and segment.avg_logprob >= -1.0
        and getattr(segment, 'compression_ratio', 0) < 2.4
        and len(text.split()) <= max(10, math.ceil(duration * 7) + 5)
    )


class Transcriber:
    def __init__(self, model, language='auto'):
        self.model = model
        self.language = language
        self.detected = {}

    def transcribe(self, source, audio):
        duration = len(audio) / 16000
        language = self.detected.get(source) if self.language == 'auto' else self.language
        results, info = self.model.transcribe(
            audio, language=language, beam_size=1, best_of=1, temperature=0,
            condition_on_previous_text=False, vad_filter=False,
            without_timestamps=True, max_new_tokens=min(160, max(24, math.ceil(duration * 12) + 8)),
            repetition_penalty=1.12, no_repeat_ngram_size=4,
            no_speech_threshold=0.6, log_prob_threshold=-1.0, compression_ratio_threshold=2.4,
        )
        accepted = [segment for segment in results if acceptable(segment, duration)]
        if self.language == 'auto' and accepted and getattr(info, 'language_probability', 0) >= 0.65:
            self.detected.setdefault(source, info.language)
        return accepted, info
