"""Textual TUI frontend — two-process architecture.

Launches the engine as a subprocess, communicates via JSON over stdin/stdout.
TUI never blocks on inference. Handles streaming display, tool status, and
slash commands.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical, Horizontal
from textual.css.query import NoMatches
from textual.message import Message
from textual.reactive import reactive
from textual.widgets import (
    Footer,
    Header,
    Input,
    RichLog,
    Static,
)

from protocol import serialize, deserialize_event, UserMessage, Cancel, SlashCommand


# ── Custom messages ──────────────────────────────────────────────────────────


class EngineEvent(Message):
    """Wraps a deserialized engine event for the message bus."""
    def __init__(self, data: dict) -> None:
        super().__init__()
        self.data = data


# ── Status bar widget ────────────────────────────────────────────────────────


class StatusBar(Static):
    """Bottom status bar showing model, tokens, cost."""

    model: reactive[str] = reactive("")
    tokens: reactive[int] = reactive(0)
    cost: reactive[float] = reactive(0.0)
    status: reactive[str] = reactive("ready")

    def render(self) -> str:
        parts = []
        if self.model:
            parts.append(f"model: {self.model}")
        if self.tokens:
            parts.append(f"tokens: {self.tokens:,}")
        if self.cost > 0:
            parts.append(f"cost: ${self.cost:.4f}")
        parts.append(self.status)
        return " | ".join(parts)


# ── Main App ─────────────────────────────────────────────────────────────────


class HarnessApp(App):
    """Textual TUI for the Gemini harness."""

    CSS = """
    #output {
        height: 1fr;
        scrollbar-size: 1 1;
    }
    #status-bar {
        dock: bottom;
        height: 1;
        background: $surface;
        color: $text-muted;
        padding: 0 1;
    }
    #input {
        dock: bottom;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "cancel", "Cancel", show=True),
        Binding("ctrl+d", "quit", "Quit", show=True),
    ]

    def __init__(self, engine_args: list[str] | None = None, **kwargs: Any):
        super().__init__(**kwargs)
        self._engine_proc: asyncio.subprocess.Process | None = None
        self._engine_args = engine_args or []
        self._streaming = False
        self._current_text = ""
        self._total_tokens = 0
        self._total_cost = 0.0

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield RichLog(id="output", highlight=True, markup=True, wrap=True)
        yield StatusBar(id="status-bar")
        yield Input(id="input", placeholder="Type a message or /command...")
        yield Footer()

    async def on_mount(self) -> None:
        """Start the engine subprocess."""
        self.query_one("#input", Input).focus()
        await self._start_engine()

    async def _start_engine(self) -> None:
        """Launch engine.py as a subprocess."""
        engine_path = Path(__file__).parent / "engine.py"

        env = dict(os.environ)
        # Pass through session ID
        if "HARNESS_SESSION_ID" not in env:
            import uuid
            env["HARNESS_SESSION_ID"] = str(uuid.uuid4())[:8]

        cmd = [sys.executable, str(engine_path)] + self._engine_args

        self._engine_proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        # Start reading engine output
        self._read_engine_output()

    @work(exclusive=True, group="engine-reader")
    async def _read_engine_output(self) -> None:
        """Background worker reading JSON lines from engine stdout."""
        if not self._engine_proc or not self._engine_proc.stdout:
            return

        while True:
            try:
                line = await self._engine_proc.stdout.readline()
                if not line:
                    break
                line_str = line.decode().strip()
                if not line_str:
                    continue
                try:
                    data = json.loads(line_str)
                    self.post_message(EngineEvent(data))
                except json.JSONDecodeError:
                    pass
            except Exception:
                break

        # Engine exited
        self._update_status("engine stopped")

    def _send_to_engine(self, msg: dict) -> None:
        """Send a JSON command to the engine subprocess."""
        if self._engine_proc and self._engine_proc.stdin:
            line = json.dumps(msg, separators=(",", ":")) + "\n"
            self._engine_proc.stdin.write(line.encode())

    def _output(self) -> RichLog:
        return self.query_one("#output", RichLog)

    def _status_bar(self) -> StatusBar:
        return self.query_one("#status-bar", StatusBar)

    def _update_status(self, status: str) -> None:
        try:
            self._status_bar().status = status
        except NoMatches:
            pass

    # ── Event handlers ───────────────────────────────────────────────────

    @on(Input.Submitted, "#input")
    async def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        event.input.clear()

        # Handle slash commands locally
        if text.startswith("/"):
            await self._handle_slash_command(text)
            return

        # Show user message
        self._output().write(f"\n[bold cyan]> {text}[/]\n")
        self._streaming = True
        self._current_text = ""
        self._update_status("thinking...")

        self._send_to_engine({"type": "user_message", "content": text})

    @on(EngineEvent)
    def on_engine_event(self, event: EngineEvent) -> None:
        data = event.data
        event_type = data.get("type", "")

        if event_type == "token_delta":
            text = data.get("text", "")
            self._current_text += text
            self._output().write(text, scroll_end=True)

        elif event_type == "thinking_delta":
            text = data.get("text", "")
            self._output().write(f"[dim]{text}[/]", scroll_end=True)

        elif event_type == "tool_start":
            name = data.get("name", "?")
            self._update_status(f"running: {name}")
            self._output().write(f"\n[yellow]>>> {name}[/]")

        elif event_type == "tool_result":
            name = data.get("name", "?")
            content = data.get("content", "")
            is_error = data.get("is_error", False)
            color = "red" if is_error else "green"
            self._output().write(f"[{color}]  <- {name}: {content}[/]")
            self._update_status("thinking...")

        elif event_type == "turn_complete":
            tokens = data.get("tokens", 0)
            cost = data.get("cost", 0.0)
            self._total_tokens += tokens
            self._total_cost += cost
            self._streaming = False

            sb = self._status_bar()
            sb.tokens = self._total_tokens
            sb.cost = self._total_cost
            sb.status = "ready"
            self._output().write("")  # blank line after response

        elif event_type == "compact_done":
            layer = data.get("layer", "?")
            old_t = data.get("old_tokens", 0)
            new_t = data.get("new_tokens", 0)
            saved = old_t - new_t
            self._output().write(
                f"\n[magenta]Compacted ({layer}): {old_t:,} -> {new_t:,} tokens (saved {saved:,})[/]\n"
            )

        elif event_type == "error":
            msg = data.get("message", "Unknown error")
            self._output().write(f"\n[bold red]Error: {msg}[/]\n")
            self._streaming = False
            self._update_status("error")

        elif event_type == "ready":
            model = data.get("model", "")
            tools = data.get("tools", [])
            self._status_bar().model = model
            self._update_status("ready")
            self._output().write(
                f"[dim]Engine ready: {model} | {len(tools)} tools[/]"
            )

        elif event_type == "session_loaded":
            sid = data.get("session_id", "")
            turns = data.get("turns", 0)
            self._output().write(f"[dim]Session resumed: {sid} ({turns} turns)[/]")

    # ── Slash commands ───────────────────────────────────────────────────

    async def _handle_slash_command(self, text: str) -> None:
        parts = text.strip().split(maxsplit=1)
        cmd = parts[0].lstrip("/").lower()
        args = parts[1] if len(parts) > 1 else ""

        if cmd == "quit" or cmd == "q":
            self.exit()
        elif cmd == "clear":
            self._output().clear()
        elif cmd == "compact":
            self._send_to_engine({"type": "slash_command", "command": "compact", "args": []})
            self._output().write("[magenta]Forcing compaction...[/]")
        elif cmd == "tokens":
            self._send_to_engine({"type": "slash_command", "command": "tokens", "args": []})
        elif cmd == "model":
            self._output().write(f"[dim]Model: {self._status_bar().model}[/]")
        elif cmd == "cost":
            self._output().write(
                f"[dim]Session: {self._total_tokens:,} tokens | ${self._total_cost:.4f}[/]"
            )
        elif cmd == "help":
            self._output().write(
                "[dim]/compact  — force compaction\n"
                "/tokens   — show context size\n"
                "/cost     — show session cost\n"
                "/model    — show current model\n"
                "/clear    — clear display\n"
                "/quit     — exit[/]"
            )
        else:
            self._send_to_engine({
                "type": "slash_command",
                "command": cmd,
                "args": args.split() if args else [],
            })

    # ── Actions ──────────────────────────────────────────────────────────

    def action_cancel(self) -> None:
        if self._streaming:
            self._send_to_engine({"type": "cancel"})
            self._streaming = False
            self._update_status("cancelled")
            self._output().write("\n[dim]Cancelled.[/]")

    async def action_quit(self) -> None:
        if self._engine_proc:
            self._engine_proc.terminate()
            try:
                await asyncio.wait_for(self._engine_proc.wait(), timeout=3)
            except asyncio.TimeoutError:
                self._engine_proc.kill()
        self.exit()


# ── Entry point ──────────────────────────────────────────────────────────────


def main() -> None:
    app = HarnessApp()
    app.run()


if __name__ == "__main__":
    main()
