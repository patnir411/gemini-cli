# 🏗️ Gemini CLI - Architecture Documentation

> **Comprehensive architectural documentation for the Gemini CLI codebase**

This directory contains detailed architectural documentation, interactive visualizations, and technical deep-dives into the Gemini CLI agent harness framework.

## 🤖 AI Q&A Assistant

**NEW!** Ask questions about the architecture using our AI-powered assistant:

```bash
# Interactive mode
cd architecture/
export GEMINI_API_KEY="your-api-key"
./qa.sh

# Single question
./qa.sh "What is the agent harness?"
```

See [QA_ASSISTANT.md](./QA_ASSISTANT.md) for full documentation.

## 📚 Documentation Overview

### 🎯 Getting Started

**Start Here:** [**index.html**](./index.html) - Main documentation hub with project overview, statistics, and navigation

### 📊 Visual Diagrams

- [**Architecture Diagram**](./diagrams/architecture-diagram.html) - Interactive multi-layer architecture visualization showing the complete 6-layer agent harness stack
- [**Data Flow Diagram**](./diagrams/data-flow.html) - Comprehensive data flow visualizations covering user input, API requests, tool execution, and state persistence
- [**Component Map**](./diagrams/component-map.html) - Interactive component relationship map (if available)

### 📖 Technical Documentation

- [**Agent Harness Deep Dive**](./docs/agent-harness.html) - Complete guide to the multi-layer agent architecture, conversation management, and tool execution
- [**API Integration Guide**](./docs/api-integration.html) - Integration with Gemini API, Code Assist, web services, telemetry, and MCP
- [**Tools System Architecture**](./docs/tools-system.html) - Tool registry, execution flow, policy engine, and safety features
- [**Configuration Management**](./docs/configuration.html) - 4-tier configuration hierarchy, settings reference, and environment variables
- [**Data Models & State**](./docs/data-models.html) - Data structures, state management, and persistence

## 🗂️ Directory Structure

```
architecture/
├── index.html                  # Main documentation hub
├── README.md                   # This file
├── QA_ASSISTANT.md             # AI Q&A Assistant documentation
│
├── qa.sh                       # Q&A Assistant shell script
├── qa-assistant.mjs            # Q&A Assistant Node.js app
│
├── diagrams/                   # Interactive visualizations
│   ├── architecture-diagram.html
│   ├── data-flow.html
│   └── component-map.html
│
├── docs/                       # Technical documentation
│   ├── agent-harness.html
│   ├── api-integration.html
│   ├── tools-system.html
│   ├── configuration.html
│   └── data-models.html
│
└── assets/                     # Images and resources (if needed)
```

## 🎯 What is Gemini CLI?

Gemini CLI is a sophisticated **agent harness** - a production-grade framework that orchestrates interactions between users, Google's Gemini AI models, and various tools. It provides:

### Core Capabilities

✅ **Multi-turn conversation management** with history and context preservation
✅ **Tool execution framework** with 15+ built-in tools and MCP integration
✅ **Streaming response handling** with real-time UI updates
✅ **Intelligent fallback mechanisms** for quota limits and errors
✅ **Context window management** with automatic compression
✅ **Loop detection** to prevent infinite tool call cycles
✅ **Enterprise features**: Telemetry, policy engine, sandbox execution

### Architecture Highlights

The CLI is built as a **modular monorepo** with clear separation of concerns:

- **packages/cli** - User interface layer (React/Ink terminal UI)
- **packages/core** - Business logic and AI orchestration
- **packages/a2a-server** - Agent-to-Agent communication
- **packages/vscode-ide-companion** - IDE integration
- **packages/test-utils** - Shared testing infrastructure

## 🏛️ Architecture Layers

