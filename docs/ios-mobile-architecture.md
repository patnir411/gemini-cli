# Gemini CLI -> iOS Mobile App: End-to-End Architecture

## Overview

Turn the Gemini CLI into a native iOS app where:
- The **iOS app** is a SwiftUI chat interface supporting multiple conversations
- A **backend API server** runs on a GCP VM, wrapping `@google/gemini-cli-core` and the existing `a2a-server` infrastructure
- Each conversation maps to a persistent **task/session** on the backend
- Streaming responses are delivered in real-time via Server-Sent Events (SSE)

```
┌─────────────────────┐         HTTPS/SSE          ┌──────────────────────────────┐
│                     │ ◄─────────────────────────► │                              │
│   iOS App (SwiftUI) │                             │   GCP VM (Backend API)       │
│                     │    REST + SSE streaming      │                              │
│  ┌───────────────┐  │                             │  ┌────────────────────────┐  │
│  │ Conversation  │  │  POST /conversations        │  │  Express HTTP Server   │  │
│  │ List View     │──┼──────────────────────────►  │  │  (packages/mobile-api) │  │
│  └───────────────┘  │                             │  └──────────┬─────────────┘  │
│  ┌───────────────┐  │  POST /conversations/:id/   │             │                │
│  │ Chat View     │──┼──────── messages ─────────► │  ┌──────────▼─────────────┐  │
│  │ (streaming)   │  │                             │  │  Session Manager       │  │
│  └───────────────┘  │  GET  /conversations/:id/   │  │  (per-user sessions)   │  │
│  ┌───────────────┐  │       stream (SSE)          │  └──────────┬─────────────┘  │
│  │ Settings      │  │                             │             │                │
│  │ View          │  │                             │  ┌──────────▼─────────────┐  │
│  └───────────────┘  │                             │  │  gemini-cli-core       │  │
│                     │                             │  │  (GeminiClient,        │  │
│  Local Storage:     │                             │  │   ContentGenerator,    │  │
│  - Auth tokens      │                             │  │   ToolScheduler)       │  │
│  - Cached messages   │                             │  └──────────┬─────────────┘  │
│  - Settings          │                             │             │                │
│                     │                             │  ┌──────────▼─────────────┐  │
└─────────────────────┘                             │  │  Gemini API            │  │
                                                    │  │  (gemini-2.5-pro)      │  │
                                                    │  └────────────────────────┘  │
                                                    │                              │
                                                    │  Storage:                    │
                                                    │  - GCS (conversation state)  │
                                                    │  - Redis (session index)     │
                                                    └──────────────────────────────┘
```

---

## Part 1: Backend API Server (`packages/mobile-api`)

### 1.1 Why a New Package

The existing `packages/a2a-server` is designed for agent-to-agent protocol (A2A SDK).
For an iOS app we need a simpler REST + SSE API with:
- User authentication (Firebase Auth / Google Sign-In)
- Multi-conversation management per user
- Persistent conversation storage (GCS or Firestore)
- SSE streaming for real-time token delivery

We create `packages/mobile-api` that imports from `@google/gemini-cli-core` directly,
reusing the same `GeminiClient`, `ContentGenerator`, `ToolScheduler`, and session
management that the CLI uses.

### 1.2 API Design

```
Base URL: https://<your-vm-ip>:8443/api/v1

Authentication:
  All requests require header: Authorization: Bearer <firebase-id-token>

Endpoints:

  POST   /conversations
         Body: { title?: string, model?: string, workspacePath?: string }
         Response: { id, title, createdAt, model }

  GET    /conversations
         Response: [ { id, title, createdAt, lastMessageAt, messageCount, summary } ]

  GET    /conversations/:id
         Response: { id, title, messages: [...], model, createdAt }

  DELETE /conversations/:id
         Response: 204

  POST   /conversations/:id/messages
         Body: { content: string }
         Response: 200 (SSE stream begins)
         Headers: Content-Type: text/event-stream

         SSE Events:
           event: token
           data: { "text": "partial response text" }

           event: tool-call
           data: { "toolName": "read-file", "args": {...}, "status": "running" }

           event: tool-result
           data: { "toolName": "read-file", "result": "...", "status": "completed" }

           event: thought
           data: { "text": "reasoning content..." }

           event: done
           data: { "fullResponse": "...", "usage": { inputTokens, outputTokens } }

           event: error
           data: { "code": "RATE_LIMITED", "message": "..." }

  POST   /conversations/:id/cancel
         Response: 200 { cancelled: true }

  GET    /settings
         Response: { model, approvalMode, ... }

  PUT    /settings
         Body: { model?, approvalMode?, ... }
         Response: 200
```

