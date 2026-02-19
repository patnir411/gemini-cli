/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

/// Global app state shared across all views.
@Observable
class AppState {
    var isAuthenticated = false
    var isLoading = true
    var serverURL: URL

    let apiClient: APIClient
    let authService: AuthService

    init() {
        // Configure from environment or defaults
        let baseURLString = ProcessInfo.processInfo.environment["API_BASE_URL"]
            ?? "https://localhost:8443/api/v1"
        self.serverURL = URL(string: baseURLString)!
        self.apiClient = APIClient(baseURL: self.serverURL)
        self.authService = AuthService()
    }

    func initialize() {
        Task {
            await checkAuth()
            isLoading = false
        }
    }

    func checkAuth() async {
        if let token = authService.currentToken {
            apiClient.authToken = token
            isAuthenticated = true
        }
    }

    func signIn() async throws {
        let token = try await authService.signInWithGoogle()
        apiClient.authToken = token
        isAuthenticated = true
    }

    func signOut() {
        authService.signOut()
        apiClient.authToken = ""
        isAuthenticated = false
    }
}
