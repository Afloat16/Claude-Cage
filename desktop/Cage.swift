import Cocoa
import WebKit

@main
final class CageApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var expectedPort = 0
    private var allowQuit = false
    private var loading: NSTextField!
    private var retry: NSButton!
    private var backdrop: NSVisualEffectView!

    static func main() {
        let app = NSApplication.shared
        let delegate = CageApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let appearance = UserDefaults.standard.dictionary(forKey: "cage.windowAppearance") ?? [:]
        let mode = appearance["mode"] as? String ?? "system"
        NSApp.appearance = mode == "system" ? nil : NSAppearance(named: mode == "dark" ? .darkAqua : .aqua)
        makeMenus()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Cage"
        window.titlebarAppearsTransparent = false
        window.backgroundColor = NSColor(srgbRed: 247.0/255, green: 247.0/255, blue: 247.0/255, alpha: 1)
        window.minSize = NSSize(width: 820, height: 580)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName("CageMainWindow")
        window.center()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "cage")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
        let content = window.contentView!
        backdrop = NSVisualEffectView(frame: content.bounds)
        backdrop.autoresizingMask = [.width, .height]
        backdrop.material = .sidebar
        backdrop.blendingMode = .behindWindow
        backdrop.state = .followsWindowActiveState
        content.addSubview(backdrop)
        content.addSubview(webView)
        NSLayoutConstraint.activate([webView.leadingAnchor.constraint(equalTo: content.leadingAnchor), webView.trailingAnchor.constraint(equalTo: content.trailingAnchor), webView.topAnchor.constraint(equalTo: content.topAnchor), webView.bottomAnchor.constraint(equalTo: content.bottomAnchor)])
        loading = NSTextField(labelWithString: "正在启动 Cage 工作台…")
        loading.font = NSFont.systemFont(ofSize: 16, weight: .medium)
        loading.textColor = NSColor(srgbRed: 54.0/255, green: 54.0/255, blue: 54.0/255, alpha: 1)
        loading.alignment = .center
        loading.maximumNumberOfLines = 4
        loading.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(loading)
        retry = NSButton(title: "重试连接", target: self, action: #selector(retryConnection))
        retry.bezelStyle = .rounded
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.isHidden = true
        content.addSubview(retry)
        NSLayoutConstraint.activate([loading.centerXAnchor.constraint(equalTo: content.centerXAnchor), loading.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -16), loading.widthAnchor.constraint(lessThanOrEqualToConstant: 600), retry.centerXAnchor.constraint(equalTo: content.centerXAnchor), retry.topAnchor.constraint(equalTo: loading.bottomAnchor, constant: 20)])
        applyAppearance(appearance)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        bootstrap()
    }
    private func makeMenus() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: "Cage")
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 Cage", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "设置…", action: #selector(settings), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Cage", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Cage…", action: #selector(requestQuit), keyEquivalent: "q")
        let file = NSMenu(title: "文件")
        file.addItem(withTitle: "打开项目…", action: #selector(openProject), keyEquivalent: "o")
        file.addItem(.separator())
        file.addItem(withTitle: "新建网页", action: #selector(newTab), keyEquivalent: "t")
        let terminal = file.addItem(withTitle: "新建终端", action: #selector(newTerminal), keyEquivalent: "\r")
        terminal.keyEquivalentModifierMask = [.command, .shift]
        file.addItem(withTitle: "关闭当前标签", action: #selector(closeTab), keyEquivalent: "w")
        file.addItem(.separator())
        file.addItem(withTitle: "关闭窗口（保留环境）", action: #selector(closeWindow), keyEquivalent: "")
        let fileItem = NSMenuItem(title: "文件", action: nil, keyEquivalent: "")
        fileItem.submenu = file; main.addItem(fileItem)
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "撤销", action: #selector(editUndo), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "重做", action: #selector(editRedo), keyEquivalent: "z"); redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "剪切", action: #selector(editCut), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(editCopy), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(editPaste), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(editSelectAll), keyEquivalent: "a")
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: ""); editItem.submenu = edit; main.addItem(editItem)
        let view = NSMenu(title: "窗口")
        view.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        view.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        view.addItem(withTitle: "进入全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "")
        let viewItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: ""); viewItem.submenu = view; main.addItem(viewItem)
        NSApp.mainMenu = main
    }
    @objc private func editUndo(){edit("undo",fallback:"undo:")}
    @objc private func editRedo(){edit("redo",fallback:"redo:")}
    @objc private func editCut(){edit("cut",fallback:"cut:")}
    @objc private func editCopy(){edit("copy",fallback:"copy:")}
    @objc private func editPaste(){edit("paste",fallback:"paste:")}
    @objc private func editSelectAll(){edit("selectAll",fallback:"selectAll:")}
    private func edit(_ command:String,fallback:String){
        webView.evaluateJavaScript("window.cageEditAction?.('\(command)') ?? false") {result,error in
            if (result as? Bool) != true {NSApp.sendAction(Selector(fallback),to:nil,from:self)}
        }
    }
    @objc private func about() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CageVersion") as? String ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "开发版本"
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName:"Cage", .applicationVersion:version, .credits:NSAttributedString(string:"本机隔离编码工作区\n基于 agent-vm、Lima、Chromium、noVNC 与 xterm.js")])
    }
    @objc private func settings() { action("settings") }
    @objc private func openProject() { action("openProject") }
    @objc private func newTab() { action("newTab") }
    @objc private func newTerminal() { action("newTerminal") }
    @objc private func closeTab() { action("closeTab") }
    @objc private func closeWindow() { window.close() }
    @objc private func requestQuit() { NSApp.terminate(nil) }
    @objc private func retryConnection() { bootstrap() }
    private func action(_ name: String) { webView.evaluateJavaScript("window.cageNativeAction?.('\(name)')", completionHandler: nil) }
    private func requestEntry(_ completion: @escaping (Result<URL, Error>) -> Void) {
        guard let executable = Bundle.main.url(forResource: "cage", withExtension: nil) else {
            completion(.failure(NSError(domain: "Cage", code: 1))); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process(); process.executableURL = executable; process.arguments = ["desktop", "--json"]
            let output = Pipe(); process.standardOutput = output; process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let result = try JSONSerialization.jsonObject(with: data) as? [String:String]
                guard process.terminationStatus == 0, let raw = result?["url"], let url = URL(string: raw), url.scheme == "http", url.host == "localhost", url.port != nil, url.fragment?.isEmpty == false else { throw NSError(domain:"Cage", code:1) }
                DispatchQueue.main.async { completion(.success(url)) }
            } catch { DispatchQueue.main.async { completion(.failure(error)) } }
        }
    }
    private func bootstrap() {
        loading.stringValue = "正在启动 Cage 工作台…"
        loading.isHidden = false; retry.isHidden = true; webView.isHidden = true
        requestEntry { result in
            switch result {
            case .success(let url): self.expectedPort = url.port!; self.webView.load(URLRequest(url: url))
            case .failure: self.showError("工作台未能启动。请重试；详细信息位于 ~/.claude-cage/control.log。")
            }
        }
    }
    private func showError(_ text: String) { loading.stringValue = text; loading.isHidden = false; retry.isHidden = false; webView.isHidden = true }
    private func applyAppearance(_ value: [String:Any]) {
        let mode = value["mode"] as? String ?? "system"
        NSApp.appearance = mode == "system" ? nil : NSAppearance(named: mode == "dark" ? .darkAqua : .aqua)
        let translucent = value["translucent"] as? Bool ?? false
        backdrop.isHidden = !translucent
        window.isOpaque = !translucent
        let background = value["background"] as? String ?? "#f7f7f7"
        let hex = UInt32(background.dropFirst(), radix: 16) ?? 0xf7f7f7
        window.backgroundColor = NSColor(srgbRed: Double((hex >> 16) & 255)/255, green: Double((hex >> 8) & 255)/255, blue: Double(hex & 255)/255, alpha: 1)
        loading.textColor = .labelColor
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading.isHidden = true; retry.isHidden = true; webView.isHidden = false; window.makeFirstResponder(webView) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError("无法连接工作台。后台任务不会因此自动结束。") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { bootstrap() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.scheme == "http", url.host == "localhost", url.port == expectedPort else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "http", origin.host == "localhost", origin.port == expectedPort, let body = message.body as? [String:Any], let action = body["action"] as? String else { replyHandler(nil,"请求来源无效"); return }
        switch action {
        case "appearance":
            guard let mode = body["mode"] as? String, ["system", "light", "dark"].contains(mode), let background = body["background"] as? String, background.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { replyHandler(nil,"外观参数无效"); return }
            let value: [String:Any] = ["mode":mode,"background":background,"translucent":body["translucent"] as? Bool ?? false]
            UserDefaults.standard.set(value, forKey: "cage.windowAppearance")
            applyAppearance(value)
            replyHandler(true,nil)
        case "clipboardRead": replyHandler(NSPasteboard.general.string(forType:.string) ?? "",nil)
        case "clipboardWrite":
            guard let text = body["text"] as? String else { replyHandler(nil,"缺少文本"); return }
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType:.string); replyHandler(true,nil)
        case "chooseFolder":
            let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true; panel.allowsMultipleSelection = false; panel.prompt = "共享此项目"; panel.message = "仅此文件夹会与 Cage 共享。请选择具体项目。"
            panel.beginSheetModal(for:window) { response in replyHandler(response == .OK ? panel.url?.path : "",nil) }
        case "refreshSession":
            requestEntry { result in
                switch result {
                case .success(let url): replyHandler(["url":url.absoluteString],nil)
                case .failure: replyHandler(nil,"工作台会话恢复失败，请重新连接后重试。")
                }
            }
        case "reconnect": replyHandler(true,nil); bootstrap()
        case "quitNow": replyHandler(true,nil); allowQuit = true; NSApp.terminate(nil)
        default: replyHandler(nil,"未知操作")
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for:window){_ in completionHandler()} }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle:"确定"); alert.addButton(withTitle:"取消"); alert.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn)} }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowQuit { return .terminateNow }
        if webView.isHidden { return .terminateNow }
        window.makeKeyAndOrderFront(nil); action("quit"); return .terminateCancel
    }
}
