/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI
import SwiftData

struct ConversationListView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppState.self) private var appState

    @Query(sort: \Conversation.createdAt, order: .reverse)
    private var conversations: [Conversation]

    @State private var viewModel: ConversationListViewModel?
    @State private var selectedConversation: Conversation?
    @State private var navigateToChat = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(conversations) { conversation in
                    Button {
                        selectedConversation = conversation
                        navigateToChat = true
                    } label: {
                        ConversationRow(conversation: conversation)
                    }
                    .tint(.primary)
                }
                .onDelete(perform: deleteConversations)
            }
            .navigationTitle("Conversations")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: createConversation) {
                        Image(systemName: "plus.message")
                    }
                    .disabled(viewModel?.isCreating ?? false)
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Menu {
                        Button("Settings", systemImage: "gear") {
                            // Navigate to settings
                        }
                        Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            appState.signOut()
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .navigationDestination(isPresented: $navigateToChat) {
                if let conversation = selectedConversation {
                    ChatView(viewModel: ChatViewModel(
                        conversation: conversation,
                        apiClient: appState.apiClient,
                        modelContext: modelContext
                    ))
                }
            }
            .refreshable {
                await viewModel?.refresh()
            }
            .overlay {
                if conversations.isEmpty {
                    ContentUnavailableView(
                        "No Conversations",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("Tap + to start a new conversation with Gemini")
                    )
                }
            }
            .onAppear {
                if viewModel == nil {
                    viewModel = ConversationListViewModel(
                        apiClient: appState.apiClient,
                        modelContext: modelContext
                    )
                }
            }
        }
    }

    private func createConversation() {
        Task {
            if let conversation = await viewModel?.createConversation() {
                selectedConversation = conversation
                navigateToChat = true
            }
        }
    }

    private func deleteConversations(at offsets: IndexSet) {
        for index in offsets {
            viewModel?.deleteConversation(conversations[index])
        }
    }
}

// MARK: - Row View

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(conversation.title)
                .font(.headline)
                .lineLimit(1)

            if let summary = conversation.summary {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            HStack {
                Text(conversation.model)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.blue.opacity(0.1))
                    .clipShape(Capsule())

                Spacer()

                if let lastMsg = conversation.lastMessageAt {
                    Text(lastMsg, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