The agent harness is implemented as a 6-layer stack:

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                      │
│  (React/Ink - Terminal UI Components)                       │
└─────────────────────────────────────┬───────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────┐
│                   GEMINI CLIENT LAYER                        │
│  • Model routing & fallback                                 │
│  • Session management (max 100 turns)                       │
│  • Loop detection • Chat compression                        │
└─────────────────────────────────────┬───────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────┐
│                    GEMINI CHAT LAYER                         │
│  • History management (curated vs comprehensive)            │
│  • Content validation & retry logic                         │
│  • Tool declaration management                              │
└─────────────────────────────────────┬───────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────┐
│                      TURN LAYER                              │
│  • Stream event processing                                  │
│  • Tool call extraction                                      │
│  • Citation handling • Thought processing                   │
└─────────────────────────────────────┬───────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────┐
│                  TOOL EXECUTION LAYER                        │
│  • Sequential tool execution                                 │
│  • User confirmation flow                                    │
│  • Policy enforcement                                        │
└─────────────────────────────────────┬───────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────┐
│                  EXTERNAL SERVICES                           │
│  • Gemini API • Vertex AI • Code Assist                     │
│  • MCP Servers • Web Services • Telemetry                   │
└─────────────────────────────────────────────────────────────┘
```

See [Architecture Diagram](./diagrams/architecture-diagram.html) for interactive visualization.

## 🛠️ Technology Stack

**Core Technologies:**
- TypeScript 5.3+ with ES2022 target
- Node.js ≥20 with ES Modules
- React with Ink (terminal rendering)
- Vitest (testing)
- esbuild (bundling)

**Key Libraries:**
- `@google/genai` - Gemini API client
- `@modelcontextprotocol/sdk` - MCP integration
- OpenTelemetry - Observability
- node-pty - Pseudo-terminal
- tree-sitter - Code parsing
- Zod - Schema validation

## 📊 Project Statistics

- **5** NPM packages in monorepo
- **30+** built-in slash commands
- **15+** built-in tools
- **100+** configuration settings
- **4-tier** configuration hierarchy
- **6-layer** agent harness architecture

## 🔍 Key Components

### Agent Harness
- **GeminiClient** - Main orchestrator for multi-turn conversations
- **GeminiChat** - Conversation history and streaming management
- **Turn** - Individual turn processing and event handling
- **CoreToolScheduler** - Tool execution with confirmations

### Tools System
- **Built-in Tools**: Read, Write, Edit, Shell, Grep, Glob, WebFetch, WebSearch, Git, Todo, Subagent, Memory
- **MCP Integration**: Dynamic tool discovery from MCP servers
- **Policy Engine**: TOML-based access control
- **Tool Registry**: Central tool repository

### Configuration
- **4-Tier Settings**: System defaults → User → Workspace → System overrides
- **Secure Credentials**: Keychain integration for API keys and tokens
- **Environment Variables**: Comprehensive env var support
- **Model Configs**: Alias system with inheritance

### External Integrations
- **Gemini API** via `@google/genai`
- **Code Assist** (Google Cloud Code) with OAuth 2.0
- **Vertex AI** with ADC support
- **MCP Servers** (Stdio/HTTP/SSE transports)
- **VS Code** via MCP-based IDE integration
- **Telemetry** via OpenTelemetry (GCP, OTLP, file, console)

## 🎨 How to Use This Documentation

### For New Contributors
1. Start with [index.html](./index.html) for an overview
2. Review [Architecture Diagram](./diagrams/architecture-diagram.html) to understand the layers
3. Read [Agent Harness Deep Dive](./docs/agent-harness.html) for core concepts
4. Explore specific areas based on your work:
   - UI/Commands → [index.html](./index.html) Component sections
   - API Integration → [API Integration Guide](./docs/api-integration.html)
   - Tools → [Tools System](./docs/tools-system.html)
   - Config → [Configuration Guide](./docs/configuration.html)

### For Architecture Review
1. [Architecture Diagram](./diagrams/architecture-diagram.html) - Complete layer visualization
2. [Data Flow Diagram](./diagrams/data-flow.html) - End-to-end data flow
3. [Agent Harness](./docs/agent-harness.html) - Core orchestration logic

### For API Integration Work
1. [API Integration Guide](./docs/api-integration.html) - All external integrations
2. [Tools System](./docs/tools-system.html) - Tool execution framework

### For Configuration/Settings
1. [Configuration Guide](./docs/configuration.html) - Complete settings reference

## 📖 Additional Resources

- **Main Docs**: `/docs/` directory in repository root
- **README**: Repository root README.md
- **Contributing**: CONTRIBUTING.md
- **GEMINI.md**: Project development guidelines

## 🔧 Viewing the Documentation

### Local Viewing
Simply open `index.html` in any modern web browser:
```bash
# From the architecture directory
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

All documentation is built with vanilla HTML/CSS/JavaScript - no build process required.

### Hosting
To host on a web server:
```bash
# Using Python's built-in HTTP server
python3 -m http.server 8000

# Then visit: http://localhost:8000
```

## 📝 Documentation Maintenance

This documentation was generated through comprehensive codebase analysis. When making significant architectural changes, please update:

1. **Diagrams**: Update architecture-diagram.html for layer changes
2. **Technical Docs**: Update relevant docs/*.html files
3. **Index**: Update index.html stats and component lists
4. **This README**: Update for major structural changes

## 🤝 Contributing to Documentation

To improve this documentation:

1. **Fix Errors**: Submit PRs with corrections
2. **Add Examples**: Add code examples to technical docs
3. **Improve Diagrams**: Enhance visual clarity
4. **Add Sections**: Document undocumented areas

## 📄 License

This documentation is part of the Gemini CLI project and follows the same license (Apache 2.0).

---

**Generated**: 2025-01-16
**Gemini CLI Version**: 0.16.0-nightly
**Documentation Status**: Complete ✅

For questions or feedback about this documentation, please open an issue in the main repository.
