/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

/// Handles authentication via Firebase Auth / Google Sign-In.
///
/// Integration steps:
/// 1. Add Firebase SDK via Swift Package Manager
/// 2. Add GoogleService-Info.plist to the project
/// 3. Enable Google Sign-In in Firebase Console
/// 4. Replace the placeholder methods below with real Firebase Auth calls
class AuthService {
    private let keychainKey = "com.google.gemini-mobile.auth-token"

    /// The current Firebase ID token, if authenticated.
    var currentToken: String? {
        return KeychainHelper.read(key: keychainKey)
    }

    /// Sign in with Google via Firebase Auth.
    /// Returns the Firebase ID token for API authentication.
    func signInWithGoogle() async throws -> String {
        // TODO: Replace with actual Firebase Auth implementation:
        //
        // 1. Present Google Sign-In UI:
        //    let result = try await GIDSignIn.sharedInstance.signIn(
        //        withPresenting: rootViewController
        //    )
        //
        // 2. Get Firebase credential:
        //    let credential = GoogleAuthProvider.credential(
        //        withIDToken: result.user.idToken!.tokenString,
        //        accessToken: result.user.accessToken.tokenString
        //    )
        //
        // 3. Sign in to Firebase:
        //    let authResult = try await Auth.auth().signIn(with: credential)
        //
        // 4. Get ID token:
        //    let token = try await authResult.user.getIDToken()
        //
        // 5. Store and return:
        //    KeychainHelper.save(key: keychainKey, value: token)
        //    return token

        // Placeholder for development
        let devToken = "dev-token-\(UUID().uuidString)"
        KeychainHelper.save(key: keychainKey, value: devToken)
        return devToken
    }

    /// Sign out and clear stored credentials.
    func signOut() {
        KeychainHelper.delete(key: keychainKey)
        // TODO: Also call:
        // try? Auth.auth().signOut()
        // GIDSignIn.sharedInstance.signOut()
    }

    /// Refresh the Firebase ID token if it's expired.
    func refreshTokenIfNeeded() async throws -> String {
        // TODO: Replace with:
        // guard let user = Auth.auth().currentUser else { throw AuthError.notSignedIn }
        // let token = try await user.getIDToken(forcingRefresh: true)
        // KeychainHelper.save(key: keychainKey, value: token)
        // return token

        return currentToken ?? ""
    }
}
