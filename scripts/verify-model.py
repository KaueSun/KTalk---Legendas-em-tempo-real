"""Explicit integration check with a supplied WAV, never a live microphone."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("HF_HOME", str(ROOT / ".runtime/data/huggingface"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from faster_whisper.audio import decode_audio
import numpy as np
from ktalk.dsp import VoiceDetector
from ktalk.segmentation import FRAME_BYTES, SpeechSegmenter
from ktalk.models import load_model
from ktalk.transcription import Transcriber

parser = argparse.ArgumentParser()
parser.add_argument("wav", type=Path)
parser.add_argument("--model", choices=["tiny", "base", "small"], default="tiny")
parser.add_argument("--language", default="en")
parser.add_argument("--expect", default="")
args = parser.parse_args()
audio = decode_audio(str(args.wav), sampling_rate=16000)
pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes() + bytes(FRAME_BYTES * 18)
vad = VoiceDetector(1)
segmenter = SpeechSegmenter(partials=False)
utterances = []
for offset in range(0, len(pcm) - FRAME_BYTES + 1, FRAME_BYTES):
    frame = pcm[offset:offset + FRAME_BYTES]
    speech, _ = vad.classify(frame)
    utterance = segmenter.push(frame, speech, offset / 32000)
    if utterance:
        utterances.append(utterance)
tail = segmenter.flush()
if tail:
    utterances.append(tail)
assert utterances, "VAD did not detect speech in the fixture"
model = load_model(args.model, ROOT / '.runtime/data/models')
transcriber = Transcriber(model, args.language)
texts = []
before = time.monotonic()
for utterance in utterances:
    samples = np.frombuffer(utterance.pcm, dtype="<i2").astype(np.float32) / 32768
    results, info = transcriber.transcribe('system', samples)
    texts.extend(segment.text.strip() for segment in results)
text = " ".join(texts)
assert text, "Recognition returned no text"
if args.expect:
    assert args.expect.casefold() in text.casefold(), text
print(json.dumps({"text": text, "language": info.language, "vad_chunks": len(utterances),
                  "inference_seconds": round(time.monotonic() - before, 2)}, ensure_ascii=False))
