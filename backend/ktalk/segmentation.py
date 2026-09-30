"""VAD segmentation independent of hardware/model, with bounded memory."""
from collections import deque
from dataclasses import dataclass
import uuid

FRAME_SECONDS = 0.03
FRAME_BYTES = 960  # 16 kHz, mono, signed 16-bit, 30 ms.


@dataclass(frozen=True)
class Utterance:
    pcm: bytes
    start: float
    end: float
    id: str = ''
    revision: int = 1
    final: bool = True


class SpeechSegmenter:
    def __init__(self, max_seconds: float = 7.2, partial_interval: float = 0.6, partials: bool = True):
        self.max_frames = round(max_seconds / FRAME_SECONDS)
        self.pre_roll = deque(maxlen=10)
        self.frames: list[bytes] = []
        self.start = 0.0
        self.end = 0.0
        self.silent_frames = 0
        self.voiced_frames = 0
        self.partial_frames = max(15, round(partial_interval / FRAME_SECONDS))
        self.partials = partials
        self.last_partial = 0
        self.id = ''

    def push(self, pcm: bytes, speech: bool, timestamp: float) -> Utterance | None:
        if len(pcm) != FRAME_BYTES:
            raise ValueError("VAD requires exactly 30 ms of PCM16 at 16 kHz.")
        if not self.frames:
            self.pre_roll.append((pcm, speech, timestamp))
            if sum(frame[1] for frame in self.pre_roll) < 3:
                return None
            self.start = self.pre_roll[0][2]
            self.frames = [frame[0] for frame in self.pre_roll]
            self.voiced_frames = sum(frame[1] for frame in self.pre_roll)
            self.pre_roll.clear()
            self.id = uuid.uuid4().hex
        else:
            self.frames.append(pcm)
            self.voiced_frames += int(speech)
        self.end = timestamp + FRAME_SECONDS
        self.silent_frames = 0 if speech else self.silent_frames + 1
        if self.silent_frames >= 10 or len(self.frames) >= self.max_frames:
            return self.flush()
        if self.partials and speech and self.voiced_frames >= 10 and len(self.frames) - self.last_partial >= self.partial_frames:
            self.last_partial = len(self.frames)
            return Utterance(b''.join(self.frames), self.start, self.end, self.id, len(self.frames), False)
        return None

    def flush(self) -> Utterance | None:
        result = None
        if self.frames and self.voiced_frames >= 6:
            result = Utterance(b"".join(self.frames), self.start, self.end, self.id, len(self.frames) + 1, True)
        self.frames = []
        self.pre_roll.clear()
        self.silent_frames = self.voiced_frames = 0
        self.last_partial = 0
        self.id = ''
        return result
