# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Workflow

```bash
# Install dependencies (run after cloning)
npm install

# Build all packages
npm run build

# Build everything including sandbox and vscode extension
npm run build:all

# Start CLI from source (after building)
npm start

# Run in debug mode
npm run debug

# Full validation before submitting changes (CRITICAL)
npm run preflight
```

### Testing

```bash
# Run all unit tests
npm run test

# Run integration tests (requires npm run bundle first)
npm run bundle && npm run test:e2e

# Run specific integration test files
npm run test:e2e list_directory write_file

# Run single test by name
npm run test:e2e -- --test-name-pattern "test name"

# Deflake new integration tests (run 5+ times before committing)
npm run deflake -- --runs=5 --command="npm run test:e2e -- -- --test-name-pattern 'test-name'"

# Run all integration tests across sandbox environments
npm run test:integration:all
```

### Code Quality

```bash
# Lint code
npm run lint

# Auto-fix lint issues and format
npm run lint:fix

# Format code with Prettier
npm run format

# Type check
npm run typecheck
```

## Architecture Overview

### Monorepo Structure

This is a TypeScript/Node.js monorepo with workspaces in `packages/`:

- **`packages/cli`**: Frontend - handles user input, display rendering, CLI configuration, and interactive UI using React/Ink
- **`packages/core`**: Backend - orchestrates Gemini API interactions, tool execution, agent system, MCP servers, and session management
- **`packages/test-utils`**: Shared testing utilities for creating temporary file systems
- **`packages/vscode-ide-companion`**: VS Code extension that pairs with Gemini CLI
- **`packages/a2a-server`**: Experimental A2A server implementation

### Request Flow

1. User input → `packages/cli` processes command
2. `packages/cli` → sends request to `packages/core`
3. `packages/core` → constructs prompt with context, sends to Gemini API
4. Gemini API → returns response (may request tool use)
5. Tool execution → user approval required for write/execute operations, read-only operations may auto-approve
6. Tool results → sent back to Gemini API for final response
7. Response → flows back through `packages/core` to `packages/cli` for display

### Key Systems

**Tools System** (`packages/core/src/tools/`):
- Extends Gemini model capabilities for file system, shell, web operations
- Tool registry manages registration and execution
- MCP (Model Context Protocol) support for custom tool integrations
- Read-only vs modifying tool distinctions for approval flow

**Agents System** (`packages/core/src/agents/`):
- Specialized subagents for complex tasks (codebase investigation, etc.)
- Agent executor handles lifecycle and tool wrapping
- Agent registry for discovery and invocation

**Hooks System** (`packages/core/src/hooks/`):
- Extensible event system for tool calls, user prompts, etc.
- Configured in settings, executed as shell commands

**Policy Engine** (`packages/core/src/policy/`):
- Controls execution permissions and sandboxing
- Trusted folders configuration
- File operation filtering

## React/Ink UI Development

The CLI uses **Ink** (React for terminal UIs). All UI components are in `packages/cli/src/ui/`:

- Use functional components with hooks only (no class components)
- Test with `ink-testing-library` using `render()` and `lastFrame()`
- Follow React best practices from GEMINI.md
- Enable React DevTools: `DEV=true npm start` then run `npx react-devtools@4.28.5`

## Testing Requirements

**Framework**: Vitest for all tests
**File Location**: Co-locate tests with source (`*.test.ts`, `*.test.tsx`)

**Critical Test Practices**:
- Mock ES modules: `vi.mock('module-name', async (importOriginal) => { ... })`
- Place critical mocks (os, fs) at top of file before imports
- Use `vi.hoisted()` for mock functions needed in factory
- Always `vi.resetAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`
- For integration tests: always call `await rig.cleanup()` at end

**Integration Test Requirements**:
- Run `npm run bundle` before integration tests
- Deflake new tests 5+ times before submission
- Use `KEEP_OUTPUT=true` and `VERBOSE=true` for debugging
- Integration tests create unique directories in `.integration-tests/`

## Import Rules

Pay attention to import paths - ESLint enforces restrictions on relative imports between packages. Import from package names (`@google/gemini-cli-core`) not relative paths when crossing package boundaries.

## Sandboxing

**Development Setup**: Set `GEMINI_SANDBOX=true` in `~/.env` and ensure Docker/Podman available

**macOS Seatbelt**: Uses `sandbox-exec` with profiles in `packages/cli/src/utils/sandbox-macos-*.sb`
- Default: `permissive-open` (restricts writes to project, allows network)
- Switch: `SEATBELT_PROFILE=restrictive-closed` (denies all by default)

**Container Sandboxing**: `GEMINI_SANDBOX=docker` or `podman`
- Build sandbox: `npm run build:sandbox` or `npm run build:all`
- Custom sandbox: Create `.gemini/sandbox.Dockerfile` and `.gemini/sandbox.bashrc`

**Debugging in Sandbox**: `DEBUG=1 gemini`

## Development Tracing

Enable detailed OpenTelemetry traces for debugging:

```bash
# Start telemetry server (Genkit UI or Jaeger)
npm run telemetry -- --target=genkit  # http://localhost:4000
# OR
npm run telemetry -- --target=local   # Jaeger at http://localhost:16686

# Run with tracing enabled
GEMINI_DEV_TRACING=true gemini
```

Instrument code:
```typescript
import { runInDevTraceSpan } from '@google/gemini-cli-core';

await runInDevTraceSpan({ name: 'operation-name' }, async ({ metadata }) => {
  metadata.input = { key: 'value' };
  const result = await operation();
  metadata.output = result;
  return result;
});
```

## Build System

**Key Scripts**:
- `scripts/build.js`: Orchestrates package builds
- `scripts/build_package.js`: Individual package builder
- `scripts/build_sandbox.js`: Container image builder
- `esbuild.config.js`: Bundle configuration for distribution

**Entry Point**: `bundle/gemini.js` (generated by `npm run bundle`)

## Documentation

- Docs in `/docs` directory, organized by `docs/sidebar.json`
- Follow [Google Developer Documentation Style Guide](https://developers.google.com/style)
- Update docs for any user-facing changes
- Auto-generate settings docs: `npm run docs:settings`
- Auto-generate keybindings docs: `npm run docs:keybindings`

## Pre-commit Validation

**ALWAYS run before submitting PR**: `npm run preflight`

This runs:
1. Clean build (`npm run build`)
2. All tests (`npm run test:ci`)
3. Linting (`npm run lint:ci`)
4. Type checking (`npm run typecheck`)
5. Formatting (`npm run format`)

## Node Version

- **Development**: Use Node.js `~20.19.0` (nvm recommended) due to dependency constraints
- **Production**: Any Node.js `>=20` supported
