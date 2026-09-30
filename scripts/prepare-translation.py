import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
from ktalk.translation import LocalTranslator, prepare_translation

directory = prepare_translation(ROOT / '.runtime/data/models', progress=lambda text: print(text, flush=True))
translator = LocalTranslator(directory)
for text in ('Good morning everyone.', "Let's push through the left side.", 'This application creates live captions on your computer.'):
    start = time.perf_counter()
    translated = translator.translate(text)
    print(f'{text} -> {translated} ({(time.perf_counter() - start) * 1000:.0f} ms)', flush=True)
