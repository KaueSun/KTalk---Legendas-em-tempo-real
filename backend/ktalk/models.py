"""Prefer the fully cached model, without making network requests on every start."""
import os
from pathlib import Path


def load_model(name: str, cache: Path):
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    from huggingface_hub.errors import LocalEntryNotFoundError

    model_path = None
    try:
        candidate = Path(download_model(name, cache_dir=str(cache), local_files_only=True))
        if all((candidate / filename).is_file() for filename in ('model.bin', 'config.json', 'tokenizer.json')):
            model_path = candidate
    except LocalEntryNotFoundError:
        pass
    if model_path is None:
        model_path = Path(download_model(name, cache_dir=str(cache)))
    return WhisperModel(str(model_path), device='cpu', compute_type='int8', local_files_only=True,
                        cpu_threads=max(1, min(8, (os.cpu_count() or 4) // 2)))
