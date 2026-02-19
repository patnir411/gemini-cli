/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

/// Represents a parsed Server-Sent Event from the backend
struct StreamEvent {
    let event: String   // "token", "tool-call", "thought", "done", "error"
    let data: String    // Raw JSON string

    /// Parse the JSON data into a dictionary
    var parsedData: [String: Any]? {
        guard let jsonData = data.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
    }
}

// MARK: - Response models for JSON decoding

struct ConversationMeta: Codable, Identifiable {
    let id: String
    let title: String
    let model: String
    let createdAt: String
    var lastMessageAt: String?
    var messageCount: Int?
    var summary: String?
}

struct ConversationDetail: Codable {
    let metadata: ConversationMeta
    let messages: [MessageDTO]
}

struct MessageDTO: Codable, Identifiable {
    let id: String
    let role: String
    let content: String
    let createdAt: String
}

struct AppSettings: Codable {
    var model: String?
    var approvalMode: String?
}

struct CancelResponse: Codable {
    let cancelled: Bool
}

struct ErrorResponse: Codable {
    let error: String
}
