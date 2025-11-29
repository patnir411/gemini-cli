# Gemini CLI Real-Time Monitor

Complete real-time visualization with DAG, session history, and export.

## Usage

```bash
gemini-viz --model=gemini-3-pro-preview
```

Everything auto-starts in ONE session:
- Visualization server
- Dashboard at http://localhost:8080
- Gemini CLI with monitoring
- Exit gemini → everything stops

## Features

### 🔄 Hierarchical DAG Visualization
- Shows full execution hierarchy
- Turns → Agents → Subagents → Tools
- Parallel execution visible
- Click nodes for details (args, results, timing)
- Color-coded by status (running/success/error)

### 💎 Real-Time Metrics
- Token usage with breakdown (prompt, output, cached, thoughts)
- Turn counting (X/100)
- Tool execution timeline
- Performance metrics (latency, events/sec, memory)
- Model tracking

### 📚 Session History
- List all past sessions from ~/.gemini/
- Click to replay any session
- Timeline scrubber showing progress
- Switch between Live and Replay modes

### 💾 Export
- Export current session to JSON
- Includes: events, DAG, metrics, messages
- One-click download

### 📡 Event Stream
- Full event log with expandable JSON
- Click any event to see complete payload
- Last 100 events kept

## What You'll See

**When you run gemini-viz:**
```
🚀 Starting visualization server...
✅ Server ready on port 8080
🌐 Opening dashboard...
🤖 Starting Gemini CLI...

[Gemini CLI] Connected to visualization server at ws://localhost:9333
```

**Dashboard shows:**
- Model name (e.g., gemini-3-pro-preview) ✅
- Hierarchical DAG with all agents and tools ✅
- Real-time token and turn tracking ✅
- Past sessions list (clickable) ✅
- Export button for current session ✅

## Structure

```
realtime-vis/
├── src/              # Backend (TypeScript)
│   ├── bridge/       # EventAggregator, StateTracker, DAGBuilder, SessionManager
│   ├── server/       # WebSocket + HTTP with session API
│   └── types/        # TypeScript definitions
├── public/           # Dashboard
│   ├── index.html    # Main UI
│   ├── css/          # Styles
│   └── js/           # dashboard-working.js, dag-viewer.js, session-viewer.js
└── README.md         # This file
```

## Troubleshooting

**Model shows "-"?**
- Restart gemini-viz (model detection now fixed)

**DAG not showing?**
- Check console for "[DAG] viewer initialized"
- Look for dagGraph in state updates

**No past sessions?**
- Sessions load from ~/.gemini/tmp/[PROJECT_HASH]/chats/
- Only shows sessions for current project

**Export not working?**
- Click "Export Session" button in header
- Downloads JSON automatically
