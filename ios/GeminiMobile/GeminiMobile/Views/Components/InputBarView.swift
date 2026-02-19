/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

struct InputBarView: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onCancel: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // Text input
            TextField("Message Gemini...", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...6)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .focused($isFocused)
                .onSubmit {
                    if !isStreaming && !text.trimmingCharacters(in: .whitespaces).isEmpty {
                        onSend()
                    }
                }

            // Send / Cancel button
            Button(action: isStreaming ? onCancel : onSend) {
                Image(systemName: isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(buttonColor)
            }
            .disabled(!isStreaming && text.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private var buttonColor: Color {
        if isStreaming {
            return .red
        }
        return text.trimmingCharacters(in: .whitespaces).isEmpty ? .gray : .blue
    }
}
