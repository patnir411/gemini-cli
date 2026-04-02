"""Vertex AI / Gemini streaming client wrapper.

Thin layer over google-genai SDK handling auth, streaming, retries, and
token estimation. Yields structured events for the engine to consume.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator

from google import genai
from google.genai import types

from log import HarnessLogger

# ── Stream event types ───────────────────────────────────────────────────────


@dataclass
class ContentDelta:
    text: str
    type: str = "content"


@dataclass
class ThinkingDelta:
    text: str
    type: str = "thinking"


@dataclass
class ToolCallEvent:
    name: str
    call_id: str
    args: dict[str, Any] = field(default_factory=dict)
    type: str = "tool_call"


@dataclass
class FinishEvent:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    type: str = "finish"


@dataclass
class StreamError:
    message: str
    status: int | None = None
    is_413: bool = False
    type: str = "error"


StreamEvent = ContentDelta | ThinkingDelta | ToolCallEvent | FinishEvent | StreamError

# ── Retry config ─────────────────────────────────────────────────────────────

MAX_RETRIES = 4
INITIAL_DELAY_MS = 500
RETRYABLE_STATUSES = {429, 499, 500, 502, 503, 504}

# ── Token estimation ─────────────────────────────────────────────────────────

TOKENS_PER_ASCII_CHAR = 0.25
TOKENS_PER_CJK_CHAR = 1.3


def estimate_tokens(text: str) -> int:
    """Heuristic token count: 4 ASCII chars ~= 1 token, CJK ~= 1.3 tokens/char."""
    if not text:
        return 0
    ascii_count = 0
    cjk_count = 0
    for ch in text[:100_000]:  # cap scan at 100K chars
        if ord(ch) > 0x2E80:
            cjk_count += 1
        else:
            ascii_count += 1
    # fast path for remainder
    remainder = len(text) - 100_000
    if remainder > 0:
        ascii_count += remainder  # assume ASCII for tail
    return int(ascii_count * TOKENS_PER_ASCII_CHAR + cjk_count * TOKENS_PER_CJK_CHAR)


def estimate_messages_tokens(messages: list[dict]) -> int:
    """Estimate total tokens across all messages."""
    import json

    return estimate_tokens(json.dumps(messages))


# ── Client ───────────────────────────────────────────────────────────────────


class GeminiClient:
    """Streaming Gemini client with retry and auth detection."""

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        project: str | None = None,
        location: str | None = None,
        logger: HarnessLogger | None = None,
    ):
        self.model = model or os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        self.logger = logger
        self._thinking_config = types.ThinkingConfig(thinking_budget=4096)

        # Auth detection (matching gemini-cli env var priority)
        api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        project = project or os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT_ID")
        location = location or os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
        use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"

        if use_vertex or (project and not api_key):
            # Vertex AI auth
            self.client = genai.Client(
                vertexai=True,
                project=project,
                location=location,
            )
            self.auth_type = "vertex"
        elif api_key:
            # Direct API key
            self.client = genai.Client(api_key=api_key)
            self.auth_type = "api_key"
        else:
            raise ValueError(
                "No auth configured. Set GEMINI_API_KEY, or "
                "GOOGLE_CLOUD_PROJECT + GOOGLE_GENAI_USE_VERTEXAI=true"
            )

    def _build_tools(self, tool_declarations: list[dict]) -> list[types.Tool] | None:
        """Convert tool declarations to SDK Tool objects."""
        if not tool_declarations:
            return None
        functions = []
        for decl in tool_declarations:
            functions.append(
                types.FunctionDeclaration(
                    name=decl["name"],
                    description=decl.get("description", ""),
                    parameters=decl.get("parameters"),
                )
            )
        return [types.Tool(function_declarations=functions)]

    def _build_contents(self, messages: list[dict]) -> list[types.Content]:
        """Convert message dicts to SDK Content objects."""
        contents = []
        for msg in messages:
            parts = []
            for p in msg.get("parts", []):
                if "text" in p:
                    parts.append(types.Part.from_text(text=p["text"]))
                elif "function_call" in p:
                    fc = p["function_call"]
                    parts.append(
                        types.Part.from_function_call(
                            name=fc["name"], args=fc.get("args", {})
                        )
                    )
                elif "function_response" in p:
                    fr = p["function_response"]
                    parts.append(
                        types.Part.from_function_response(
                            name=fr["name"], response=fr.get("response", {})
                        )
                    )
                elif "thought" in p:
                    parts.append(types.Part(thought=True, text=p["thought"]))
            if parts:
                contents.append(types.Content(role=msg.get("role", "user"), parts=parts))
        return contents

    async def stream(
        self,
        messages: list[dict],
        tool_declarations: list[dict],
        system_prompt: str,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream a response from Gemini, yielding events.

        Handles retries with exponential backoff for transient errors.
        Yields StreamError with is_413=True when context is too large.
        """
        contents = self._build_contents(messages)
        tools = self._build_tools(tool_declarations)

        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=tools,
            thinking_config=self._thinking_config,
        )

        start_time = time.monotonic()
        last_error: Exception | None = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response_stream = self.client.models.generate_content_stream(
                    model=self.model,
                    contents=contents,
                    config=config,
                )

                input_tokens = 0
                output_tokens = 0
                cached_tokens = 0

                for chunk in response_stream:
                    # Usage metadata
                    if chunk.usage_metadata:
                        input_tokens = chunk.usage_metadata.prompt_token_count or 0
                        output_tokens = chunk.usage_metadata.candidates_token_count or 0
                        cached_tokens = chunk.usage_metadata.cached_content_token_count or 0

                    if not chunk.candidates:
                        continue

                    for candidate in chunk.candidates:
                        if not candidate.content or not candidate.content.parts:
                            continue
                        for part in candidate.content.parts:
                            if hasattr(part, "thought") and part.thought:
                                if part.text:
                                    yield ThinkingDelta(text=part.text)
                            elif part.text:
                                yield ContentDelta(text=part.text)
                            elif part.function_call:
                                yield ToolCallEvent(
                                    name=part.function_call.name,
                                    call_id=part.function_call.id or f"call_{id(part)}",
                                    args=dict(part.function_call.args) if part.function_call.args else {},
                                )

                duration_ms = int((time.monotonic() - start_time) * 1000)
                if self.logger:
                    self.logger.api_response(
                        self.model, input_tokens, output_tokens, duration_ms, cached_tokens
                    )

                yield FinishEvent(
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cached_tokens=cached_tokens,
                )
                return  # success, exit retry loop

            except Exception as e:
                last_error = e
                status = getattr(e, "status_code", None) or getattr(e, "code", None)

                # 413 = context too large -> signal emergency compact
                if status == 413:
                    if self.logger:
                        self.logger.api_error(str(e), status=413, attempt=attempt)
                    yield StreamError(message=str(e), status=413, is_413=True)
                    return

                # Check if retryable
                is_retryable = (
                    status in RETRYABLE_STATUSES
                    or "ECONNRESET" in str(e)
                    or "ETIMEDOUT" in str(e)
                    or "ServiceUnavailable" in str(e)
                )

                if self.logger:
                    self.logger.api_error(str(e), status=status, attempt=attempt)

                if is_retryable and attempt < MAX_RETRIES:
                    delay = (INITIAL_DELAY_MS * (2 ** (attempt - 1))) / 1000
                    await asyncio.sleep(delay)
                    continue

                # Non-retryable or exhausted retries
                yield StreamError(message=str(e), status=status)
                return

    async def count_tokens(self, messages: list[dict], system_prompt: str = "") -> int:
        """Count tokens via API (slower but accurate). Falls back to heuristic."""
        try:
            contents = self._build_contents(messages)
            result = self.client.models.count_tokens(
                model=self.model,
                contents=contents,
                config=types.CountTokensConfig(
                    system_instruction=system_prompt if system_prompt else None,
                ),
            )
            return result.total_tokens
        except Exception:
            return estimate_messages_tokens(messages)
