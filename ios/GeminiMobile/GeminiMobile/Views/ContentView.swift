/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

/// Root view that switches between auth and main app.
struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if appState.isLoading {
                ProgressView("Loading...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if appState.isAuthenticated {
                ConversationListView()
            } else {
                SignInView()
            }
        }
    }
}

struct SignInView: View {
    @Environment(AppState.self) private var appState
    @State private var isSigningIn = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "sparkles")
                .font(.system(size: 64))
                .foregroundStyle(.blue)

            Text("Gemini Mobile")
                .font(.largeTitle.bold())

            Text("AI-powered coding assistant\nin your pocket")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer()

            Button(action: signIn) {
                HStack {
                    if isSigningIn {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "person.crop.circle.fill")
                    }
                    Text("Sign in with Google")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(.blue)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isSigningIn)
            .padding(.horizontal, 40)

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()
                .frame(height: 60)
        }
    }

    private func signIn() {
        isSigningIn = true
        error = nil
        Task {
            do {
                try await appState.signIn()
            } catch {
                self.error = error.localizedDescription
            }
            isSigningIn = false
        }
    }
}
