/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import SwiftData

@Model
class Message: Identifiable {
    @Attribute(.unique) var id: String
    var role: String   // "user", "assistant", "tool", "thought"
    var content: String
    var createdAt: Date
    var isStreaming: Bool = false

    var conversation: Conversation?

    init(id: String = UUID().uuidString, role: String, content: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

// MARK: - Supporting Types

struct ToolCallInfo: Codable, Identifiable {
    var id: String { name }
    let name: String
    let arguments: [String: String]
    let status: ToolStatus
    let result: String?

    enum ToolStatus: String, Codable {
        case running
        case completed
        case failed
    }
}

struct TokenUsage: Codable {
    let inputTokens: Int
    let outputTokens: Int
    let cachedTokens: Int?
}
