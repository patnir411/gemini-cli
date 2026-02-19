/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

/// Client for consuming Server-Sent Events (SSE) from the backend.
/// Uses URLSessionDataDelegate to receive incremental streaming data.
class SSEClient: NSObject, URLSessionDataDelegate {
    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var buffer = ""

    var onEvent: ((StreamEvent) -> Void)?
    var onComplete: (() -> Void)?
    var onError: ((Error) -> Void)?

    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300  // 5 minutes for long generations
        config.timeoutIntervalForResource = 600
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    /// Start streaming by sending a POST request and consuming SSE events.
    func connect(url: URL, body: Data, token: String) {
        disconnect()

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = body

        task = session.dataTask(with: request)
        task?.resume()
    }

    /// Cancel the active stream.
    func disconnect() {
        task?.cancel()
        task = nil
        buffer = ""
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        parseEvents()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error = error {
            // URLError.cancelled is expected when we call disconnect()
            if (error as? URLError)?.code == .cancelled { return }
            DispatchQueue.main.async { [weak self] in
                self?.onError?(error)
            }
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.onComplete?()
            }
        }
    }

    // MARK: - SSE Parsing

    /// Parse SSE events from the buffer.
    /// SSE format: blocks separated by double newlines.
    /// Each block has lines like "event: name" and "data: payload".
    private func parseEvents() {
        let blocks = buffer.components(separatedBy: "\n\n")

        // The last element may be an incomplete block; keep it in the buffer
        buffer = blocks.last ?? ""

        for block in blocks.dropLast() {
            var eventName = "message"
            var eventData = ""

            for line in block.components(separatedBy: "\n") {
                if line.hasPrefix("event: ") {
                    eventName = String(line.dropFirst(7))
                } else if line.hasPrefix("data: ") {
                    if !eventData.isEmpty { eventData += "\n" }
                    eventData += String(line.dropFirst(6))
                } else if line.hasPrefix(": ") || line == ":" {
                    // Comment line (keepalive), skip
                    continue
                }
            }

            if !eventData.isEmpty {
                let event = StreamEvent(event: eventName, data: eventData)
                DispatchQueue.main.async { [weak self] in
                    self?.onEvent?(event)
                }
            }
        }
    }
}
