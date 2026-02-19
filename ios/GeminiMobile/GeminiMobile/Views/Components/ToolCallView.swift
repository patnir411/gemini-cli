/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

struct ToolCallView: View {
    let toolCall: ToolCallInfo

    var body: some View {
        HStack(spacing: 8) {
            // Status indicator
            Group {
                switch toolCall.status {
                case .running:
                    ProgressView()
                        .scaleEffect(0.7)
                case .completed:
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                case .failed:
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.red)
                }
            }
            .frame(width: 20, height: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(toolCall.name)
                    .font(.caption.monospaced())
                    .bold()

                if !toolCall.arguments.isEmpty {
                    Text(toolCall.arguments.map { "\($0.key): \($0.value)" }.joined(separator: ", "))
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if let result = toolCall.result {
                    Text(result)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }

            Spacer()
        }
        .padding(10)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
