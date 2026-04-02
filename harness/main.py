#!/usr/bin/env python3
"""Gemini Harness — personal coding agent CLI.

Usage:
  python main.py                    # Interactive TUI
  python main.py --headless         # Headless mode (stdin/stdout JSON)
  python main.py -q "explain this"  # Single query, non-interactive
  python main.py --continue <id>    # Resume a previous session
  python main.py --list             # List saved sessions

Environment variables:
  GEMINI_API_KEY          — Direct API key auth
  GEMINI_MODEL            — Model override (default: gemini-2.5-flash)
  GOOGLE_CLOUD_PROJECT    — GCP project for Vertex AI
  GOOGLE_CLOUD_LOCATION   — GCP location (default: us-central1)
  GOOGLE_GENAI_USE_VERTEXAI — Set to "true" for Vertex AI auth
  HARNESS_DEBUG           — Enable debug logging
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gemini Harness — personal coding agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-q", "--query",
        help="Run a single query non-interactively",
    )
    parser.add_argument(
        "-m", "--model",
        help="Model to use (overrides GEMINI_MODEL env var)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run in headless mode (JSON stdin/stdout, no TUI)",
    )
    parser.add_argument(
        "--continue", dest="resume",
        metavar="SESSION_ID",
        help="Resume a previous session by ID (prefix match)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List saved sessions",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )
    return parser.parse_args()


async def run_single_query(query: str, model: str | None = None) -> None:
    """Run a single query and print the response."""
    from context import ContextManager
    from engine import QueryEngine
    from log import HarnessLogger
    from session import SessionManager
    from vertex import GeminiClient

    session_id = str(uuid.uuid4())[:8]
    logger = HarnessLogger(session_id)

    if model:
        os.environ["GEMINI_MODEL"] = model

    try:
        client = GeminiClient(logger=logger)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    context = ContextManager()
    session = SessionManager(session_id)
    engine = QueryEngine(client, context, session, logger)

    # Try MCP
    try:
        from mcp_client import MCPManager
        mcp = MCPManager(logger=logger)
        await mcp.start()
        engine.add_mcp_tools(mcp.get_tool_declarations())
        engine.mcp_handler = mcp.call_tool
    except (ImportError, Exception):
        pass

    async for event in engine.run(query):
        etype = getattr(event, "type", "")
        if etype == "token_delta":
            print(event.text, end="", flush=True)
        elif etype == "tool_start":
            print(f"\n[{event.name}]", file=sys.stderr)
        elif etype == "tool_result":
            if event.is_error:
                print(f"  Error: {event.content}", file=sys.stderr)
            else:
                print(f"  -> {event.content}", file=sys.stderr)
        elif etype == "error":
            print(f"\nError: {event.message}", file=sys.stderr)

    print()  # final newline
    logger.close()


def list_sessions() -> None:
    """Print saved sessions."""
    from session import SessionManager
    sessions = SessionManager.list_sessions()
    if not sessions:
        print("No saved sessions.")
        return
    print(f"{'ID':<12} {'Timestamp':<22} {'Model':<20} {'CWD'}")
    print("-" * 80)
    for s in sessions[:20]:
        print(
            f"{s.get('session_id', '?'):<12} "
            f"{s.get('timestamp', '?'):<22} "
            f"{s.get('model', '?'):<20} "
            f"{s.get('cwd', '?')}"
        )


def main() -> None:
    args = parse_args()

    if args.verbose:
        os.environ["HARNESS_DEBUG"] = "1"

    if args.model:
        os.environ["GEMINI_MODEL"] = args.model

    if args.list:
        list_sessions()
        return

    if args.query:
        asyncio.run(run_single_query(args.query, args.model))
        return

    if args.headless:
        from engine import run_headless
        asyncio.run(run_headless())
        return

    # Default: launch TUI
    # Set session ID for engine subprocess
    session_id = str(uuid.uuid4())[:8]
    if args.resume:
        from session import SessionManager
        found = SessionManager.find_session(args.resume)
        if found:
            session_id = found.session_id
            print(f"Resuming session: {session_id}")
        else:
            print(f"Session not found: {args.resume}", file=sys.stderr)
            sys.exit(1)

    os.environ["HARNESS_SESSION_ID"] = session_id

    from tui import HarnessApp
    app = HarnessApp()
    app.run()


if __name__ == "__main__":
    main()
