"""QueryEngine — async generator ReAct loop.

Reads JSON commands from stdin, writes JSON events to stdout. Can run
headless (piped) or as a subprocess behind the Textual TUI.

The loop:
  user message -> build prompt -> stream inference -> tool calls?
    yes -> parallel reads, serial writes -> append results ->
           microcompact -> autocompact check -> loop back
    no  -> emit turn_complete, wait for next command
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from typing import Any, AsyncGenerator

from context import ContextManager
from log import HarnessLogger
from protocol import (
    Cancel,
    CompactDone,
    EngineError,
    EngineReady,
    Event,
    SlashCommand,
    TokenDelta,
    ThinkingDelta,
    ToolResult,
    ToolStart,
    TurnComplete,
    UserMessage,
    deserialize_command,
    serialize,
)
from session import SessionManager
from tools import (
    TOOL_DECLARATIONS,
    FileCache,
    ToolResultData,
    execute_tools,
)
from vertex import (
    ContentDelta,
    FinishEvent,
    GeminiClient,
    StreamError,
    ThinkingDelta as VThinkingDelta,
    ToolCallEvent,
    estimate_messages_tokens,
)

MAX_TURNS = 25


class QueryEngine:
    """Generator-based ReAct loop driving the agent."""

    def __init__(
        self,
        client: GeminiClient,
        context: ContextManager,
        session: SessionManager,
        logger: HarnessLogger,
        mcp_handler=None,
    ):
        self.client = client
        self.context = context
        self.session = session
        self.logger = logger
        self.mcp_handler = mcp_handler
        self.file_cache = FileCache(logger=logger)
        self.messages: list[dict[str, Any]] = []
        self.turn_count = 0
        self._cancelled = False
        self._all_tool_declarations: list[dict] = list(TOOL_DECLARATIONS)

    def add_mcp_tools(self, declarations: list[dict]) -> None:
        """Register MCP tool declarations alongside built-ins."""
        self._all_tool_declarations.extend(declarations)

    def cancel(self) -> None:
        """Signal cancellation of the current turn."""
        self._cancelled = True

    async def run(self, user_input: str) -> AsyncGenerator[Event, None]:
        """Execute the agentic loop for a single user message.

        Yields protocol events (TokenDelta, ToolStart, ToolResult, etc.)
        for the TUI or headless consumer.
        """
        self._cancelled = False
        self.turn_count += 1

        # Append user message
        self.messages.append({"role": "user", "parts": [{"text": user_input}]})

        system_prompt = self.context.build_system_prompt()

        for step in range(MAX_TURNS):
            if self._cancelled:
                yield EngineError(message="Cancelled by user")
                return

            # ── 1. Compaction check ──────────────────────────────────────
            compact_result = await self.context.maybe_compact(
                self.messages, self.client, self.logger
            )
            if compact_result:
                yield CompactDone(
                    old_tokens=compact_result["old_tokens"],
                    new_tokens=compact_result["new_tokens"],
                    layer=compact_result["layer"],
                )

            # ── 2. Log API request ───────────────────────────────────────
            token_est = estimate_messages_tokens(self.messages)
            self.logger.api_request(self.client.model, token_est, self.turn_count)

            # ── 3. Stream from model ─────────────────────────────────────
            tool_calls: list[dict] = []
            model_text_parts: list[dict] = []
            model_thought_parts: list[dict] = []
            finish_info: FinishEvent | None = None
            got_413 = False

            async for event in self.client.stream(
                self.messages, self._all_tool_declarations, system_prompt
            ):
                if self._cancelled:
                    yield EngineError(message="Cancelled by user")
                    return

                if isinstance(event, ContentDelta):
                    yield TokenDelta(text=event.text)
                    model_text_parts.append({"text": event.text})

                elif isinstance(event, VThinkingDelta):
                    yield ThinkingDelta(text=event.text)
                    model_thought_parts.append({"thought": event.text})

                elif isinstance(event, ToolCallEvent):
                    tc = {"name": event.name, "call_id": event.call_id, "args": event.args}
                    tool_calls.append(tc)
                    yield ToolStart(name=event.name, call_id=event.call_id, args=event.args)

                elif isinstance(event, FinishEvent):
                    finish_info = event

                elif isinstance(event, StreamError):
                    if event.is_413:
                        got_413 = True
                        break
                    yield EngineError(message=event.message, recoverable=False)
                    return

            # ── Handle 413: emergency compact and retry ──────────────────
            if got_413:
                emergency = await self.context.emergency_compact(
                    self.messages, self.client, self.logger
                )
                if emergency:
                    yield CompactDone(
                        old_tokens=emergency["old_tokens"],
                        new_tokens=emergency["new_tokens"],
                        layer="emergency",
                    )
                    continue  # retry the turn
                else:
                    yield EngineError(
                        message="Context too large and emergency compact failed",
                        recoverable=False,
                    )
                    return

            # ── 4. Append model response to history ──────────────────────
            model_parts: list[dict] = []
            model_parts.extend(model_thought_parts)
            model_parts.extend(model_text_parts)
            for tc in tool_calls:
                model_parts.append({
                    "function_call": {
                        "name": tc["name"],
                        "id": tc["call_id"],
                        "args": tc["args"],
                    }
                })

            if model_parts:
                self.messages.append({"role": "model", "parts": model_parts})

            # ── 5. No tool calls = turn complete ─────────────────────────
            if not tool_calls:
                input_tokens = finish_info.input_tokens if finish_info else 0
                output_tokens = finish_info.output_tokens if finish_info else 0
                # Rough cost estimate (Gemini Flash pricing)
                cost = (input_tokens * 0.075 + output_tokens * 0.30) / 1_000_000
                yield TurnComplete(tokens=input_tokens + output_tokens, cost=cost)

                # Save session
                await self.session.save(self.messages, self.context.last_summary)
                return

            # ── 6. Execute tools ─────────────────────────────────────────
            results = await execute_tools(
                tool_calls,
                self.file_cache,
                self.turn_count,
                self.logger,
                self.mcp_handler,
            )

            # Emit results to TUI
            for r in results:
                yield ToolResult(
                    name=r.name,
                    call_id=r.call_id,
                    content=r.summary,
                    truncated=len(r.output) > 50_000,
                    is_error=r.is_error,
                )

            # Append tool results to history
            self.messages.append({
                "role": "user",
                "parts": [r.to_part() for r in results],
            })

            # ── 7. Microcompact old tool results ─────────────────────────
            self.context.microcompact(self.messages, self.turn_count)

            # Save session after each tool round
            await self.session.save(self.messages, self.context.last_summary)

        # Exhausted max turns
        yield EngineError(message=f"Reached max turns ({MAX_TURNS})", recoverable=True)


# ── Headless stdin/stdout driver ─────────────────────────────────────────────


async def run_headless() -> None:
    """Run the engine reading JSON commands from stdin, writing events to stdout."""
    session_id = os.environ.get("HARNESS_SESSION_ID", str(uuid.uuid4())[:8])
    logger = HarnessLogger(session_id)

    try:
        client = GeminiClient(logger=logger)
    except ValueError as e:
        print(serialize(EngineError(message=str(e), recoverable=False)), flush=True)
        return

    context = ContextManager()
    session = SessionManager(session_id)
    engine = QueryEngine(client, context, session, logger)

    # Try MCP setup
    try:
        from mcp_client import MCPManager

        mcp = MCPManager(logger=logger)
        await mcp.start()
        engine.add_mcp_tools(mcp.get_tool_declarations())
        engine.mcp_handler = mcp.call_tool
    except (ImportError, Exception) as e:
        logger.warn("mcp_init_failed", error=str(e))

    tool_names = [d["name"] for d in engine._all_tool_declarations]
    logger.session_start(client.model, os.getcwd(), tool_names)
    print(serialize(EngineReady(model=client.model, tools=tool_names)), flush=True)

    # Read commands from stdin
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = await loop.connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
    )

    while True:
        line = await reader.readline()
        if not line:
            break

        line_str = line.decode().strip()
        if not line_str:
            continue

        try:
            cmd = deserialize_command(line_str)
        except (json.JSONDecodeError, ValueError) as e:
            print(serialize(EngineError(message=f"Bad command: {e}")), flush=True)
            continue

        if isinstance(cmd, Cancel):
            engine.cancel()
        elif isinstance(cmd, UserMessage):
            async for event in engine.run(cmd.content):
                print(serialize(event), flush=True)
        elif isinstance(cmd, SlashCommand):
            if cmd.command == "compact":
                result = await context.force_compact(engine.messages, client, logger)
                if result:
                    print(
                        serialize(CompactDone(
                            old_tokens=result["old_tokens"],
                            new_tokens=result["new_tokens"],
                            layer=result["layer"],
                        )),
                        flush=True,
                    )
            elif cmd.command == "clear":
                engine.messages.clear()
                engine.turn_count = 0
                print(serialize(EngineReady(model=client.model, tools=tool_names)), flush=True)
            elif cmd.command == "tokens":
                tokens = estimate_messages_tokens(engine.messages)
                print(serialize(TokenDelta(text=f"\nContext: ~{tokens:,} tokens\n")), flush=True)

    logger.session_end(engine.turn_count, estimate_messages_tokens(engine.messages))
    logger.close()


if __name__ == "__main__":
    asyncio.run(run_headless())