### 1.3 Server Architecture

```typescript
// packages/mobile-api/src/server.ts

import express from 'express';
import { SessionManager } from './sessions/sessionManager.js';
import { authMiddleware } from './middleware/auth.js';
import { conversationRouter } from './routes/conversations.js';
import { settingsRouter } from './routes/settings.js';

const app = express();
app.use(express.json());
app.use(authMiddleware);          // Firebase Auth token validation

const sessionManager = new SessionManager({
  store: 'firestore',             // or 'gcs' for file-based
  geminiApiKey: process.env.GEMINI_API_KEY,
  defaultModel: 'gemini-2.5-pro',
});

app.use('/api/v1/conversations', conversationRouter(sessionManager));
app.use('/api/v1/settings', settingsRouter);

app.listen(8443, () => console.log('Mobile API running on :8443'));
```

### 1.4 Session Manager (Core Bridge)

This is the key class that bridges the iOS API to gemini-cli-core:

```typescript
// packages/mobile-api/src/sessions/sessionManager.ts

import { GeminiClient } from '@google/gemini-cli-core';
import { createContentGenerator } from '@google/gemini-cli-core';

interface ConversationSession {
  id: string;
  userId: string;
  client: GeminiClient;
  abortController: AbortController;
  metadata: ConversationMetadata;
}

class SessionManager {
  private activeSessions: Map<string, ConversationSession> = new Map();

  async createConversation(userId: string, opts: CreateOpts): Promise<ConversationMetadata> {
    const id = crypto.randomUUID();

    // Create a GeminiClient instance (same one the CLI uses)
    const contentGenerator = await createContentGenerator({
      authType: 'gemini-api-key',
      apiKey: this.config.geminiApiKey,
      model: opts.model ?? this.config.defaultModel,
    });

    const client = new GeminiClient({
      contentGenerator,
      tools: getDefaultTools(),  // reuse CLI tool definitions
      systemInstruction: buildSystemPrompt(opts),
    });

    const session: ConversationSession = {
      id,
      userId,
      client,
      abortController: new AbortController(),
      metadata: { id, title: opts.title ?? 'New Chat', createdAt: new Date() },
    };

    this.activeSessions.set(id, session);
    await this.persistMetadata(session);
    return session.metadata;
  }

  async sendMessage(
    conversationId: string,
    content: string,
    onEvent: (event: StreamEvent) => void
  ): Promise<void> {
    const session = this.activeSessions.get(conversationId);
    if (!session) throw new Error('Session not found');

    // Use the same streaming interface the CLI uses
    const stream = session.client.sendMessage(content, {
      signal: session.abortController.signal,
    });

    for await (const event of stream) {
      switch (event.type) {
        case 'CHUNK':
          onEvent({ event: 'token', data: { text: event.text } });
          break;
        case 'TOOL_CALL':
          onEvent({ event: 'tool-call', data: event.toolCall });
          break;
        case 'TOOL_RESULT':
          onEvent({ event: 'tool-result', data: event.toolResult });
          break;
        case 'THOUGHT':
          onEvent({ event: 'thought', data: { text: event.text } });
          break;
        case 'DONE':
          onEvent({ event: 'done', data: event.summary });
          break;
      }
    }
  }

  async cancelConversation(conversationId: string): Promise<void> {
    const session = this.activeSessions.get(conversationId);
    session?.abortController.abort();
    session.abortController = new AbortController(); // reset for next message
  }
}
```

### 1.5 SSE Streaming Route

```typescript
// packages/mobile-api/src/routes/conversations.ts

router.post('/:id/messages', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.user.uid;  // from auth middleware

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // disable nginx buffering
  });

  // Keep connection alive
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15000);

  try {
    await sessionManager.sendMessage(id, content, (event) => {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});
```

---

## Part 2: GCP VM Deployment

### 2.1 VM Setup

```bash
# Create a GCP Compute Engine VM
gcloud compute instances create gemini-mobile-backend \
  --zone=us-central1-a \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server \
  --metadata=startup-script='#!/bin/bash
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs git
  '

# Firewall rule for HTTPS
gcloud compute firewall-rules create allow-mobile-api \
  --allow tcp:8443 \
  --target-tags=https-server \
  --source-ranges=0.0.0.0/0
```

