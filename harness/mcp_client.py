"""MCP client lifecycle + tool routing.

Manages MCP server connections (stdio and HTTP), discovers tools at startup,
converts schemas to Gemini FunctionDeclarations, and routes tool calls
to the correct server.

Config format (compatible with Claude Code / Gemini CLI):
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "..."}
    },
    "http-server": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from log import HarnessLogger
from tools import ToolResultData

# Try to import MCP SDK — graceful degradation if not installed
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False


def _find_settings() -> dict | None:
    """Find and load settings.json from cwd or ~/.harness/."""
    candidates = [
        Path.cwd() / "settings.json",
        Path.cwd() / ".harness" / "settings.json",
        Path.home() / ".harness" / "settings.json",
    ]
    for p in candidates:
        if p.exists():
            try:
                return json.loads(p.read_text())
            except (json.JSONDecodeError, OSError):
                continue
    return None


def _mcp_schema_to_gemini(tool: dict) -> dict:
    """Convert an MCP tool schema to a Gemini FunctionDeclaration dict."""
    schema = tool.get("inputSchema", {})
    # Remove JSON Schema fields that Gemini doesn't support
    parameters = dict(schema) if schema else {"type": "object", "properties": {}}
    parameters.pop("$schema", None)
    parameters.pop("additionalProperties", None)

    return {
        "name": tool["name"],
        "description": tool.get("description", ""),
        "parameters": parameters,
    }


class MCPServer:
    """Wraps a single MCP server connection."""

    def __init__(self, name: str, config: dict, logger: HarnessLogger | None = None):
        self.name = name
        self.config = config
        self.logger = logger
        self.session: Any = None
        self.tools: list[dict] = []
        self._client_context: Any = None
        self._session_context: Any = None

    async def connect(self) -> list[dict]:
        """Connect to the MCP server and discover tools."""
        if not MCP_AVAILABLE:
            if self.logger:
                self.logger.warn("mcp_sdk_missing", server=self.name)
            return []

        try:
            if "command" in self.config:
                return await self._connect_stdio()
            elif "url" in self.config:
                if self.logger:
                    self.logger.warn("mcp_http_not_implemented", server=self.name)
                return []
            else:
                if self.logger:
                    self.logger.warn("mcp_unknown_transport", server=self.name)
                return []
        except Exception as e:
            if self.logger:
                self.logger.mcp_error(self.name, str(e))
            return []

    async def _connect_stdio(self) -> list[dict]:
        """Connect to a stdio MCP server."""
        command = self.config["command"]
        args = self.config.get("args", [])
        env = {**os.environ, **self.config.get("env", {})}

        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=env,
        )

        self._client_context = stdio_client(server_params)
        read_stream, write_stream = await self._client_context.__aenter__()

        self._session_context = ClientSession(read_stream, write_stream)
        self.session = await self._session_context.__aenter__()
        await self.session.initialize()

        # Discover tools
        tools_result = await self.session.list_tools()
        self.tools = [
            {"name": t.name, "description": t.description or "", "inputSchema": t.inputSchema or {}}
            for t in tools_result.tools
        ]

        tool_names = [t["name"] for t in self.tools]
        if self.logger:
            self.logger.mcp_connect(self.name, tool_names)

        return self.tools

    async def call_tool(self, name: str, args: dict) -> str:
        """Call a tool on this server."""
        if not self.session:
            return f"Error: MCP server '{self.name}' not connected"

        try:
            result = await self.session.call_tool(name, arguments=args)
            # Extract text from result content
            texts = []
            for block in result.content:
                if hasattr(block, "text"):
                    texts.append(block.text)
                elif hasattr(block, "data"):
                    texts.append(f"[binary data: {len(block.data)} bytes]")
            return "\n".join(texts) if texts else "Tool returned no output."
        except Exception as e:
            if self.logger:
                self.logger.mcp_error(self.name, f"call_tool({name}): {e}")
            return f"Error: MCP tool call failed: {e}"

    async def disconnect(self) -> None:
        """Gracefully disconnect from the server."""
        try:
            if self._session_context:
                await self._session_context.__aexit__(None, None, None)
            if self._client_context:
                await self._client_context.__aexit__(None, None, None)
        except Exception:
            pass


class MCPManager:
    """Manages all MCP server connections."""

    def __init__(self, logger: HarnessLogger | None = None, settings: dict | None = None):
        self.logger = logger
        self._settings = settings or _find_settings() or {}
        self._servers: dict[str, MCPServer] = {}
        self._tool_router: dict[str, str] = {}  # tool_name -> server_name

    async def start(self) -> None:
        """Connect to all configured MCP servers."""
        server_configs = self._settings.get("mcpServers", {})
        if not server_configs:
            if self.logger:
                self.logger.info("mcp_no_servers")
            return

        if not MCP_AVAILABLE:
            if self.logger:
                self.logger.warn("mcp_sdk_not_installed",
                    hint="pip install mcp")
            return

        for name, config in server_configs.items():
            server = MCPServer(name, config, self.logger)
            tools = await server.connect()
            if tools:
                self._servers[name] = server
                for tool in tools:
                    # Prefix tool names to avoid collisions with built-ins
                    qualified_name = f"mcp_{name}_{tool['name']}"
                    self._tool_router[qualified_name] = name
                    # Also register unqualified name if no collision
                    if tool["name"] not in self._tool_router:
                        self._tool_router[tool["name"]] = name

    def get_tool_declarations(self) -> list[dict]:
        """Get Gemini FunctionDeclaration dicts for all MCP tools."""
        declarations = []
        for name, server in self._servers.items():
            for tool in server.tools:
                decl = _mcp_schema_to_gemini(tool)
                # Use qualified name to avoid collisions
                decl["name"] = f"mcp_{name}_{tool['name']}"
                declarations.append(decl)
        return declarations

    async def call_tool(self, name: str, call_id: str, args: dict) -> ToolResultData:
        """Route a tool call to the correct MCP server."""
        server_name = self._tool_router.get(name)
        if not server_name:
            return ToolResultData(
                name=name, call_id=call_id,
                output=f"Error: No MCP server found for tool '{name}'",
                is_error=True,
            )

        server = self._servers.get(server_name)
        if not server:
            return ToolResultData(
                name=name, call_id=call_id,
                output=f"Error: MCP server '{server_name}' not connected",
                is_error=True,
            )

        # Strip qualified prefix for the actual call
        actual_name = name
        prefix = f"mcp_{server_name}_"
        if actual_name.startswith(prefix):
            actual_name = actual_name[len(prefix):]

        output = await server.call_tool(actual_name, args)
        return ToolResultData(
            name=name, call_id=call_id, output=output,
            is_error=output.startswith("Error:"),
        )

    async def shutdown(self) -> None:
        """Disconnect all MCP servers."""
        for server in self._servers.values():
            await server.disconnect()
        self._servers.clear()
        self._tool_router.clear()
