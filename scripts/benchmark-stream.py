"""Feed a known WAV at real-time speed through the production pipeline; no microphone."""
import argparse
import json
import os
from pathlib import Path
import sys
import threading
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
sys.stdout.reconfigure(encoding='utf-8')
os.environ['KTALK_MODEL_DIR'] = str(ROOT / '.runtime/data/models')
os.environ['HF_HOME'] = str(ROOT / '.runtime/data/huggingface')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
from faster_whisper.audio import decode_audio
import numpy as np
from ktalk.dsp import VoiceDetector
from ktalk.engine import Engine
from ktalk.protocol import Settings
from ktalk.segmentation import SpeechSegmenter, FRAME_BYTES, FRAME_SECONDS

parser = argparse.ArgumentParser()
parser.add_argument('wav', type=Path)
parser.add_argument('--model', default='tiny', choices=('tiny', 'base', 'small'))
parser.add_argument('--loopback', action='store_true', help='Play fixture through Windows and capture actual WASAPI output')
args = parser.parse_args()
samples = decode_audio(str(args.wav), sampling_rate=16000)
pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes() + bytes(32000)
finished = threading.Event()
listening = threading.Event()
idle = threading.Event()
events = []
began = [0.0]


class FixtureCapture(threading.Thread):
    def __init__(self, source, device_id, settings, stop, gate, started, enqueue, emit):
        super().__init__(daemon=True)
        self.ready, self.error = threading.Event(), None
        self.source, self.settings, self.stop, self.gate, self.started, self.enqueue = source, settings, stop, gate, started, enqueue

    def run(self):
        vad = VoiceDetector(self.settings.vad_mode)
        segmenter = SpeechSegmenter(self.settings.max_seconds, self.settings.partial_interval)
        self.ready.set()
        self.gate.wait(15)
        for offset in range(0, len(pcm) - FRAME_BYTES + 1, FRAME_BYTES):
            if self.stop.is_set():
                break
            self.stop.wait(max(0, self.started[0] + offset / 32000 + FRAME_SECONDS - time.monotonic()))
            frame = pcm[offset:offset + FRAME_BYTES]
            speech, _ = vad.classify(frame)
            utterance = segmenter.push(frame, speech, offset / 32000)
            if utterance:
                self.enqueue(self.source, utterance)
        tail = segmenter.flush()
        if tail:
            self.enqueue(self.source, tail)
        finished.set()


def emit(kind, **payload):
    if kind == 'status' and payload['status'] == 'listening':
        began[0] = time.monotonic()
        listening.set()
    if kind == 'status' and payload['status'] == 'idle':
        idle.set()
    if kind == 'caption':
        event = {'received_seconds': round(time.monotonic() - began[0], 3), **payload}
        events.append(event)
        print(json.dumps(event, ensure_ascii=False), flush=True)
    if kind in ('error', 'warning'):
        print(json.dumps({'type': kind, **payload}, ensure_ascii=False), flush=True)


engine = Engine(emit)

def run():
    engine.start(Settings(source='system', mode='translate', language='en', model=args.model))
    assert listening.wait(30), 'Engine did not enter listening state'
    if args.loopback:
        import winsound
        winsound.PlaySound(str(args.wav.resolve()), winsound.SND_FILENAME)
        time.sleep(1)
    else:
        assert finished.wait(len(samples) / 16000 + 5), 'Fixture timed out'
    engine.stop()
    assert idle.wait(25), 'Engine did not drain its final captions'

try:
    if args.loopback:
        run()
    else:
        with patch('ktalk.engine.Capture', FixtureCapture):
            run()
finally:
    engine.stop()
assert events, 'No captions were produced'
assert any(not event['final'] for event in events), 'No progressive captions were produced'
assert all(event['target_language'] == 'pt-BR' for event in events)
assert any('bom dia' in event['text'].casefold() for event in events), 'Expected Portuguese translation was missing'
summary = {'model': args.model, 'loopback': args.loopback, 'audio_seconds': round(len(samples) / 16000, 2),
           'first_caption_seconds': events[0]['received_seconds'],
           'median_processing_and_queue_ms': float(np.median([event['latency_ms'] for event in events])),
           'updates': len(events), 'finals': sum(event['final'] for event in events)}
report = ROOT / 'artifacts' / f'benchmark-{args.model}{"-loopback" if args.loopback else ""}.json'
report.write_text(json.dumps({'summary': summary, 'events': events}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary), flush=True)
