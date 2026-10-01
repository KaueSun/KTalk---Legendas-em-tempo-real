"""Windows WASAPI input and loopback capture. No audio is written to disk."""
import math
from contextlib import contextmanager
import queue
import threading
import time

import numpy as np
from scipy.signal import resample_poly
from .dsp import StreamingResampler, VoiceDetector

from .segmentation import FRAME_BYTES, FRAME_SECONDS, SpeechSegmenter

# PortAudio initialization/termination mutate global native state. Serializing
# them prevents simultaneous microphone/loopback threads from corrupting it.
_PORTAUDIO_LOCK = threading.Lock()


def audio_library():
    try:
        import pyaudiowpatch
    except ImportError as error:
        raise RuntimeError("A captura requer Windows e PyAudioWPatch. Execute a instalação do Python do projeto.") from error
    return pyaudiowpatch


@contextmanager
def audio_manager():
    with _PORTAUDIO_LOCK:
        manager = audio_library().PyAudio()
    try:
        yield manager
    finally:
        with _PORTAUDIO_LOCK:
            manager.terminate()


def list_devices() -> list[dict]:
    pa = audio_library()
    with audio_manager() as manager:
        api = manager.get_host_api_info_by_type(pa.paWASAPI)
        try:
            default_loopback = int(manager.get_default_wasapi_loopback()["index"])
        except (OSError, LookupError):
            default_loopback = -1
        return [
            {"id": int(device["index"]), "name": device["name"],
             "source": "system" if device.get("isLoopbackDevice") else "microphone",
             "default": int(device["index"]) == (default_loopback if device.get("isLoopbackDevice") else int(api["defaultInputDevice"]))}
            for device in manager.get_device_info_generator()
            if int(device["hostApi"]) == int(api["index"]) and device["maxInputChannels"] > 0
        ]


def resolve_device(manager, pa, source, device_id, name=None):
    api = manager.get_host_api_info_by_type(pa.paWASAPI)
    if name:
        matches = [device for device in manager.get_device_info_generator()
                   if device['name'] == name and int(device['hostApi']) == int(api['index'])
                   and device['maxInputChannels'] > 0
                   and bool(device.get('isLoopbackDevice')) == (source == 'system')]
        if len(matches) != 1:
            raise ValueError('O dispositivo escolhido não está disponível ou tem nome duplicado. Atualize a lista e selecione a entrada novamente.')
        return matches[0]
    if device_id is not None:
        return manager.get_device_info_by_index(device_id)
    if source == 'system':
        return manager.get_default_wasapi_loopback()
    if int(api['defaultInputDevice']) < 0:
        raise ValueError('Nenhum microfone foi encontrado. Conecte um microfone ou escolha Áudio do PC.')
    return manager.get_device_info_by_index(int(api['defaultInputDevice']))


