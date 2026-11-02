import Foundation
import Security
import LocalAuthentication

struct CageAccountError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

// Secrets stay between the native launcher, macOS Keychain and the loopback
// controller. The web view receives status only, never the device credential.
final class CageAccountDevice: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private let base: URL
    private let ticket: String
    private static let service = "io.github.lee-xeo.claude-cage.account"

    init(entry: URL) throws {
        guard entry.scheme == "http", entry.host == "localhost", let ticket = entry.fragment, !ticket.isEmpty else { throw CageAccountError("本地账户连接无效") }
        var parts = URLComponents(url: entry, resolvingAgainstBaseURL: false)!
        parts.fragment = nil; parts.path = ""; parts.query = nil
        base = parts.url!; self.ticket = ticket
        super.init()
    }
    deinit { session.invalidateAndCancel() }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    private func call(_ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent("api/account" + path))
        if path == "@session" { request.url = base.appendingPathComponent("api/session") }
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        if let body { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw CageAccountError(String(data: data.prefix(512), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "账户操作未完成")
        }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CageAccountError("本地账户响应无效") }
        return value
    }
    private static func query(binding: String, kind: String) -> [String: Any] {
        var result: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: binding + "." + kind]
        if kind == "biometric" {
            result[kSecUseDataProtectionKeychain as String] = true
            result[kSecAttrSynchronizable as String] = false
        }
        return result
    }
    private static func remove(binding: String, kind: String) throws {
        let status = SecItemDelete(query(binding: binding, kind: kind) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CageAccountError("无法移除本机钥匙串记录，请重试") }
    }
    private static func store(_ credential: [String: Any], binding: String, kind: String) throws {
        var item = query(binding: binding, kind: kind)
        item[kSecValueData as String] = try JSONSerialization.data(withJSONObject: credential)
        item[kSecAttrLabel as String] = kind == "biometric" ? "Cage 指纹解锁" : "Cage 记住登录"
        if kind == "biometric" {
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .biometryCurrentSet, &error) else { throw CageAccountError("这台 Mac 无法创建指纹保护的凭据") }
            item[kSecAttrAccessControl as String] = access
        }
        try remove(binding: binding, kind: kind)
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw CageAccountError("macOS 未能保存快捷登录凭据（\(status)），密码登录仍然可用") }
    }
    private static func read(binding: String, kind: String) throws -> [String: Any] {
        var item = query(binding: binding, kind: kind)
        item[kSecReturnData as String] = true; item[kSecMatchLimit as String] = kSecMatchLimitOne
        let context = LAContext()
        context.localizedReason = "解锁你的 Cage 工作空间"
        context.localizedFallbackTitle = ""
        if kind == "automatic" {
            // The login Keychain is local to this Mac and its ACL trusts the
            // signed app. Automatic reopen must never trigger an OS prompt.
            context.interactionNotAllowed = true
        }
        item[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        let status = SecItemCopyMatching(item as CFDictionary, &result)
        if status == errSecUserCanceled { throw CageAccountError("已取消指纹验证，可继续使用密码") }
        guard status == errSecSuccess, let data = result as? Data,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CageAccountError("快捷登录不可用，请使用密码解锁后重新开启") }
        return value
    }
    func handle(operation: String, kind: String?) async throws -> [String: Any] {
        defer { session.invalidateAndCancel() }
        _ = try await call("@session", ["token": ticket])
        let account = try await call("")
        guard let binding = account["device_binding"] as? String, binding.count == 64 else { throw CageAccountError("当前后台不支持快捷登录，请先完成更新") }
        let context = LAContext()
        let biometricAvailable = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        if operation == "status" {
            return ["supported": true, "biometric_available": biometricAvailable]
        }
        guard let kind, ["automatic", "biometric"].contains(kind) else { throw CageAccountError("快捷登录类型无效") }
        switch operation {
        case "enable":
            if kind == "biometric" && !biometricAvailable { throw CageAccountError("请先在 macOS 系统设置中设置 Touch ID") }
            let credential = try await call("/device-enroll", ["kind": kind])
            do { try Self.store(credential, binding: binding, kind: kind) }
            catch {
                _ = try? await call("/device-revoke", ["kind": kind])
                throw error
            }
        case "disable":
            _ = try await call("/device-revoke", ["kind": kind])
            try Self.remove(binding: binding, kind: kind)
        case "unlock":
            // Check persisted manual-lock state before touching the Keychain.
            if kind == "automatic" && account["require_authentication"] as? Bool == true { throw CageAccountError("Cage 已手动锁定，请使用指纹或密码") }
            guard let devices = account["devices"] as? [String: String], let expectedID = devices[kind] else { throw CageAccountError("请先使用密码登录，再开启快捷登录") }
            let credential = try Self.read(binding: binding, kind: kind)
            guard credential["id"] as? String == expectedID else { throw CageAccountError("快捷登录授权已失效，请使用密码") }
            _ = try await call("/device-unlock", ["kind": kind, "credential": credential])
        default: throw CageAccountError("快捷登录操作无效")
        }
        return ["ok": true]
    }
}
