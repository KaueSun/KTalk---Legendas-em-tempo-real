"""Replace pending revisions of the same phrase instead of building a backlog."""
from collections import OrderedDict
from queue import Empty
import threading
import time


class LatestQueue:
    def __init__(self, limit=6):
        self.items = OrderedDict()
        self.condition = threading.Condition()
        self.limit = limit

    def put(self, source, utterance):
        key = (source, utterance.id)
        with self.condition:
            previous = self.items.get(key)
            if previous and previous[1].revision >= utterance.revision:
                return None
            self.items[key] = (source, utterance)
            evicted = self.items.popitem(last=False)[1] if len(self.items) > self.limit else None
            self.condition.notify()
            return evicted

    def get(self, timeout=0.1):
        deadline = time.monotonic() + timeout
        with self.condition:
            while not self.items:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Empty
                self.condition.wait(remaining)
            return self.items.popitem(last=False)[1]

    def empty(self):
        with self.condition:
            return not self.items
