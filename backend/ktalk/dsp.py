"""Continuous resampling and a separate recurrent Silero state for each source."""
import numpy as np
import soxr


class StreamingResampler:
    def __init__(self, sample_rate, channels, gain=1.0):
        self.channels, self.gain = channels, gain
        self.resampler = soxr.ResampleStream(sample_rate, 16000, 1, dtype='float32', quality='HQ')

    def process(self, pcm):
        samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32).reshape(-1, self.channels)
        mono = samples.mean(axis=1) * (self.gain / 32768.0)
        converted = self.resampler.resample_chunk(mono)
        return (np.clip(converted, -1, 0.999969) * 32768).astype('<i2').tobytes()

    @property
    def delay_seconds(self):
        return self.resampler.delay() / 16000


class VoiceDetector:
    def __init__(self, mode=1):
        from faster_whisper.vad import get_vad_model
        self.session = get_vad_model().session
        self.threshold = (0.35, 0.45, 0.55, 0.7)[mode]
        self.h = np.zeros((1, 1, 128), dtype=np.float32)
        self.c = self.h.copy()
        self.context = np.zeros((1, 64), dtype=np.float32)
        self.pending = np.zeros(0, dtype=np.float32)
        self.probability = 0.0

    def classify(self, pcm):
        audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(audio * audio)))
        dbfs = float(20 * np.log10(max(rms, 1e-6)))
        self.pending = np.concatenate((self.pending, audio))
        while len(self.pending) >= 512:
            frame, self.pending = self.pending[:512], self.pending[512:]
            inputs = np.concatenate((self.context, frame[None, :]), axis=1)
            result, self.h, self.c = self.session.run(None, {'input': inputs, 'h': self.h, 'c': self.c})
            self.context = frame[None, -64:]
            self.probability = float(np.asarray(result).reshape(-1)[-1])
        speech = self.probability >= self.threshold and dbfs > -60
        return speech, {'level': max(0.0, min(1.0, (dbfs + 60) / 60)), 'dbfs': round(dbfs, 1),
                        'probability': round(self.probability, 3), 'clipping': bool(np.max(np.abs(audio)) > 0.985)}
