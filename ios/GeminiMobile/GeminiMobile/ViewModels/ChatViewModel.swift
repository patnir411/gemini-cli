/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI
import SwiftData

/// Manages the state for a single conversation chat view.
/// Handles SSE streaming, message management, and tool call display.
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

    // MARK: - Actions

    func sendMessage() {
        let content = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isStreaming else { return }

        inputText = ""
        isStreaming = true
        streamingText = ""
        activeToolCalls = []
        error = nil

        // Add user message to local store
        let userMsg = Message(role: "user", content: content)
        userMsg.conversation = conversation
        conversation.messages.append(userMsg)
        try? modelContext.save()

        // Add placeholder assistant message (filled by streaming)
        let assistantMsg = Message(role: "assistant", content: "")
        assistantMsg.isStreaming = true
        assistantMsg.conversation = conversation
        conversation.messages.append(assistantMsg)

        // Start SSE connection
        let url = apiClient.messageURL(conversationId: conversation.id)
        guard let body = try? apiClient.messageBody(content: content) else {
            error = "Failed to encode message"
            isStreaming = false
            return
        }
        sseClient.connect(url: url, body: body, token: apiClient.authToken)
    }

    func cancelStreaming() {
        sseClient.disconnect()
        isStreaming = false

        Task {
            try? await apiClient.cancelConversation(conversation.id)
        }
    }

    // MARK: - SSE Event Handling

    private func setupSSEHandlers() {
        sseClient.onEvent = { [weak self] event in
            self?.handleSSEEvent(event)
        }
        sseClient.onComplete = { [weak self] in
            self?.finishStreaming()
        }
        sseClient.onError = { [weak self] error in
            self?.error = error.localizedDescription
            self?.finishStreaming()
        }
    }

    private func handleSSEEvent(_ event: StreamEvent) {
        guard let data = event.parsedData else { return }

        switch event.event {
        case "token":
            if let text = data["text"] as? String {
                streamingText += text
                updateLastAssistantMessage(content: streamingText)
            }

        case "thought":
            if let text = data["text"] as? String {
                let thoughtMsg = Message(role: "thought", content: text)
                thoughtMsg.conversation = conversation
                conversation.messages.append(thoughtMsg)
            }

        case "tool-call":
            if let name = data["toolName"] as? String {
                let info = ToolCallInfo(
                    name: name,
                    arguments: (data["args"] as? [String: String]) ?? [:],
                    status: .running,
                    result: nil
                )
                activeToolCalls.append(info)
            }

        case "tool-result":
            if let name = data["toolName"] as? String,
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
            error = data["message"] as? String ?? "Unknown error"
            finishStreaming()

        default:
            break
        }
    }

    private func updateLastAssistantMessage(content: String) {
        if let lastMsg = conversation.messages.last, lastMsg.role == "assistant" {
            lastMsg.content = content
        }
    }

    private func finishStreaming() {
        isStreaming = false
        if let lastMsg = conversation.messages.last, lastMsg.role == "assistant" {
            lastMsg.isStreaming = false
        }
        conversation.lastMessageAt = Date()
        try? modelContext.save()
    }
}
