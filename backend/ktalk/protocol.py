"""Small, validated JSON-lines protocol. stdout is reserved for events."""
from dataclasses import dataclass
import json
import threading

SOURCES = {"system", "microphone", "both"}
LANGUAGES = {"auto", "pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh"}
MODELS = {"tiny", "base", "small"}


@dataclass(frozen=True)
class Settings:
    source: str = "system"
    language: str = "en"
    model: str = "tiny"
    mode: str = 'translate'
    microphone: int | None = None
    system: int | None = None
    vad_mode: int = 1
    max_seconds: float = 7.2
    partial_interval: float = 0.6
    mic_gain: float = 1.0

    @classmethod
    def parse(cls, data: dict) -> "Settings":
        if not isinstance(data, dict):
            raise ValueError("Configuração inválida.")
        values = {key: data[key] for key in cls.__dataclass_fields__ if key in data}
        settings = cls(**values)
        if settings.source not in SOURCES or settings.language not in LANGUAGES or settings.model not in MODELS:
            raise ValueError("Fonte, idioma ou modelo inválido.")
        for index in (settings.microphone, settings.system):
            if index is not None and (type(index) is not int or not 0 <= index <= 10000):
                raise ValueError("Dispositivo de áudio inválido.")
        if type(settings.vad_mode) is not int or settings.vad_mode not in range(4):
            raise ValueError("Sensibilidade de voz inválida.")
        if settings.mode not in ('translate', 'caption'):
            raise ValueError('Modo inválido.')
        if type(settings.max_seconds) not in (int, float) or settings.max_seconds not in (2.4, 4.8, 7.2):
            raise ValueError("Tamanho do trecho inválido.")
        if type(settings.partial_interval) not in (int, float) or settings.partial_interval not in (0.6, 0.9, 1.2):
            raise ValueError('Intervalo inválido.')
        if type(settings.mic_gain) not in (int, float) or settings.mic_gain not in (1, 1.5, 2, 3, 4):
            raise ValueError('Ganho inválido.')
        return settings


class EventWriter:
    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()

    def __call__(self, event_type: str, **payload):
        with self.lock:
            self.stream.write(json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n")
            self.stream.flush()
