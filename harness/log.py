"""Structured JSONL logging for observability.

Every significant event is logged as a single JSON line to a session-specific
log file. Logs are append-only, never read during normal operation, and trivial
to search with jq/grep after the fact.

Design:
- One log file per session: ~/.harness/logs/{session_id}.jsonl
- Each line is self-contained JSON with timestamp, level, event type, and payload
- No impact on engine performance (async file writes, fire-and-forget)
- Separate from session.py (conversation state) — this is the flight recorder
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class HarnessLogger:
    """Append-only JSONL logger. One instance per session."""

    def __init__(self, session_id: str, log_dir: str | None = None):
        self.session_id = session_id
        base = Path(log_dir) if log_dir else Path.home() / ".harness" / "logs"
        base.mkdir(parents=True, exist_ok=True)
        self.path = base / f"{session_id}.jsonl"
        self._file = open(self.path, "a", buffering=1)  # line-buffered
        self._start = time.monotonic()

    # ── Core write ───────────────────────────────────────────────────────

    def _write(self, level: str, event: str, **payload: Any) -> None:
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "elapsed": round(time.monotonic() - self._start, 3),
            "level": level,
            "event": event,
        }
        if payload:
            record["data"] = payload
        try:
            self._file.write(json.dumps(record, separators=(",", ":")) + "\n")
        except Exception:
            pass  # never crash the engine for logging

    # ── Public API ───────────────────────────────────────────────────────

    def debug(self, event: str, **kw: Any) -> None:
        if os.environ.get("HARNESS_DEBUG"):
            self._write("DEBUG", event, **kw)

    def info(self, event: str, **kw: Any) -> None:
        self._write("INFO", event, **kw)

    def warn(self, event: str, **kw: Any) -> None:
        self._write("WARN", event, **kw)

    def error(self, event: str, **kw: Any) -> None:
        self._write("ERROR", event, **kw)

    # ── Convenience methods for common events ────────────────────────────

    def api_request(self, model: str, token_estimate: int, turn: int) -> None:
        self.info("api_request", model=model, tokens=token_estimate, turn=turn)

    def api_response(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        duration_ms: int,
        cached_tokens: int = 0,
    ) -> None:
        self.info(
            "api_response",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            duration_ms=duration_ms,
        )

    def api_error(self, error: str, status: int | None = None, attempt: int = 1) -> None:
        self.warn("api_error", error=error, status=status, attempt=attempt)

    def tool_start(self, name: str, call_id: str, args_summary: str = "") -> None:
        self.info("tool_start", tool=name, call_id=call_id, args=args_summary)

    def tool_done(
        self, name: str, call_id: str, duration_ms: int, content_len: int, is_error: bool = False
    ) -> None:
        self.info(
            "tool_done",
            tool=name,
            call_id=call_id,
            duration_ms=duration_ms,
            content_len=content_len,
            is_error=is_error,
        )

    def compact(self, layer: str, old_tokens: int, new_tokens: int) -> None:
        self.info(
            "compact",
            layer=layer,
            old_tokens=old_tokens,
            new_tokens=new_tokens,
            saved=old_tokens - new_tokens,
        )

    def mcp_connect(self, server: str, tools: list[str]) -> None:
        self.info("mcp_connect", server=server, tool_count=len(tools), tools=tools)

    def mcp_error(self, server: str, error: str) -> None:
        self.warn("mcp_error", server=server, error=error)

    def session_start(self, model: str, cwd: str, tools: list[str]) -> None:
        self.info(
            "session_start",
            session_id=self.session_id,
            model=model,
            cwd=cwd,
            tool_count=len(tools),
        )

    def session_end(self, turns: int, total_tokens: int) -> None:
        self.info("session_end", turns=turns, total_tokens=total_tokens)

    def cache_hit(self, path: str) -> None:
        self.debug("cache_hit", path=path)

    def cache_miss(self, path: str) -> None:
        self.debug("cache_miss", path=path)

    # ── Lifecycle ────────────────────────────────────────────────────────

    def close(self) -> None:
        try:
            self._file.close()
        except Exception:
            pass
