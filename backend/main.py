"""Electron spawns this process with stdin/stdout pipes, never a network server."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from ktalk.protocol import EventWriter, Settings  # noqa: E402


def main():
    emit = EventWriter(sys.stdout)
    try:
        from ktalk.audio import list_devices
        from ktalk.engine import Engine
    except ImportError as error:
        emit("error", message=f"Dependências Python ausentes. Execute node scripts/setup-python.mjs. Detalhe: {error}")
        return 1
    engine = Engine(emit)
    emit("ready", version="0.3.1")
    for line in sys.stdin:
        try:
            if len(line) > 16384:
                raise ValueError("Comando excede o limite.")
            command = json.loads(line)
            if not isinstance(command, dict):
                raise ValueError("Comando inválido.")
            action = command.get("type")
            if action == "devices":
                if engine.active:
                    raise ValueError("Pare a sessão antes de atualizar os dispositivos.")
                emit("devices", devices=list_devices())
            elif action in ('start', 'monitor'):
                engine.start(Settings.parse(command.get("settings", {})), monitor_only=action == 'monitor')
            elif action == "stop":
                engine.stop()
            elif action == "shutdown":
                break
            else:
                raise ValueError("Comando desconhecido.")
        except Exception as error:
            emit("error", message=str(error))
    engine.stop()
    thread = engine.thread
    if thread:
        thread.join(timeout=20)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