def to_mono_16k(data: bytes, channels: int, sample_rate: int) -> bytes:
    samples = np.frombuffer(data, dtype="<i2").astype(np.float32).reshape(-1, channels).mean(axis=1)
    if sample_rate != 16000:
        factor = math.gcd(sample_rate, 16000)
        samples = resample_poly(samples, 16000 // factor, sample_rate // factor)
    return np.clip(samples, -32768, 32767).astype("<i2").tobytes()


class Capture(threading.Thread):
    def __init__(self, source, device_id, settings, stop, gate, started, enqueue, emit):
        super().__init__(name=f"audio-{source}", daemon=True)
        self.source, self.device_id, self.settings = source, device_id, settings
        self.stop, self.gate, self.started = stop, gate, started
        self.enqueue, self.emit = enqueue, emit
        self.ready = threading.Event()
        self.error = None

    def run(self):
        segmenter = SpeechSegmenter(self.settings.max_seconds, self.settings.partial_interval)
        raw_queue = queue.Queue(maxsize=40)
        overflow = threading.Event()
        pa = None

        def callback(data, _count, _timing, status):
            if self.stop.is_set():
                return (None, pa.paComplete)
            if status:
                overflow.set()
            try:
                raw_queue.put_nowait((data, time.monotonic()))
            except queue.Full:
                overflow.set()
            return (None, pa.paContinue)

        try:
            pa = audio_library()
            vad = VoiceDetector(self.settings.vad_mode)
            with audio_manager() as manager:
                device = resolve_device(manager, pa, self.source, self.device_id,
                                        getattr(self.settings, f'{self.source}_name'))
                if bool(device.get("isLoopbackDevice")) != (self.source == "system"):
                    raise ValueError("O dispositivo mudou. Atualize a lista de fontes de áudio.")
                if int(device['hostApi']) != int(manager.get_host_api_info_by_type(pa.paWASAPI)['index']):
                    raise ValueError("O dispositivo não usa WASAPI. Atualize a lista de fontes de áudio.")
                rate, channels = int(device["defaultSampleRate"]), int(device["maxInputChannels"])
                if not 1 <= channels <= 32 or not 8000 <= rate <= 192000:
                    raise ValueError("Formato de áudio do dispositivo não suportado.")
                stream = manager.open(format=pa.paInt16, channels=channels, rate=rate,
                                      input=True, input_device_index=int(device["index"]),
                                      frames_per_buffer=round(rate * FRAME_SECONDS),
                                      stream_callback=callback, start=False)
                try:
                    self.emit('source-ready', source=self.source, name=device['name'], sample_rate=rate)
                    self.ready.set()
                    while not self.gate.wait(0.05):
                        if self.stop.is_set():
                            return
                    if self.stop.is_set():
                        return
                    stream.start_stream()
                    resampler = StreamingResampler(rate, channels, self.settings.mic_gain if self.source == 'microphone' else 1.0)
                    pending = b""
                    last_meter = 0.0
                    last_audio = time.monotonic()
                    gap_reset = False
                    while not self.stop.is_set():
                        try:
                            data, captured = raw_queue.get(timeout=0.1)
                        except queue.Empty:
                            if self.stop.is_set():
                                break
                            if not stream.is_active():
                                raise RuntimeError("A fonte de áudio foi desconectada. Selecione o dispositivo novamente.")
                            # Some loopback devices stop callbacks entirely during silence.
                            if not gap_reset and time.monotonic() - last_audio >= 0.4:
                                tail = segmenter.flush()
                                if tail:
                                    self.enqueue(self.source, tail)
                                pending = b''
                                vad = VoiceDetector(self.settings.vad_mode)
                                resampler = StreamingResampler(rate, channels, self.settings.mic_gain if self.source == 'microphone' else 1.0)
                                self.emit('level', source=self.source, level=0, speech=False, dbfs=-120, clipping=False)
                                gap_reset = True
                            continue
                        last_audio = captured
                        gap_reset = False
                        if overflow.is_set():
                            overflow.clear()
                            self.emit("warning", message="A captura perdeu áudio. Feche outros aplicativos pesados ou use outra fonte.")
                            # Do not join speech across a discontinuity.
                            tail = segmenter.flush()
                            if tail:
                                self.enqueue(self.source, tail)
                            segmenter = SpeechSegmenter(self.settings.max_seconds, self.settings.partial_interval)
                            resampler = StreamingResampler(rate, channels, self.settings.mic_gain if self.source == 'microphone' else 1.0)
                            vad = VoiceDetector(self.settings.vad_mode)
                            pending = b""
                        pending += resampler.process(data)
                        while len(pending) >= FRAME_BYTES:
                            frame, pending = pending[:FRAME_BYTES], pending[FRAME_BYTES:]
                            timestamp = max(0.0, captured - self.started[0] - resampler.delay_seconds - (len(pending) / 32000) - FRAME_SECONDS)
                            speech, metrics = vad.classify(frame)
                            utterance = segmenter.push(frame, speech, timestamp)
                            if utterance:
                                self.enqueue(self.source, utterance)
                            now = time.monotonic()
                            if now - last_meter >= 0.12:
                                self.emit("level", source=self.source, speech=speech, **metrics)
                                last_meter = now
                finally:
                    if stream.is_active():
                        stream.stop_stream()
                    stream.close()
        except Exception as error:
            self.error = error
            self.stop.set()
            self.emit("error", message=f"Falha na captura ({self.source}): {error}")
        finally:
            self.ready.set()
            tail = segmenter.flush()
            if tail:
                self.enqueue(self.source, tail)
            self.emit("level", source=self.source, level=0, speech=False)
