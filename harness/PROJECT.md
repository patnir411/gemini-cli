# Gemini Harness

Personal coding agent CLI. Gemini on Vertex AI, Textual TUI, native MCP.

## Architecture

Two-process: Textual TUI (tui.py) <-> Engine (engine.py) via JSON stdin/stdout.

## Key Files

- `engine.py` — Async generator ReAct loop, the brain
- `context.py` — 3-layer compaction (micro/auto/emergency) + prompt builder
- `tools.py` — 7 built-in tools + parallel dispatch + file cache (seenIds)
- `vertex.py` — Gemini streaming client with retry
- `mcp_client.py` — MCP server lifecycle + tool routing
- `tui.py` — Textual frontend, launches engine as subprocess
- `protocol.py` — JSON IPC types between TUI and engine
- `session.py` — JSONL persistence
- `log.py` — Structured JSONL observability (flight recorder)
- `main.py` — CLI entry point

## Running

```bash
# Interactive TUI
python main.py

# Single query
python main.py -q "explain this codebase"

# Headless (JSON stdin/stdout)
python main.py --headless

# Resume session
python main.py --continue <session-id>
```

## Environment

- `GEMINI_API_KEY` or `GOOGLE_CLOUD_PROJECT` + `GOOGLE_GENAI_USE_VERTEXAI=true`
- `GEMINI_MODEL` — override model (default: gemini-2.5-flash)
- `HARNESS_DEBUG` — enable debug logging

## Observability

Every session writes a JSONL log to `~/.harness/logs/{session_id}.jsonl`.
Search with jq:

```bash
# All API errors
cat ~/.harness/logs/*.jsonl | jq 'select(.event=="api_error")'

# Tool durations > 5s
cat ~/.harness/logs/*.jsonl | jq 'select(.event=="tool_done" and .data.duration_ms > 5000)'

# Compaction events
cat ~/.harness/logs/*.jsonl | jq 'select(.event=="compact")'
```
