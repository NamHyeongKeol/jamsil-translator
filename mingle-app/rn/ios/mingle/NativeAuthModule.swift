import AuthenticationServices
import Foundation
import React
import UIKit

@objc(NativeAuthModule)
class NativeAuthModule: NSObject, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private struct PendingContext {
        let provider: String
        let startURL: URL
        let resolve: RCTPromiseResolveBlock
        let reject: RCTPromiseRejectBlock
    }

    private static let defaultTimeoutMs = 180_000
    private var pendingContext: PendingContext?
    private var webAuthSession: ASWebAuthenticationSession?
    private var timeoutWorkItem: DispatchWorkItem?

    @objc
    static func requiresMainQueueSetup() -> Bool {
        true
    }

    @objc(startSession:resolver:rejecter:)
    func startSession(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let provider = resolveProvider(options["provider"] as? String)
        guard let provider else {
            reject("native_auth_invalid_provider", "native_auth_invalid_provider", nil)
            return
        }

        let rawStartURL = (options["startUrl"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !rawStartURL.isEmpty else {
            reject("native_auth_missing_start_url", "native_auth_missing_start_url", nil)
            return
        }
        guard let startURL = URL(string: rawStartURL),
              let scheme = startURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else {
            reject("native_auth_invalid_start_url", "native_auth_invalid_start_url", nil)
            return
        }
        guard startURL.path.hasPrefix("/api/native-auth/start") else {
            reject("native_auth_invalid_start_url_path", "native_auth_invalid_start_url_path", nil)
            return
        }

        let timeoutMs = resolveTimeoutMs(options["timeoutMs"])

        DispatchQueue.main.async {
            self.beginSession(
                provider: provider,
                startURL: startURL,
                timeoutMs: timeoutMs,
                resolve: resolve,
                reject: reject
            )
        }
    }

    private func beginSession(
        provider: String,
        startURL: URL,
        timeoutMs: Int,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard pendingContext == nil else {
            reject("native_auth_already_in_flight", "native_auth_already_in_flight", nil)
            return
        }

        pendingContext = PendingContext(
            provider: provider,
            startURL: startURL,
            resolve: resolve,
            reject: reject
        )
        scheduleTimeout(timeoutMs: timeoutMs)

        switch provider {
        case "google":
            startGoogleSession(startURL: startURL)
        case "apple":
            startAppleAuthorization()
        default:
            finishWithError(message: "native_auth_invalid_provider", code: "native_auth_invalid_provider")
        }
    }

    private func startGoogleSession(startURL: URL) {
        let session = ASWebAuthenticationSession(
            url: startURL,
            callbackURLScheme: "mingleauth"
        ) { [weak self] callbackURL, error in
            guard let self else { return }
            if let authError = error as? ASWebAuthenticationSessionError,
               authError.code == .canceledLogin {
                self.finishWithError(message: "native_auth_cancelled", code: "native_auth_cancelled")
                return
            }
            if let error {
                self.finishWithError(
                    message: error.localizedDescription.isEmpty ? "native_auth_failed" : error.localizedDescription,
                    code: "native_auth_failed"
                )
                return
            }
            guard let callbackURL else {
                self.finishWithError(message: "native_auth_missing_callback", code: "native_auth_missing_callback")
                return
            }
            let parsed = self.parseNativeAuthCallback(url: callbackURL)
            guard parsed.provider == "google"
            else {
                self.finishWithError(message: "native_auth_invalid_callback", code: "native_auth_invalid_callback")
                return
            }

            if parsed.status == "success" {
                guard !parsed.bridgeToken.isEmpty else {
                    self.finishWithError(message: "native_auth_missing_bridge_token", code: "native_auth_missing_bridge_token")
                    return
                }
                self.finishWithSuccess(payload: [
                    "provider": parsed.provider,
                    "callbackUrl": parsed.callbackURL,
                    "bridgeToken": parsed.bridgeToken,
                ])
                return
            }

            self.finishWithError(
                message: parsed.message.isEmpty ? "native_auth_failed" : parsed.message,
                code: "native_auth_failed"
            )
        }
        session.presentationContextProvider = self
        if #available(iOS 13.0, *) {
            session.prefersEphemeralWebBrowserSession = false
        }
        webAuthSession = session

        if !session.start() {
            finishWithError(message: "native_auth_start_failed", code: "native_auth_start_failed")
        }
    }

    private func startAppleAuthorization() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let context = pendingContext else { return }
        guard context.provider == "apple" else {
            finishWithError(message: "native_auth_invalid_provider", code: "native_auth_invalid_provider")
            return
        }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            finishWithError(message: "native_auth_invalid_apple_credential", code: "native_auth_invalid_apple_credential")
            return
        }

        let idToken = resolveUTF8String(from: credential.identityToken)
        guard !idToken.isEmpty else {
            finishWithError(message: "native_auth_missing_apple_identity_token", code: "native_auth_missing_apple_identity_token")
            return
        }

        let authorizationCode = resolveUTF8String(from: credential.authorizationCode)
        let callbackURL = resolveSafeCallbackPath(resolveQueryItem(named: "callbackUrl", in: context.startURL))
        let requestId = resolveRequestId(resolveQueryItem(named: "requestId", in: context.startURL))
        let displayName = resolveDisplayName(from: credential.fullName)
        let email = (credential.email ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        exchangeAppleCredential(
            startURL: context.startURL,
            idToken: idToken,
            authorizationCode: authorizationCode,
            callbackURL: callbackURL,
            requestId: requestId,
            name: displayName,
            email: email
        )
    }

    func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        if let authError = error as? ASAuthorizationError,
           authError.code == .canceled {
            finishWithError(message: "native_auth_cancelled", code: "native_auth_cancelled")
            return
        }
        finishWithError(
            message: error.localizedDescription.isEmpty ? "native_auth_failed" : error.localizedDescription,
            code: "native_auth_failed"
        )
    }

    private func exchangeAppleCredential(
        startURL: URL,
        idToken: String,
        authorizationCode: String,
        callbackURL: String,
        requestId: String?,
        name: String,
        email: String
    ) {
        guard let exchangeURL = buildAppleExchangeURL(startURL: startURL) else {
            finishWithError(message: "native_auth_invalid_start_url", code: "native_auth_invalid_start_url")
            return
        }

        var body: [String: Any] = [
            "idToken": idToken,
            "authorizationCode": authorizationCode,
            "callbackUrl": callbackURL,
        ]
        if let requestId {
            body["requestId"] = requestId
        }
        if !name.isEmpty {
            body["name"] = name
        }
        if !email.isEmpty {
            body["email"] = email
        }

        let bodyData: Data
        do {
            bodyData = try JSONSerialization.data(withJSONObject: body, options: [])
        } catch {
            finishWithError(message: "native_auth_invalid_request_body", code: "native_auth_invalid_request_body")
            return
        }

        var request = URLRequest(url: exchangeURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
        request.httpBody = bodyData

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                DispatchQueue.main.async {
                    self.finishWithError(
                        message: error.localizedDescription.isEmpty ? "native_auth_failed" : error.localizedDescription,
                        code: "native_auth_failed"
                    )
                }
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                DispatchQueue.main.async {
                    self.finishWithError(message: "native_auth_invalid_response", code: "native_auth_invalid_response")
                }
                return
            }

            let json = self.resolveJsonObject(data: data)
            let status = (json["status"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let message = (json["message"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

            guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
                DispatchQueue.main.async {
                    self.finishWithError(
                        message: message.isEmpty ? "native_auth_failed" : message,
                        code: "native_auth_failed"
                    )
                }
                return
            }

            guard status == "success" else {
                DispatchQueue.main.async {
                    self.finishWithError(
                        message: message.isEmpty ? "native_auth_failed" : message,
                        code: "native_auth_failed"
                    )
                }
                return
            }

            let resolvedCallbackURL = resolveSafeCallbackPath(
                (json["callbackUrl"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            )
            let bridgeToken = (json["bridgeToken"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !bridgeToken.isEmpty else {
                DispatchQueue.main.async {
                    self.finishWithError(message: "native_auth_missing_bridge_token", code: "native_auth_missing_bridge_token")
                }
                return
            }

            DispatchQueue.main.async {
                self.finishWithSuccess(payload: [
                    "provider": "apple",
                    "callbackUrl": resolvedCallbackURL,
                    "bridgeToken": bridgeToken,
                ])
            }
        }.resume()
    }

    private func buildAppleExchangeURL(startURL: URL) -> URL? {
        guard var components = URLComponents(url: startURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = "/api/native-auth/apple/exchange"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private func resolveJsonObject(data: Data?) -> [String: Any] {
        guard let data, !data.isEmpty else { return [:] }
        let object = try? JSONSerialization.jsonObject(with: data, options: [])
        return object as? [String: Any] ?? [:]
    }

    private func resolveDisplayName(from nameComponents: PersonNameComponents?) -> String {
        guard let nameComponents else { return "" }
        let givenName = (nameComponents.givenName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let familyName = (nameComponents.familyName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return [givenName, familyName]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func parseNativeAuthCallback(url: URL) -> (provider: String, callbackURL: String, bridgeToken: String, status: String, message: String) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "mingleauth",
              components.host?.lowercased() == "auth"
        else {
            return (provider: "", callbackURL: "/", bridgeToken: "", status: "error", message: "native_auth_invalid_callback")
        }

        let provider = resolveProvider(resolveQueryItem(named: "provider", in: url)) ?? ""
        let status = resolveQueryItem(named: "status", in: url).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let callbackURL = resolveSafeCallbackPath(resolveQueryItem(named: "callbackUrl", in: url))
        let bridgeToken = resolveQueryItem(named: "token", in: url).trimmingCharacters(in: .whitespacesAndNewlines)
        let message = resolveQueryItem(named: "message", in: url).trimmingCharacters(in: .whitespacesAndNewlines)

        if status == "success" {
            return (provider: provider, callbackURL: callbackURL, bridgeToken: bridgeToken, status: "success", message: "")
        }

        return (
            provider: provider,
            callbackURL: callbackURL,
            bridgeToken: "",
            status: "error",
            message: message.isEmpty ? "native_auth_failed" : message
        )
    }

    private func scheduleTimeout(timeoutMs: Int) {
        timeoutWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.pendingContext != nil else { return }
            self.webAuthSession?.cancel()
            self.webAuthSession = nil
            self.finishWithError(message: "native_auth_timeout", code: "native_auth_timeout")
        }
        timeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: workItem)
    }

    private func resolveTimeoutMs(_ rawValue: Any?) -> Int {
        let number: Int
        if let numeric = rawValue as? NSNumber {
            number = numeric.intValue
        } else if let stringValue = rawValue as? String,
                  let parsed = Int(stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) {
            number = parsed
        } else {
            return Self.defaultTimeoutMs
        }

        if number <= 0 {
            return Self.defaultTimeoutMs
        }
        return min(max(number, 10_000), 300_000)
    }

    private func finishWithSuccess(payload: [String: Any]) {
        guard let context = pendingContext else { return }
        pendingContext = nil
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        webAuthSession = nil
        context.resolve(payload)
    }

    private func finishWithError(message: String, code: String) {
        guard let context = pendingContext else { return }
        pendingContext = nil
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        webAuthSession = nil
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        context.reject(code, trimmedMessage.isEmpty ? "native_auth_failed" : trimmedMessage, nil)
    }

    private func resolvePresentationAnchor() -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .sorted { lhs, rhs in
                lhs.activationState.rawValue > rhs.activationState.rawValue
            }

        for scene in scenes {
            if let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) {
                return keyWindow
            }
            if let firstWindow = scene.windows.first {
                return firstWindow
            }
        }

        return ASPresentationAnchor()
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        resolvePresentationAnchor()
    }

    func presentationAnchor(for _: ASAuthorizationController) -> ASPresentationAnchor {
        resolvePresentationAnchor()
    }
}

private func resolveQueryItem(named name: String, in url: URL) -> String {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return ""
    }
    return components.queryItems?.first(where: { $0.name == name })?.value ?? ""
}

private func resolveRequestId(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let pattern = "^[A-Za-z0-9_-]{12,128}$"
    guard trimmed.range(of: pattern, options: .regularExpression) != nil else {
        return nil
    }
    return trimmed
}

private func resolveSafeCallbackPath(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "/" }
    guard trimmed.hasPrefix("/") else { return "/" }
    guard !trimmed.hasPrefix("//") else { return "/" }
    return trimmed
}

private func resolveProvider(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized == "apple" || normalized == "google" {
        return normalized
    }
    return nil
}

private func resolveUTF8String(from data: Data?) -> String {
    guard let data, !data.isEmpty else { return "" }
    if let utf8 = String(data: data, encoding: .utf8) {
        return utf8.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return data.base64EncodedString()
}
