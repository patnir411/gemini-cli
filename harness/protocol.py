"""JSON IPC protocol between TUI and engine processes."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any


# ── TUI -> Engine (commands) ─────────────────────────────────────────────────


@dataclass
class UserMessage:
    content: str
    type: str = "user_message"


@dataclass
class Cancel:
    type: str = "cancel"


@dataclass
class SlashCommand:
    command: str
    args: list[str] = field(default_factory=list)
    type: str = "slash_command"


# ── Engine -> TUI (events) ───────────────────────────────────────────────────


@dataclass
class TokenDelta:
    text: str
    type: str = "token_delta"


@dataclass
class ThinkingDelta:
    text: str
    type: str = "thinking_delta"


@dataclass
class ToolStart:
    name: str
    call_id: str
    args: dict[str, Any] = field(default_factory=dict)
    type: str = "tool_start"


@dataclass
class ToolResult:
    name: str
    call_id: str
    content: str
    truncated: bool = False
    is_error: bool = False
    type: str = "tool_result"


@dataclass
class TurnComplete:
    tokens: int = 0
    cost: float = 0.0
    type: str = "turn_complete"


@dataclass
class CompactDone:
    old_tokens: int = 0
    new_tokens: int = 0
    layer: str = ""  # "micro", "auto", "emergency"
    type: str = "compact_done"


@dataclass
class EngineError:
    message: str
    recoverable: bool = True
    type: str = "error"


@dataclass
class EngineReady:
    model: str = ""
    tools: list[str] = field(default_factory=list)
    type: str = "ready"


@dataclass
class SessionLoaded:
    session_id: str = ""
    turns: int = 0
    type: str = "session_loaded"


# ── Serialization ────────────────────────────────────────────────────────────

COMMAND_TYPES: dict[str, type] = {
    "user_message": UserMessage,
    "cancel": Cancel,
    "slash_command": SlashCommand,
}

EVENT_TYPES: dict[str, type] = {
    "token_delta": TokenDelta,
    "thinking_delta": ThinkingDelta,
    "tool_start": ToolStart,
    "tool_result": ToolResult,
    "turn_complete": TurnComplete,
    "compact_done": CompactDone,
    "error": EngineError,
    "ready": EngineReady,
    "session_loaded": SessionLoaded,
}

Command = UserMessage | Cancel | SlashCommand
Event = (
    TokenDelta
    | ThinkingDelta
    | ToolStart
    | ToolResult
    | TurnComplete
    | CompactDone
    | EngineError
    | EngineReady
    | SessionLoaded
)


def serialize(obj: Command | Event) -> str:
    """Serialize a protocol message to a single JSON line."""
    return json.dumps(asdict(obj), separators=(",", ":"))


def deserialize_command(line: str) -> Command:
    """Deserialize a JSON line into a command."""
    data = json.loads(line)
    cls = COMMAND_TYPES.get(data.get("type", ""))
    if cls is None:
        raise ValueError(f"Unknown command type: {data.get('type')}")
    data.pop("type", None)
    return cls(**data)


def deserialize_event(line: str) -> Event:
    """Deserialize a JSON line into an event."""
    data = json.loads(line)
    cls = EVENT_TYPES.get(data.get("type", ""))
    if cls is None:
        raise ValueError(f"Unknown event type: {data.get('type')}")
    data.pop("type", None)
    return cls(**data)
