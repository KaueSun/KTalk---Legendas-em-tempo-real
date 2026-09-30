"""Session lifecycle and a bounded speech recognition worker."""
from datetime import datetime, timezone
import os
from pathlib import Path
import queue
import threading
import time
import uuid

import numpy as np

from .audio import Capture
from .models import load_model
from .transcription import Transcriber
from .translation import LocalTranslator, prepare_translation
from .work_queue import LatestQueue


class Engine:
    def __init__(self, emit):
        self.emit = emit
        self.thread = None
        self.stop_event = threading.Event()
        self.model = None
        self.model_name = None
        self.lifecycle_lock = threading.Lock()
        self.translator = None

    @property
    def active(self):
        thread = self.thread
        return thread is not None and thread.is_alive()

    def start(self, settings, monitor_only=False):
        with self.lifecycle_lock:
            if self.active:
                raise ValueError("Uma sessão já está em andamento.")
            self.stop_event = threading.Event()
            self.thread = threading.Thread(target=self._run, args=(settings, monitor_only), name="recognition", daemon=True)
            self.thread.start()

    def stop(self):
        if self.active:
            self.emit("status", status="stopping", message="Finalizando os trechos pendentes…")
            self.stop_event.set()

    def _run(self, settings, monitor_only=False):
        captures = []
        segments = LatestQueue(limit=6)
        gate = threading.Event()
        started = [0.0]
        session_id = str(uuid.uuid4())
        last_overload = [0.0]
        last_results = {}

        def enqueue(source, utterance):
            if monitor_only:
                return
            evicted = segments.put(source, utterance)
            if evicted:
                self.emit('caption-retracted', id=f'{session_id}:{evicted[0]}:{evicted[1].id}')
                now = time.monotonic()
                if now - last_overload[0] > 5:
                    self.emit("warning", message="O reconhecimento ficou para trás e descartou um trecho. Experimente o modelo Tiny.")
                    last_overload[0] = now

        try:
            self.emit("status", status="preparing", message="Abrindo os dispositivos…" if monitor_only else "Preparando reconhecimento e tradução locais…")
            cache = Path(os.environ.get("KTALK_MODEL_DIR", Path.home() / ".cache" / "ktalk"))
            if not monitor_only and (self.model is None or settings.model != self.model_name):
                # Release the old model before loading a larger one.
                self.model = None
                self.model = load_model(settings.model, cache)
                self.model_name = settings.model
            if not monitor_only and settings.mode == 'translate' and self.translator is None and not self.stop_event.is_set():
                directory = prepare_translation(cache,
                    progress=lambda message: self.emit('status', status='preparing', message=message),
                    cancelled=self.stop_event.is_set)
                self.translator = LocalTranslator(directory)
            transcriber = Transcriber(self.model, 'en' if settings.mode == 'translate' else settings.language)
            if self.stop_event.is_set():
                return
            sources = ["system", "microphone"] if settings.source == "both" else [settings.source]
            for source in sources:
                capture = Capture(source, getattr(settings, source), settings, self.stop_event,
                                  gate, started, enqueue, self.emit)
                captures.append(capture)
                capture.start()
            for capture in captures:
                if not capture.ready.wait(15):
                    raise RuntimeError("O dispositivo demorou para responder. Verifique as configurações de áudio do Windows.")
                if capture.error:
                    return
            if self.stop_event.is_set():
                return
            started[0] = time.monotonic()
            if not monitor_only:
                self.emit("session", id=session_id, started_at=datetime.now(timezone.utc).isoformat(), source=settings.source)
            self.emit("status", status="monitoring" if monitor_only else "listening",
                      message="Teste de áudio ativo. Fale ou reproduza um som." if monitor_only else "Tradução ao vivo · inglês → PT-BR" if settings.mode == 'translate' else "Transcrição progressiva ativa")
            gate.set()
            while not self.stop_event.is_set() or any(capture.is_alive() for capture in captures) or not segments.empty():
                try:
                    source, utterance = segments.get(timeout=0.1)
                except queue.Empty:
                    continue
                audio = np.frombuffer(utterance.pcm, dtype="<i2").astype(np.float32) / 32768.0
                before = time.monotonic()
                results, info = transcriber.transcribe(source, audio)
                caption_id = f'{session_id}:{source}:{utterance.id}'
                original = ' '.join(result.text.strip() for result in results)
                if not original:
                    if utterance.final:
                        self.emit('caption-retracted', id=caption_id)
                        last_results.pop(caption_id, None)
                    continue
                previous = last_results.get(caption_id)
                if previous and previous['original_text'] == original and not utterance.final:
                    continue
                recognized = time.monotonic()
                text = self.translator.translate(original, utterance.final) if settings.mode == 'translate' else original
                translated = time.monotonic()
                caption = dict(id=caption_id, session_id=session_id, source=source,
                    text=text, original_text=original, language=info.language,
                    target_language='pt-BR' if settings.mode == 'translate' else info.language,
                    start=round(utterance.start, 3), end=round(utterance.end, 3),
                    final=utterance.final, revision=utterance.revision,
                    created_at=datetime.now(timezone.utc).isoformat(),
                    processing_ms=round((recognized - before) * 1000), translation_ms=round((translated - recognized) * 1000),
                    latency_ms=max(0, round((translated - started[0] - utterance.end) * 1000)))
                self.emit('caption', **caption)
                if utterance.final:
                    last_results.pop(caption_id, None)
                else:
                    last_results[caption_id] = caption
                    if len(last_results) > 12:
                        last_results.pop(next(iter(last_results)))
        except InterruptedError:
            pass
        except Exception as error:
            self.emit("error", message=f"Não foi possível legendar: {error}")
        finally:
            self.stop_event.set()
            gate.set()
            for capture in captures:
                capture.join(timeout=3)
            # Publish idle only after a new start can be accepted.
            with self.lifecycle_lock:
                self.thread = None
                self.emit("status", status="idle", message="Pronto para uma nova sessão")