### 2.2 Docker Deployment

```dockerfile
# Dockerfile (at repo root)
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/mobile-api/package*.json ./packages/mobile-api/

RUN npm ci --workspace=packages/core --workspace=packages/mobile-api

COPY packages/core ./packages/core
COPY packages/mobile-api ./packages/mobile-api

RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/mobile-api

FROM node:20-slim AS runtime

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/mobile-api/dist ./packages/mobile-api/dist
COPY --from=builder /app/packages/mobile-api/package.json ./packages/mobile-api/

ENV NODE_ENV=production
EXPOSE 8443

CMD ["node", "packages/mobile-api/dist/server.js"]
```

### 2.3 Docker Compose (with Redis for session indexing)

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8443:8443"
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
      - GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT}
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    depends_on:
      - api
    restart: unless-stopped

volumes:
  redis-data:
  caddy-data:
```

### 2.4 Caddyfile (automatic TLS)

```
# Caddyfile
your-domain.com {
    reverse_proxy api:8443

    # Allow SSE streaming
    @sse {
        path /api/v1/conversations/*/messages
        method POST
    }
    reverse_proxy @sse api:8443 {
        flush_interval -1
    }
}
```

### 2.5 Systemd Service (alternative to Docker)

```ini
# /etc/systemd/system/gemini-mobile-api.service
[Unit]
Description=Gemini Mobile API Server
After=network.target

[Service]
Type=simple
User=gemini
WorkingDirectory=/opt/gemini-cli
ExecStart=/usr/bin/node packages/mobile-api/dist/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=GEMINI_API_KEY=your-key-here
EnvironmentFile=/opt/gemini-cli/.env

[Install]
WantedBy=multi-user.target
```

---

## Part 3: iOS App (SwiftUI)

### 3.1 Project Structure

```
GeminiMobile/
├── GeminiMobile.xcodeproj
├── GeminiMobile/
│   ├── App/
│   │   ├── GeminiMobileApp.swift          # @main entry point
│   │   └── AppState.swift                 # Global app state (ObservableObject)
│   │
│   ├── Models/
│   │   ├── Conversation.swift             # Conversation data model
│   │   ├── Message.swift                  # Message data model (user/assistant/tool)
│   │   └── StreamEvent.swift              # SSE event parsing models
│   │
│   ├── Services/
│   │   ├── APIClient.swift                # HTTP client (URLSession)
│   │   ├── SSEClient.swift                # Server-Sent Events streaming client
│   │   ├── AuthService.swift              # Firebase Auth / Google Sign-In
│   │   └── PersistenceService.swift       # Local CoreData/SwiftData cache
│   │
│   ├── ViewModels/
│   │   ├── ConversationListViewModel.swift
│   │   ├── ChatViewModel.swift            # Manages streaming state
│   │   └── SettingsViewModel.swift
│   │
│   ├── Views/
│   │   ├── ConversationListView.swift     # Sidebar / list of chats
│   │   ├── ChatView.swift                 # Main chat interface
│   │   ├── MessageBubbleView.swift        # Individual message rendering
│   │   ├── ToolCallView.swift             # Tool execution display
│   │   ├── StreamingTextView.swift        # Animated token-by-token text
│   │   ├── SettingsView.swift             # App settings
│   │   └── Components/
│   │       ├── MarkdownView.swift         # Render markdown responses
│   │       ├── CodeBlockView.swift        # Syntax-highlighted code
│   │       └── InputBarView.swift         # Message input + send button
│   │
│   ├── Utilities/
│   │   ├── KeychainHelper.swift           # Secure token storage
│   │   └── HapticManager.swift
│   │
│   └── Resources/
│       ├── Assets.xcassets
│       └── Info.plist
│
├── GeminiMobileTests/
└── GeminiMobileUITests/
```

### 3.2 Core Data Models

```swift
// Models/Conversation.swift
import Foundation
import SwiftData

@Model
class Conversation: Identifiable {
    @Attribute(.unique) var id: String
    var title: String
    var createdAt: Date
    var lastMessageAt: Date?
    var summary: String?
    var model: String

    @Relationship(deleteRule: .cascade)
    var messages: [Message] = []

    init(id: String, title: String, model: String = "gemini-2.5-pro") {
        self.id = id
        self.title = title
        self.createdAt = Date()
        self.model = model
    }
}

// Models/Message.swift
@Model
class Message: Identifiable {
    @Attribute(.unique) var id: String
    var role: MessageRole
    var content: String
    var createdAt: Date
    var isStreaming: Bool = false
    var toolCalls: [ToolCallInfo]?
    var tokenUsage: TokenUsage?

    var conversation: Conversation?

    enum MessageRole: String, Codable {
        case user
        case assistant
        case tool
        case thought
    }
}

struct ToolCallInfo: Codable {
    let name: String
    let arguments: [String: String]
    let status: ToolStatus
    let result: String?

    enum ToolStatus: String, Codable {
        case running, completed, failed
    }
}

struct TokenUsage: Codable {
    let inputTokens: Int
    let outputTokens: Int
    let cachedTokens: Int?
}
```

### 3.3 SSE Streaming Client

```swift
// Services/SSEClient.swift
import Foundation

/// Parses Server-Sent Events from a streaming HTTP response
class SSEClient: NSObject, URLSessionDataDelegate {
    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var buffer = ""

    var onEvent: ((SSEEvent) -> Void)?
    var onComplete: (() -> Void)?
    var onError: ((Error) -> Void)?

    struct SSEEvent {
        let event: String   // "token", "tool-call", "thought", "done", "error"
        let data: String    // JSON string
    }

    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300  // 5 min for long generations
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func connect(url: URL, body: Data, token: String) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = body

        task = session.dataTask(with: request)
        task?.resume()
    }

    func disconnect() {
        task?.cancel()
        task = nil
    }

    // URLSessionDataDelegate - receive incremental data
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        parseEvents()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        if let error = error {
            DispatchQueue.main.async { self.onError?(error) }
        } else {
            DispatchQueue.main.async { self.onComplete?() }
        }
    }

    private func parseEvents() {
        let lines = buffer.components(separatedBy: "\n\n")
        // Keep the last incomplete chunk in buffer
        buffer = lines.last ?? ""

        for block in lines.dropLast() {
            var eventName = "message"
            var eventData = ""

            for line in block.components(separatedBy: "\n") {
                if line.hasPrefix("event: ") {
                    eventName = String(line.dropFirst(7))
                } else if line.hasPrefix("data: ") {
                    eventData += String(line.dropFirst(6))
                } else if line.hasPrefix(": ") {
                    continue  // comment / keepalive
                }
            }

            if !eventData.isEmpty {
                let event = SSEEvent(event: eventName, data: eventData)
                DispatchQueue.main.async { self.onEvent?(event) }
            }
        }
    }
}
```

### 3.4 Chat ViewModel (Streaming Integration)

```swift
// ViewModels/ChatViewModel.swift
import SwiftUI
import SwiftData

@Observable
class ChatViewModel {
    var conversation: Conversation
    var inputText: String = ""
    var isStreaming: Bool = false
    var streamingText: String = ""
    var activeToolCalls: [ToolCallInfo] = []
    var error: String?

    private let apiClient: APIClient
    private let sseClient = SSEClient()
    private let modelContext: ModelContext

    init(conversation: Conversation, apiClient: APIClient, modelContext: ModelContext) {
        self.conversation = conversation
        self.apiClient = apiClient
        self.modelContext = modelContext
        setupSSEHandlers()
    }

    func sendMessage() {
        let content = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isStreaming else { return }

        inputText = ""
        isStreaming = true
        streamingText = ""
        activeToolCalls = []

        // Add user message locally
        let userMsg = Message(
            id: UUID().uuidString,
            role: .user,
            content: content,
            createdAt: Date()
        )
        userMsg.conversation = conversation
        conversation.messages.append(userMsg)
        try? modelContext.save()

        // Create a placeholder assistant message (will be filled by stream)
        let assistantMsg = Message(
            id: UUID().uuidString,
            role: .assistant,
            content: "",
            createdAt: Date(),
            isStreaming: true
        )
        assistantMsg.conversation = conversation
        conversation.messages.append(assistantMsg)

        // Start SSE streaming
        let url = apiClient.baseURL
            .appendingPathComponent("conversations")
            .appendingPathComponent(conversation.id)
            .appendingPathComponent("messages")

        let body = try! JSONEncoder().encode(["content": content])
        sseClient.connect(url: url, body: body, token: apiClient.authToken)
    }

    func cancelStreaming() {
        sseClient.disconnect()
        isStreaming = false

        // Fire cancel request to backend
        Task {
            try? await apiClient.cancelConversation(conversation.id)
        }
    }

    private func setupSSEHandlers() {
        sseClient.onEvent = { [weak self] event in
            guard let self else { return }
            self.handleSSEEvent(event)
        }
        sseClient.onComplete = { [weak self] in
            self?.finishStreaming()
        }
        sseClient.onError = { [weak self] error in
            self?.error = error.localizedDescription
            self?.finishStreaming()
        }
    }

    private func handleSSEEvent(_ event: SSEClient.SSEEvent) {
        switch event.event {
        case "token":
            if let data = parseJSON(event.data) as? [String: String],
               let text = data["text"] {
                streamingText += text
                updateLastAssistantMessage(content: streamingText)
            }

        case "thought":
            if let data = parseJSON(event.data) as? [String: String],
               let text = data["text"] {
                let thoughtMsg = Message(
                    id: UUID().uuidString, role: .thought,
                    content: text, createdAt: Date()
                )
                thoughtMsg.conversation = conversation
                conversation.messages.append(thoughtMsg)
            }

        case "tool-call":
            if let data = parseJSON(event.data) as? [String: Any],
               let name = data["toolName"] as? String {
                let info = ToolCallInfo(
                    name: name,
                    arguments: (data["args"] as? [String: String]) ?? [:],
                    status: .running,
                    result: nil
                )
                activeToolCalls.append(info)
            }

        case "tool-result":
            if let data = parseJSON(event.data) as? [String: Any],
               let name = data["toolName"] as? String,
               let idx = activeToolCalls.firstIndex(where: { $0.name == name }) {
                activeToolCalls[idx] = ToolCallInfo(
                    name: name,
                    arguments: activeToolCalls[idx].arguments,
                    status: .completed,
                    result: data["result"] as? String
                )
            }

        case "done":
            finishStreaming()

        case "error":
            if let data = parseJSON(event.data) as? [String: String] {
                error = data["message"]
            }
            finishStreaming()

        default:
            break
        }
    }

    private func updateLastAssistantMessage(content: String) {
        if let lastMsg = conversation.messages.last, lastMsg.role == .assistant {
            lastMsg.content = content
        }
    }

    private func finishStreaming() {
        isStreaming = false
        if let lastMsg = conversation.messages.last, lastMsg.role == .assistant {
            lastMsg.isStreaming = false
        }
        conversation.lastMessageAt = Date()
        try? modelContext.save()
    }

    private func parseJSON(_ string: String) -> Any? {
        guard let data = string.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }
}
```

### 3.5 Main Chat View

```swift
// Views/ChatView.swift
import SwiftUI

struct ChatView: View {
    @State var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Messages scroll view
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(viewModel.conversation.messages) { message in
                            MessageBubbleView(message: message)
                                .id(message.id)
                        }

                        // Active tool calls
                        ForEach(viewModel.activeToolCalls, id: \.name) { tool in
                            ToolCallView(toolCall: tool)
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.conversation.messages.count) {
                    if let last = viewModel.conversation.messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input bar
            InputBarView(
                text: $viewModel.inputText,
                isStreaming: viewModel.isStreaming,
                onSend: { viewModel.sendMessage() },
                onCancel: { viewModel.cancelStreaming() }
            )
        }
        .navigationTitle(viewModel.conversation.title)
        .navigationBarTitleDisplayMode(.inline)
        .alert("Error", isPresented: .init(
            get: { viewModel.error != nil },
            set: { if !$0 { viewModel.error = nil } }
        )) {
            Button("OK") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
    }
}
```

### 3.6 Conversation List View

```swift
// Views/ConversationListView.swift
import SwiftUI
import SwiftData

struct ConversationListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Conversation.lastMessageAt, order: .reverse)
    private var conversations: [Conversation]

    @State private var apiClient: APIClient
    @State private var isCreating = false

    var body: some View {
        NavigationSplitView {
            List {
                ForEach(conversations) { conversation in
                    NavigationLink(value: conversation) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(conversation.title)
                                .font(.headline)
                                .lineLimit(1)
                            if let summary = conversation.summary {
                                Text(summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            if let lastMsg = conversation.lastMessageAt {
                                Text(lastMsg, style: .relative)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                .onDelete(perform: deleteConversations)
            }
            .navigationTitle("Conversations")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: createConversation) {
                        Image(systemName: "plus.message")
                    }
                    .disabled(isCreating)
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    NavigationLink(destination: SettingsView()) {
                        Image(systemName: "gear")
                    }
                }
            }
        } detail: {
            // Selected conversation
        }
        .navigationDestination(for: Conversation.self) { conversation in
            ChatView(viewModel: ChatViewModel(
                conversation: conversation,
                apiClient: apiClient,
                modelContext: modelContext
            ))
        }
    }

    private func createConversation() {
        isCreating = true
        Task {
            do {
                let meta = try await apiClient.createConversation(title: nil)
                let conversation = Conversation(id: meta.id, title: meta.title)
                modelContext.insert(conversation)
                try modelContext.save()
            } catch {
                print("Failed to create conversation: \(error)")
            }
            isCreating = false
        }
    }

    private func deleteConversations(at offsets: IndexSet) {
        for index in offsets {
            let conversation = conversations[index]
            Task { try? await apiClient.deleteConversation(conversation.id) }
            modelContext.delete(conversation)
        }
    }
}
```

### 3.7 API Client

```swift
// Services/APIClient.swift
import Foundation

class APIClient {
    let baseURL: URL
    var authToken: String = ""

    private let session = URLSession.shared

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    // MARK: - Conversations

    func createConversation(title: String?, model: String? = nil) async throws -> ConversationMeta {
        var body: [String: String] = [:]
        if let title { body["title"] = title }
        if let model { body["model"] = model }
        return try await post("conversations", body: body)
    }

    func listConversations() async throws -> [ConversationMeta] {
        return try await get("conversations")
    }

    func deleteConversation(_ id: String) async throws {
        try await delete("conversations/\(id)")
    }

    func cancelConversation(_ id: String) async throws {
        let _: EmptyResponse = try await post("conversations/\(id)/cancel", body: [:] as [String: String])
    }

    // MARK: - Settings

    func getSettings() async throws -> AppSettings {
        return try await get("settings")
    }

    func updateSettings(_ settings: AppSettings) async throws {
        let _: AppSettings = try await put("settings", body: settings)
    }

    // MARK: - HTTP Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func delete(_ path: String) async throws {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        let _ = try await session.data(for: request)
    }
}

struct ConversationMeta: Codable {
    let id: String
    let title: String
    let createdAt: Date?
}

struct EmptyResponse: Codable {}

struct AppSettings: Codable {
    var model: String?
    var approvalMode: String?
}
```

---

## Part 4: Authentication Flow

### 4.1 Firebase Auth Setup

```
1. Create Firebase project in GCP Console
2. Enable Google Sign-In as auth provider
3. Download GoogleService-Info.plist -> add to Xcode project
4. Add Firebase SDK via Swift Package Manager
```

### 4.2 Auth Flow

```
iOS App                      Firebase Auth                Backend API
  │                              │                            │
  │──── Google Sign-In ─────────►│                            │
  │◄─── Firebase ID Token ──────│                            │
  │                              │                            │
  │──── API Request + Bearer Token ──────────────────────────►│
  │                              │    verify token with       │
  │                              │◄── Firebase Admin SDK ─────│
  │                              │──── { uid, email } ───────►│
  │◄──── Response ───────────────────────────────────────────│
```

### 4.3 Backend Auth Middleware

```typescript
// packages/mobile-api/src/middleware/auth.ts
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, cert } from 'firebase-admin/app';

initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)),
});

export async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

---

## Part 5: End-to-End Data Flow

### Complete Request Lifecycle

```
1. USER TAPS SEND
   └─► ChatViewModel.sendMessage()
       ├─► Insert user Message into SwiftData (local)
       ├─► Insert placeholder assistant Message (isStreaming=true)
       └─► SSEClient.connect(POST /conversations/:id/messages)

2. BACKEND RECEIVES REQUEST
   └─► authMiddleware validates Firebase token
       └─► conversationRouter handler
           ├─► Set SSE response headers
           └─► sessionManager.sendMessage(conversationId, content, onEvent)
               └─► GeminiClient.sendMessage(content)
                   └─► ContentGenerator.generateContentStream()
                       └─► @google/genai SDK -> Gemini API

3. GEMINI STREAMS RESPONSE
   └─► Each chunk yields from AsyncGenerator
       └─► Backend writes SSE event: "event: token\ndata: {...}\n\n"
           └─► iOS URLSessionDataDelegate receives incremental data
               └─► SSEClient parses events
                   └─► ChatViewModel.handleSSEEvent()
                       └─► Update streamingText -> SwiftUI re-renders

4. TOOL CALLS (if model requests)
   └─► Backend receives tool_call in stream
       ├─► SSE event: "tool-call" -> iOS shows spinner
       └─► ToolScheduler executes tool (file read, shell, etc.)
           └─► SSE event: "tool-result" -> iOS shows result
               └─► Results sent back to Gemini for next turn
                   └─► More token events stream to iOS

5. COMPLETION
   └─► Gemini finishes response
       └─► SSE event: "done" with full response + token usage
           └─► iOS finishes streaming animation
               ├─► Message.isStreaming = false
               ├─► Save to SwiftData
               └─► Update conversation.lastMessageAt

6. PERSISTENCE (parallel)
   Backend: ChatRecordingService saves to ~/.gemini/tmp/chats/
   Backend: ConversationStore persists to Firestore/GCS
   iOS:     SwiftData auto-persists to local SQLite
```

---

## Part 6: Key Design Decisions

### 6.1 Why SSE Instead of WebSockets

| Concern | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server -> Client (sufficient for streaming) | Bidirectional |
| Reconnection | Built-in auto-reconnect | Manual implementation |
| HTTP/2 support | Native multiplexing | Separate connection |
| Load balancer | Standard HTTP routing | Upgrade handling needed |
| Simplicity | Plain HTTP + text | Binary framing protocol |
| iOS support | URLSession delegate | Requires 3rd party lib |

SSE is the right choice here because the primary real-time flow is server-to-client
(streaming tokens). Client-to-server is standard REST (send message, cancel).

### 6.2 Why Not Run Gemini CLI Directly on Device

- gemini-cli-core requires Node.js runtime (not available on iOS)
- Tool execution (shell, file system) needs a full OS environment
- The GCP VM provides the sandboxed environment for code execution
- Gemini API keys stay server-side (more secure)
- VM can run heavier models without draining battery

### 6.3 Offline Support Strategy

- SwiftData provides local persistence of all conversations
- Messages are cached locally after streaming completes
- Conversation list works offline (from cache)
- New messages require connectivity (queued if offline)
- Show clear offline indicator in UI

### 6.4 Multi-User Considerations

- Each user gets isolated conversation sessions on the backend
- Firebase Auth provides user identity
- Conversations stored per-user in Firestore: `users/{uid}/conversations/{id}`
- Session cleanup: idle sessions evicted after 30 minutes
- Rate limiting per user to control Gemini API costs

---

## Part 7: Build & Deploy Checklist

### Backend
- [ ] Create `packages/mobile-api` package in monorepo
- [ ] Implement Express server with auth middleware
- [ ] Implement SessionManager bridging to gemini-cli-core
- [ ] Implement SSE streaming endpoint
- [ ] Implement conversation CRUD endpoints
- [ ] Add Firestore persistence layer
- [ ] Write integration tests
- [ ] Create Dockerfile
- [ ] Set up GCP VM with Docker Compose
- [ ] Configure domain + TLS (Caddy or Cloud Load Balancer)
- [ ] Set up Firebase project + service account

### iOS App
- [ ] Create Xcode project with SwiftUI
- [ ] Add SwiftData models (Conversation, Message)
- [ ] Implement SSEClient for streaming
- [ ] Implement APIClient for REST calls
- [ ] Build ConversationListView
- [ ] Build ChatView with streaming display
- [ ] Build MessageBubbleView with markdown rendering
- [ ] Build ToolCallView for tool execution display
- [ ] Integrate Firebase Auth + Google Sign-In
- [ ] Add Keychain storage for tokens
- [ ] Handle background/foreground transitions
- [ ] Add pull-to-refresh on conversation list
- [ ] Test on device with real backend
- [ ] Submit to TestFlight

---

## Part 8: Cost Estimation

| Component | Monthly Cost (estimated) |
|-----------|------------------------|
| GCP e2-standard-4 VM | ~$100 |
| Gemini 2.5 Pro API (moderate usage) | ~$50-200 |
| Firebase Auth (free tier) | $0 |
| Firestore (free tier for < 50K reads/day) | $0 |
| Domain + TLS (Caddy self-hosted) | $12/year |
| Apple Developer Program | $99/year |
| **Total** | **~$150-300/month** |
