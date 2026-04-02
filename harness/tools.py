"""7 built-in tools + parallel dispatch with seenIds file caching.

Tools:
  read_file   — Read file with optional line range, cached via content hash
  edit_file   — str_replace with unique match validation
  write_file  — Create or overwrite a file
  shell       — Run command with timeout, capture stdout/stderr/exit_code
  search      — ripgrep wrapper (fallback to re+pathlib)
  list_dir    — Directory tree, depth 2
  plan        — Read/write .plan.md, survives compaction
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from log import HarnessLogger

# ── File cache (seenIds) ────────────────────────────────────────────────────


@dataclass
class CachedFile:
    content_hash: str
    content: str
    turn: int


class FileCache:
    """Track file reads to avoid redundant I/O."""

    def __init__(self, logger: HarnessLogger | None = None):
        self._cache: dict[str, CachedFile] = {}
        self.logger = logger

    @staticmethod
    def _hash(content: str) -> str:
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def get(self, path: str) -> str | None:
        """Return cached content if file hasn't changed on disk."""
        entry = self._cache.get(path)
        if entry is None:
            return None
        try:
            current_hash = self._hash(Path(path).read_text(errors="replace"))
        except OSError:
            return None
        if current_hash == entry.content_hash:
            if self.logger:
                self.logger.cache_hit(path)
            return entry.content
        # File changed — invalidate
        del self._cache[path]
        if self.logger:
            self.logger.cache_miss(path)
        return None

    def put(self, path: str, content: str, turn: int) -> None:
        self._cache[path] = CachedFile(
            content_hash=self._hash(content), content=content, turn=turn
        )

    def invalidate(self, path: str) -> None:
        self._cache.pop(path, None)

    def get_hash(self, path: str) -> str | None:
        entry = self._cache.get(path)
        return entry.content_hash if entry else None


# ── Tool result ──────────────────────────────────────────────────────────────


@dataclass
class ToolResultData:
    name: str
    call_id: str
    output: str
    is_error: bool = False

    def to_part(self) -> dict:
        return {
            "function_response": {
                "name": self.name,
                "id": self.call_id,
                "response": {"output": self.output} if not self.is_error else {"error": self.output},
            }
        }

    @property
    def summary(self) -> str:
        if self.is_error:
            return f"error: {self.output[:200]}"
        lines = self.output.count("\n") + 1
        if lines > 5:
            return f"{lines} lines"
        return self.output[:200]


# ── Tool declarations (Gemini function schemas) ─────────────────────────────

TOOL_DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "read_file",
        "description": "Read a file's contents. Returns line-numbered output. Use offset/limit for large files.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute or relative file path"},
                "offset": {"type": "integer", "description": "Starting line number (1-based)"},
                "limit": {"type": "integer", "description": "Max lines to read"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "edit_file",
        "description": "Edit a file by replacing an exact string match. old_string must appear exactly once in the file.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to edit"},
                "old_string": {"type": "string", "description": "Exact text to find (must be unique)"},
                "new_string": {"type": "string", "description": "Replacement text"},
            },
            "required": ["path", "old_string", "new_string"],
        },
    },
    {
        "name": "write_file",
        "description": "Create or overwrite a file with the given content.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to write"},
                "content": {"type": "string", "description": "File content"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "shell",
        "description": "Run a shell command. Returns stdout, stderr, and exit code. Timeout: 120s.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to execute"},
                "cwd": {"type": "string", "description": "Working directory (optional)"},
            },
            "required": ["command"],
        },
    },
    {
        "name": "search",
        "description": "Search file contents using regex. Uses ripgrep if available. Max 30 results.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex pattern to search for"},
                "path": {"type": "string", "description": "Directory or file to search (default: cwd)"},
                "glob": {"type": "string", "description": "File pattern filter (e.g. '*.py')"},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "list_dir",
        "description": "List directory contents with file types and sizes.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path (default: cwd)"},
                "depth": {"type": "integer", "description": "Max depth (default: 2)"},
            },
        },
    },
    {
        "name": "plan",
        "description": "Read or write the .plan.md file. This file survives compaction and tracks multi-step work.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "write"],
                    "description": "'read' to view current plan, 'write' to update it",
                },
                "content": {"type": "string", "description": "New plan content (only for 'write')"},
            },
            "required": ["action"],
        },
    },
]

# ── Read-only classification for parallel dispatch ───────────────────────────

READ_ONLY_TOOLS = frozenset({"read_file", "search", "list_dir"})

# ── Tool implementations ────────────────────────────────────────────────────


def _resolve_path(path: str) -> Path:
    """Resolve relative paths against cwd."""
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


