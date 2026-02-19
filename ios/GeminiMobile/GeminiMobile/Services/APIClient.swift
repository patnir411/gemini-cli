/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

/// HTTP client for communicating with the Gemini Mobile API backend.
class APIClient {
    let baseURL: URL
    var authToken: String = ""

    private let session = URLSession.shared
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    // MARK: - Conversations

    func createConversation(title: String? = nil, model: String? = nil) async throws -> ConversationMeta {
        var body: [String: String] = [:]
        if let title { body["title"] = title }
        if let model { body["model"] = model }
        return try await post("conversations", body: body)
    }

    func listConversations() async throws -> [ConversationMeta] {
        return try await get("conversations")
    }

    func getConversation(_ id: String) async throws -> ConversationDetail {
        return try await get("conversations/\(id)")
    }

    func deleteConversation(_ id: String) async throws {
        let _: EmptyBody = try await delete("conversations/\(id)")
    }

    func cancelConversation(_ id: String) async throws {
        let _: CancelResponse = try await post("conversations/\(id)/cancel", body: EmptyBody())
    }

    // MARK: - Settings

    func getSettings() async throws -> AppSettings {
        return try await get("settings")
    }

    func updateSettings(_ settings: AppSettings) async throws -> AppSettings {
        return try await put("settings", body: settings)
    }

    // MARK: - SSE Message URL (used by SSEClient)

    func messageURL(conversationId: String) -> URL {
        return baseURL
            .appendingPathComponent("conversations")
            .appendingPathComponent(conversationId)
            .appendingPathComponent("messages")
    }

    func messageBody(content: String) throws -> Data {
        return try encoder.encode(["content": content])
    }

    // MARK: - HTTP Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        if data.isEmpty {
            // Handle 204 No Content
            return try decoder.decode(T.self, from: "{}".data(using: .utf8)!)
        }
        return try decoder.decode(T.self, from: data)
    }

    private func checkResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.httpError(statusCode: http.statusCode)
        }
    }
}

// MARK: - Error Types

enum APIError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)
    case decodingError

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .decodingError:
            return "Failed to decode response"
        }
    }
}

struct EmptyBody: Codable {}
