/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

struct MessageBubbleView: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top) {
            if message.role == "user" {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 4) {
                // Role label for non-user messages
                if message.role != "user" {
                    HStack(spacing: 4) {
                        roleIcon
                        Text(roleLabel)
                            .font(.caption2.bold())
                            .foregroundStyle(roleColor)
                    }
                }

                // Message content
                if message.role == "thought" {
                    // Thought messages shown in a collapsible style
                    DisclosureGroup {
                        Text(message.content)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } label: {
                        Text("Thinking...")
                            .font(.caption)
                            .foregroundStyle(.purple)
                    }
                    .padding(10)
                    .background(.purple.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    Text(message.content.isEmpty && message.isStreaming ? " " : message.content)
                        .font(.body)
                        .textSelection(.enabled)
                        .padding(12)
                        .background(bubbleBackground)
                        .foregroundStyle(message.role == "user" ? .white : .primary)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }

                // Streaming indicator
                if message.isStreaming {
                    HStack(spacing: 4) {
                        Circle().fill(.blue).frame(width: 4, height: 4)
                            .opacity(0.8)
                        Circle().fill(.blue).frame(width: 4, height: 4)
                            .opacity(0.5)
                        Circle().fill(.blue).frame(width: 4, height: 4)
                            .opacity(0.3)
                    }
                    .padding(.leading, 8)
                }
            }

            if message.role != "user" {
                Spacer(minLength: 40)
            }
        }
    }

    private var bubbleBackground: Color {
        switch message.role {
        case "user": return .blue
        case "assistant": return Color(.systemGray6)
        case "tool": return Color(.systemGray5)
        default: return Color(.systemGray6)
        }
    }

    private var roleLabel: String {
        switch message.role {
        case "assistant": return "Gemini"
        case "tool": return "Tool"
        case "thought": return "Thinking"
        default: return message.role.capitalized
        }
    }

    private var roleColor: Color {
        switch message.role {
        case "assistant": return .blue
        case "tool": return .orange
        case "thought": return .purple
        default: return .secondary
        }
    }

    @ViewBuilder
    private var roleIcon: some View {
        switch message.role {
        case "assistant":
            Image(systemName: "sparkles")
                .font(.caption2)
                .foregroundStyle(.blue)
        case "tool":
            Image(systemName: "wrench.fill")
                .font(.caption2)
                .foregroundStyle(.orange)
        case "thought":
            Image(systemName: "brain")
                .font(.caption2)
                .foregroundStyle(.purple)
        default:
            EmptyView()
        }
    }
}