async def tool_read_file(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    path = str(_resolve_path(args["path"]))
    offset = args.get("offset", 1)
    limit = args.get("limit")

    # Check cache first (only for full reads)
    if offset <= 1 and limit is None:
        cached = cache.get(path)
        if cached is not None:
            return cached

    try:
        content = Path(path).read_text(errors="replace")
    except FileNotFoundError:
        return f"Error: File not found: {path}"
    except PermissionError:
        return f"Error: Permission denied: {path}"
    except OSError as e:
        return f"Error reading file: {e}"

    lines = content.splitlines(keepends=True)
    total = len(lines)

    # Apply offset/limit
    start = max(0, offset - 1)
    end = start + limit if limit else total
    selected = lines[start:end]

    # Format with line numbers
    numbered = ""
    for i, line in enumerate(selected, start=start + 1):
        numbered += f"{i}\t{line}"
    if not numbered.endswith("\n"):
        numbered += "\n"

    # Cache the full content
    if offset <= 1 and limit is None:
        cache.put(path, numbered, turn)

    result = f"File: {path} ({total} lines)\n{numbered}"
    if limit and end < total:
        result += f"\n... ({total - end} more lines)"
    return result


async def tool_edit_file(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    path = str(_resolve_path(args["path"]))
    old_string = args["old_string"]
    new_string = args["new_string"]

    try:
        content = Path(path).read_text()
    except FileNotFoundError:
        return f"Error: File not found: {path}"

    count = content.count(old_string)
    if count == 0:
        return f"Error: old_string not found in {path}"
    if count > 1:
        return f"Error: old_string appears {count} times in {path}. Must be unique."

    new_content = content.replace(old_string, new_string, 1)
    Path(path).write_text(new_content)
    cache.invalidate(path)

    # Show a brief diff summary
    old_lines = old_string.count("\n") + 1
    new_lines = new_string.count("\n") + 1
    return f"Edited {path}: replaced {old_lines} lines with {new_lines} lines"


async def tool_write_file(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    path = str(_resolve_path(args["path"]))
    content = args["content"]

    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(content)
        cache.invalidate(path)
        lines = content.count("\n") + 1
        return f"Wrote {lines} lines to {path}"
    except OSError as e:
        return f"Error writing file: {e}"


async def tool_shell(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    command = args["command"]
    cwd = args.get("cwd")
    timeout = 120

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return f"Error: Command timed out after {timeout}s"

        stdout = stdout_bytes.decode(errors="replace")
        stderr = stderr_bytes.decode(errors="replace")

        # Truncate large outputs
        max_chars = 50_000
        if len(stdout) > max_chars:
            stdout = stdout[:max_chars] + f"\n... (truncated, {len(stdout)} total chars)"
        if len(stderr) > max_chars:
            stderr = stderr[:max_chars] + f"\n... (truncated, {len(stderr)} total chars)"

        parts = [f"exit_code: {proc.returncode}"]
        if stdout:
            parts.append(f"stdout:\n{stdout}")
        if stderr:
            parts.append(f"stderr:\n{stderr}")
        return "\n".join(parts)
    except OSError as e:
        return f"Error: {e}"


async def tool_search(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    pattern = args["pattern"]
    path = args.get("path", ".")
    glob_filter = args.get("glob")
    max_results = 30
    resolved = str(_resolve_path(path))

    # Try ripgrep first
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, "--line-number", "--max-count", str(max_results), "--color", "never"]
        if glob_filter:
            cmd.extend(["--glob", glob_filter])
        cmd.extend(["--", pattern, resolved])
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30
            )
            if proc.returncode <= 1:  # 0=match, 1=no match
                lines = proc.stdout.strip().split("\n")[:max_results]
                if not lines or lines == [""]:
                    return "No matches found."
                return f"Found {len(lines)} matches:\n" + "\n".join(lines)
            return f"Error: {proc.stderr[:500]}"
        except subprocess.TimeoutExpired:
            return "Error: Search timed out after 30s"
    else:
        # Fallback: Python re + pathlib
        results = []
        search_path = Path(resolved)
        try:
            regex = re.compile(pattern)
        except re.error as e:
            return f"Error: Invalid regex: {e}"

        glob_pat = glob_filter or "**/*"
        try:
            for fp in search_path.glob(glob_pat):
                if not fp.is_file() or len(results) >= max_results:
                    break
                try:
                    text = fp.read_text(errors="replace")
                    for i, line in enumerate(text.splitlines(), 1):
                        if regex.search(line):
                            rel = fp.relative_to(search_path)
                            results.append(f"{rel}:{i}: {line.strip()}")
                            if len(results) >= max_results:
                                break
                except (OSError, UnicodeDecodeError):
                    continue
        except Exception as e:
            return f"Error: {e}"

        if not results:
            return "No matches found."
        return f"Found {len(results)} matches:\n" + "\n".join(results)


async def tool_list_dir(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    path = args.get("path", ".")
    max_depth = args.get("depth", 2)
    resolved = _resolve_path(path)

    if not resolved.is_dir():
        return f"Error: Not a directory: {resolved}"

    lines = []

    def _walk(p: Path, prefix: str, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            entries = sorted(p.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            lines.append(f"{prefix}[permission denied]")
            return

        for i, entry in enumerate(entries):
            # Skip hidden and common noise
            if entry.name.startswith(".") and entry.name not in (".env", ".gitignore"):
                continue
            if entry.name in ("node_modules", "__pycache__", ".git", "venv", ".venv"):
                continue

            is_last = i == len(entries) - 1
            connector = "\u2514\u2500 " if is_last else "\u251c\u2500 "
            extension = "   " if is_last else "\u2502  "

            if entry.is_dir():
                lines.append(f"{prefix}{connector}{entry.name}/")
                _walk(entry, prefix + extension, depth + 1)
            else:
                size = entry.stat().st_size
                size_str = (
                    f"{size}B" if size < 1024
                    else f"{size / 1024:.0f}K" if size < 1024 * 1024
                    else f"{size / (1024 * 1024):.1f}M"
                )
                lines.append(f"{prefix}{connector}{entry.name} ({size_str})")

    _walk(resolved, "", 0)
    if not lines:
        return f"Empty directory: {resolved}"
    return f"{resolved}/\n" + "\n".join(lines[:200])


async def tool_plan(
    args: dict, cache: FileCache, turn: int, logger: HarnessLogger | None
) -> str:
    action = args["action"]
    plan_path = Path.cwd() / ".plan.md"

    if action == "read":
        if plan_path.exists():
            return plan_path.read_text()
        return "No plan file exists. Use action='write' to create one."
    elif action == "write":
        content = args.get("content", "")
        if not content:
            return "Error: content is required for write action"
        plan_path.write_text(content)
        return f"Plan updated ({content.count(chr(10)) + 1} lines)"
    else:
        return f"Error: Unknown action '{action}'. Use 'read' or 'write'."


# ── Dispatch ─────────────────────────────────────────────────────────────────

TOOL_HANDLERS = {
    "read_file": tool_read_file,
    "edit_file": tool_edit_file,
    "write_file": tool_write_file,
    "shell": tool_shell,
    "search": tool_search,
    "list_dir": tool_list_dir,
    "plan": tool_plan,
}


async def _execute_one(
    name: str,
    call_id: str,
    args: dict,
    cache: FileCache,
    turn: int,
    logger: HarnessLogger | None,
) -> ToolResultData:
    handler = TOOL_HANDLERS.get(name)
    if handler is None:
        return ToolResultData(name=name, call_id=call_id, output=f"Error: Unknown tool '{name}'", is_error=True)

    start = time.monotonic()
    if logger:
        logger.tool_start(name, call_id, json.dumps(args)[:200])

    try:
        output = await handler(args, cache, turn, logger)
        is_error = output.startswith("Error:")
    except Exception as e:
        output = f"Error: {e}"
        is_error = True

    duration_ms = int((time.monotonic() - start) * 1000)
    if logger:
        logger.tool_done(name, call_id, duration_ms, len(output), is_error)

    return ToolResultData(name=name, call_id=call_id, output=output, is_error=is_error)


async def execute_tools(
    tool_calls: list[dict],
    cache: FileCache,
    turn: int,
    logger: HarnessLogger | None = None,
    mcp_handler=None,
) -> list[ToolResultData]:
    """Execute tool calls: reads in parallel, writes sequentially.

    tool_calls: list of {"name": str, "call_id": str, "args": dict}
    mcp_handler: optional async callable(name, call_id, args) -> ToolResultData for MCP tools
    """
    reads = []
    writes = []

    for tc in tool_calls:
        name = tc["name"]
        if name in TOOL_HANDLERS:
            if name in READ_ONLY_TOOLS:
                reads.append(tc)
            else:
                writes.append(tc)
        elif mcp_handler:
            # MCP tools treated as writes (sequential) for safety
            writes.append(tc)
        else:
            writes.append(tc)

    results: list[ToolResultData] = []

    # Parallel reads
    if reads:
        read_coros = [
            _execute_one(tc["name"], tc["call_id"], tc["args"], cache, turn, logger)
            for tc in reads
        ]
        results.extend(await asyncio.gather(*read_coros))

    # Sequential writes (including MCP)
    for tc in writes:
        if tc["name"] in TOOL_HANDLERS:
            result = await _execute_one(tc["name"], tc["call_id"], tc["args"], cache, turn, logger)
        elif mcp_handler:
            result = await mcp_handler(tc["name"], tc["call_id"], tc["args"])
        else:
            result = ToolResultData(
                name=tc["name"],
                call_id=tc["call_id"],
                output=f"Error: Unknown tool '{tc['name']}'",
                is_error=True,
            )
        results.append(result)

    return results
