"""Open both default WASAPI streams without starting them or reading any audio."""
import json
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from ktalk.audio import Capture, list_devices
from ktalk.protocol import Settings

stop = threading.Event()
gate = threading.Event()
events = []
captures = [Capture(source, None, Settings(), stop, gate, [time.monotonic()],
                    lambda *_: None, lambda kind, **data: events.append({'type': kind, **data}))
            for source in ('system', 'microphone')]
try:
    for capture in captures:
        capture.start()
    for capture in captures:
        assert capture.ready.wait(15), f'{capture.source}: timeout'
        assert capture.error is None, f'{capture.source}: {capture.error}'
finally:
    stop.set()
    gate.set()
    for capture in captures:
        capture.join(3)
    assert not any(capture.is_alive() for capture in captures), 'Audio resources did not close'
print(json.dumps({'result': 'WASAPI microphone and loopback streams opened and closed without capturing audio',
                  'devices': list_devices()}, ensure_ascii=False))
