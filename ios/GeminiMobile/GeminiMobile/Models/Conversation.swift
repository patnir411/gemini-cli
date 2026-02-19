/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

    @Relationship(deleteRule: .cascade, inverse: \Message.conversation)
    var messages: [Message] = []

    init(id: String, title: String, model: String = "gemini-2.5-pro") {
        self.id = id
        self.title = title
        self.createdAt = Date()
        self.model = model
    }
}
