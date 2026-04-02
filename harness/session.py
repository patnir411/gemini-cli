"""JSONL session persistence — save and resume conversations.

Format (one JSON object per line):
  {"type": "meta", "session_id": "...", "timestamp": "...", "model": "...", "cwd": "..."}
  {"type": "summary", "text": "..."}     # from last compaction
  {"type": "message", "role": "...", "parts": [...]}
  {"type": "cache", "seen": {...}}        # file cache state (optional)
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _sessions_dir() -> Path:
    d = Path.home() / ".harness" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


class SessionManager:
    """JSONL session save/load/resume."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.path = _sessions_dir() / f"{session_id}.jsonl"
        self._last_save_len = 0

    async def save(
        self,
        messages: list[dict],
        summary: str | None = None,
        cache_state: dict | None = None,
    ) -> None:
        """Save the full session state to JSONL. Overwrites previous save."""
        lines: list[str] = []

        # Meta
        lines.append(json.dumps({
            "type": "meta",
            "session_id": self.session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
            "cwd": os.getcwd(),
        }, separators=(",", ":")))

        # Summary
        if summary:
            lines.append(json.dumps({
                "type": "summary",
                "text": summary,
            }, separators=(",", ":")))

        # Messages
        for msg in messages:
            lines.append(json.dumps({
                "type": "message",
                "role": msg.get("role", "user"),
                "parts": msg.get("parts", []),
            }, separators=(",", ":")))

        # Cache state
        if cache_state:
            lines.append(json.dumps({
                "type": "cache",
                "seen": cache_state,
            }, separators=(",", ":")))

        # Atomic write via temp file
        tmp_path = self.path.with_suffix(".tmp")
        tmp_path.write_text("\n".join(lines) + "\n")
        tmp_path.rename(self.path)
        self._last_save_len = len(messages)

    def load(self) -> dict[str, Any] | None:
        """Load a session from JSONL. Returns None if not found."""
        if not self.path.exists():
            return None

        meta = None
        summary = None
        messages: list[dict] = []
        cache_state = None

        try:
            for line in self.path.read_text().strip().split("\n"):
                if not line:
                    continue
                record = json.loads(line)
                rtype = record.get("type")
                if rtype == "meta":
                    meta = record
                elif rtype == "summary":
                    summary = record.get("text")
                elif rtype == "message":
                    messages.append({
                        "role": record["role"],
                        "parts": record["parts"],
                    })
                elif rtype == "cache":
                    cache_state = record.get("seen")
        except (json.JSONDecodeError, OSError, KeyError) as e:
            return None

        return {
            "meta": meta,
            "summary": summary,
            "messages": messages,
            "cache": cache_state,
        }

    @staticmethod
    def list_sessions() -> list[dict]:
        """List all saved sessions with metadata."""
        sessions = []
        for p in sorted(_sessions_dir().glob("*.jsonl"), key=lambda f: f.stat().st_mtime, reverse=True):
            try:
                first_line = p.read_text().split("\n", 1)[0]
                meta = json.loads(first_line)
                if meta.get("type") == "meta":
                    meta["file"] = str(p)
                    meta["size"] = p.stat().st_size
                    sessions.append(meta)
            except Exception:
                sessions.append({"session_id": p.stem, "file": str(p)})
        return sessions

    @staticmethod
    def find_session(session_id: str) -> SessionManager | None:
        """Find a session by ID (prefix match)."""
        for p in _sessions_dir().glob("*.jsonl"):
            if p.stem.startswith(session_id):
                return SessionManager(p.stem)
        return None
