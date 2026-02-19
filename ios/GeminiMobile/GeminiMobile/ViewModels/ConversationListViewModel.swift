/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI
import SwiftData

/// Manages the conversation list state and server synchronization.
@Observable
class ConversationListViewModel {
    var isCreating = false
    var isRefreshing = false
    var error: String?

    private let apiClient: APIClient
    private let modelContext: ModelContext

    init(apiClient: APIClient, modelContext: ModelContext) {
        self.apiClient = apiClient
        self.modelContext = modelContext
    }

    /// Create a new conversation on the backend and add it to local storage.
    func createConversation() async -> Conversation? {
        isCreating = true
        defer { isCreating = false }

        do {
            let meta = try await apiClient.createConversation()
            let conversation = Conversation(id: meta.id, title: meta.title, model: meta.model)
            modelContext.insert(conversation)
            try modelContext.save()
            return conversation
        } catch {
            self.error = "Failed to create conversation: \(error.localizedDescription)"
            return nil
        }
    }

    /// Delete a conversation from both backend and local storage.
    func deleteConversation(_ conversation: Conversation) {
        Task {
            try? await apiClient.deleteConversation(conversation.id)
        }
        modelContext.delete(conversation)
        try? modelContext.save()
    }

    /// Sync the local conversation list with the backend.
    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let remoteConversations = try await apiClient.listConversations()

            for meta in remoteConversations {
                // Check if conversation already exists locally
                let descriptor = FetchDescriptor<Conversation>(
                    predicate: #Predicate { $0.id == meta.id }
                )
                let existing = try modelContext.fetch(descriptor)

                if existing.isEmpty {
                    let conv = Conversation(id: meta.id, title: meta.title, model: meta.model)
                    conv.summary = meta.summary
                    modelContext.insert(conv)
                } else if let conv = existing.first {
                    conv.summary = meta.summary
                    conv.title = meta.title
                }
            }

            try modelContext.save()
        } catch {
            self.error = "Failed to refresh: \(error.localizedDescription)"
        }
    }
}
