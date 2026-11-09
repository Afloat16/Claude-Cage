import AppKit
import CoreServices

@_silgen_name("cage_file_has_writer") private func cageFileHasWriter(_ pid: Int32, _ path: UnsafePointer<CChar>) -> Int32

@MainActor
final class MacDesktopDownloads {
    static let shared = MacDesktopDownloads(directory: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/dev.cage.DesktopDownloads", isDirectory: true))
    private struct Record: Codable {
        let id: String
        let name: String
        var state = "downloading"
        var error = ""
        var size: Int64 = 0
        var modified: Int64 = 0
        var started = Date()
    }
    private struct Transfer {
        let fd: Int32
        let record: Record
        let epoch: UInt64
        var sequence = 0
        var offset: Int64 = 0
        var used = Date()
    }
    private var records: [Record] = []
    private var transfers: [String: Transfer] = [:]
    private var watches: [String: MacDownloadWatch] = [:]
    private var root: URL?
    private let baseDirectory: URL
    private var transferTimer: Timer?
    private let timestamp = ISO8601DateFormatter()

    init(directory: URL) { baseDirectory = directory }
    deinit {
        for watch in watches.values { watch.stop() }
        for transfer in transfers.values { close(transfer.fd) }
        transferTimer?.invalidate()
    }

    nonisolated static func validName(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.count <= 255 && name != "." && name != ".." &&
            name.rangeOfCharacter(from: CharacterSet(charactersIn: "/\\").union(.controlCharacters)) == nil
    }

    private func directory() throws -> URL {
        if let root { return root }
        try FileManager.default.createDirectory(at: baseDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var info = stat()
        guard lstat(baseDirectory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid(),
              info.st_mode & 0o022 == 0, let canonical = realpath(baseDirectory.path, nil) else { throw Failure(8, "desktop_download_directory_invalid") }
        let root = URL(fileURLWithPath: String(cString: canonical), isDirectory: true)
        free(canonical)
        let manifest = root.appendingPathComponent("downloads.json")
        if FileManager.default.fileExists(atPath: manifest.path) {
            var stored = stat()
            guard lstat(manifest.path, &stored) == 0, stored.st_mode & S_IFMT == S_IFREG, stored.st_uid == getuid(), stored.st_size <= 1 << 20 else {
                throw Failure(8, "desktop_download_catalog_invalid")
            }
            let data = try Data(contentsOf: manifest, options: .mappedIfSafe)
            guard data.count <= 1 << 20 else { throw Failure(8, "desktop_download_catalog_invalid") }
            records = try JSONDecoder().decode([Record].self, from: data).suffix(100).filter { UUID(uuidString: $0.id) != nil && Self.validName($0.name) }
            for index in records.indices where records[index].state == "downloading" {
                records[index].state = "failed"
                records[index].error = "保存过程被中断，请从 Claude Desktop 重新下载。"
            }
        }
        self.root = root
        return root
    }
    private func source(_ record: Record) throws -> URL { try directory().appendingPathComponent(record.id, isDirectory: true).appendingPathComponent(record.name) }
    private func persist() throws {
        let path = try directory().appendingPathComponent("downloads.json")
        try JSONEncoder().encode(Array(records.suffix(100))).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
    private func openSource(_ record: Record) throws -> (Int32, stat) {
        let path = try source(record).path
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else { throw Failure(8, "desktop_download_unavailable") }
        var info = stat(), actual = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(), info.st_size <= 2 * 1024 * 1024 * 1024,
              fcntl(fd, F_GETPATH, &actual) == 0, String(cString: actual) == path else {
            close(fd); throw Failure(8, "desktop_download_file_invalid")
        }
        return (fd, info)
    }
    private func modified(_ info: stat) -> Int64 { Int64(info.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(info.st_mtimespec.tv_nsec) }

    private func expireTransfers() {
        let epoch = try? MacGUISession.shared.validate()
        for (key, transfer) in transfers where epoch != transfer.epoch || Date().timeIntervalSince(transfer.used) > 120 {
            close(transfer.fd); transfers.removeValue(forKey: key)
        }
        if transfers.isEmpty { transferTimer?.invalidate(); transferTimer = nil }
    }

    func reserve(name: String, pid: Int32, submit: (String) async throws -> Void) async throws {
        _ = try directory()
        guard Self.validName(name), records.filter({ $0.state == "downloading" }).count < 12 else { throw Failure(8, "desktop_download_limit") }
        let record = Record(id: UUID().uuidString.lowercased(), name: name)
        let path = try source(record)
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let watcher = try MacDownloadWatch(directory: path.deletingLastPathComponent().path, file: path.path) { [weak self] valid in
            Task { @MainActor in
                if valid { await self?.complete(record.id, pid: pid) }
                else { self?.fail(record.id, message: "保存通知已中断，请从 Claude Desktop 重新下载。") }
            }
        }
        while records.count >= 100, let oldest = records.firstIndex(where: { $0.state != "downloading" }) { records.remove(at: oldest) }
        records.append(record); watches[record.id] = watcher
        do { try persist(); try await submit(path.path) }
        catch { fail(record.id, message: "客机保存窗口未接收文件位置，请重新下载。"); throw error }
        watcher.expiry = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1800 * 1_000_000_000)
            if self?.records.first(where: { $0.id == record.id })?.state == "downloading" {
                self?.fail(record.id, message: "未能确认文件保存完成，请从 Claude Desktop 重新下载。")
            }
        }
    }
    private func fail(_ id: String, message: String) {
        watches.removeValue(forKey: id)?.stop()
        if let index = records.firstIndex(where: { $0.id == id }) {
            records[index].state = "failed"; records[index].error = message
            try? persist()
        }
    }
    private func complete(_ id: String, pid: Int32) async {
        guard let record = records.first(where: { $0.id == id && $0.state == "downloading" }),
              let watch = watches[id], !watch.completing else { return }
        watch.completing = true
        defer { watch.completing = false }
        while Date().timeIntervalSince(record.started) < 1800 {
            guard records.first(where: { $0.id == id })?.state == "downloading" else { return }
            do {
                let path = try source(record).path
                let writing = path.withCString { cageFileHasWriter(pid, $0) }
                if writing == 0 && !FileManager.default.fileExists(atPath: path + ".crdownload") {
                    let (fd, info) = try openSource(record)
                    defer { close(fd) }
                    guard let index = records.firstIndex(where: { $0.id == id }) else { return }
                    records[index].size = info.st_size; records[index].modified = modified(info); records[index].state = "saved"
                    try persist(); watches.removeValue(forKey: id)?.stop(); return
                }
            } catch { }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        fail(id, message: "未能确认文件保存完成，请从 Claude Desktop 重新下载。")
    }
    func snapshot() throws -> [[String: Any]] {
        _ = try directory()
        return records.suffix(100).reversed().map { record in
            ["id": record.id, "name": record.name, "target": "desktop", "state": record.state,
             "receivedBytes": record.size, "totalBytes": record.size, "retryable": false,
             "error": record.error, "startedAt": timestamp.string(from: record.started)]
        }
    }
    func find(path: String) throws -> (id: String, directory: Bool)? {
        _ = try directory()
        for record in records {
            let source = try source(record)
            if source.path == path { return (record.id, false) }
            if source.deletingLastPathComponent().path == path { return (record.id, true) }
        }
        return nil
    }
    func read(_ input: Request) throws -> [String: Any] {
        let epoch = try MacGUISession.shared.validate()
        _ = try directory()
        for (key, transfer) in transfers where transfer.epoch != epoch || Date().timeIntervalSince(transfer.used) > 120 {
            close(transfer.fd); transfers.removeValue(forKey: key)
        }
        if input.action == "files-download-retry" {
            guard let record = records.first(where: { $0.id == input.id }), record.state == "saved" else { throw Failure(8, "desktop_download_incomplete") }
            let (fd, info) = try openSource(record)
            defer { close(fd) }
            guard info.st_size == record.size, modified(info) == record.modified else { throw Failure(8, "desktop_download_changed") }
            return ["ok": true]
        }
        if input.action == "files-download-open" {
            guard let record = records.first(where: { $0.id == input.id && $0.state == "saved" }), transfers.count < 12 else { throw Failure(8, "desktop_download_unavailable") }
            let (fd, info) = try openSource(record)
            guard info.st_size == record.size, modified(info) == record.modified else { close(fd); throw Failure(8, "desktop_download_changed") }
            let key = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            transfers[key] = Transfer(fd: fd, record: record, epoch: epoch)
            if transferTimer == nil {
                transferTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
                    Task { @MainActor in
                        guard let self else { timer.invalidate(); return }
                        self.expireTransfers()
                    }
                }
            }
            return ["transfer": key, "size": record.size, "name": record.name]
        }
        let key = input.transfer ?? ""
        if input.action == "files-download-close" {
            if let transfer = transfers.removeValue(forKey: key) { close(transfer.fd) }
            return ["ok": true]
        }
        guard input.action == "files-download-read", var transfer = transfers[key], transfer.sequence == input.sequence else { throw Failure(8, "desktop_download_transfer_invalid") }
        var info = stat()
        guard fstat(transfer.fd, &info) == 0, info.st_size == transfer.record.size, modified(info) == transfer.record.modified else {
            close(transfer.fd); transfers.removeValue(forKey: key); throw Failure(8, "desktop_download_changed")
        }
        var data = Data(count: 64 << 10)
        let count = data.withUnsafeMutableBytes { Darwin.read(transfer.fd, $0.baseAddress, $0.count) }
        guard count >= 0 else { throw Failure(8, "desktop_download_read_failed") }
        guard fstat(transfer.fd, &info) == 0, info.st_size == transfer.record.size, modified(info) == transfer.record.modified else {
            close(transfer.fd); transfers.removeValue(forKey: key); throw Failure(8, "desktop_download_changed")
        }
        data.count = count; transfer.offset += Int64(count); transfer.sequence += 1; transfer.used = Date()
        let eof = transfer.offset == transfer.record.size
        if eof { close(transfer.fd); transfers.removeValue(forKey: key) } else { transfers[key] = transfer }
        return ["data": data.base64EncodedString(), "sequence": transfer.sequence, "eof": eof]
    }
}

private final class MacDownloadWatch {
    private var stream: FSEventStreamRef?
    private let file: String
    private let changed: (Bool) -> Void
    var completing = false
    var expiry: Task<Void, Never>?
    init(directory: String, file: String, changed: @escaping (Bool) -> Void) throws {
        self.file = file; self.changed = changed
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: { raw in
            guard let raw else { return nil }
            _ = Unmanaged<MacDownloadWatch>.fromOpaque(raw).retain()
            return raw
        }, release: { raw in
            if let raw { Unmanaged<MacDownloadWatch>.fromOpaque(raw).release() }
        }, copyDescription: nil)
        stream = FSEventStreamCreate(nil, { _, raw, count, paths, flags, _ in
            guard let raw else { return }
            let watcher = Unmanaged<MacDownloadWatch>.fromOpaque(raw).takeUnretainedValue()
            let names = Unmanaged<NSArray>.fromOpaque(paths).takeUnretainedValue() as? [String] ?? []
            let failure = FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped | kFSEventStreamEventFlagRootChanged)
            for index in 0..<count where flags[index] & failure != 0 { watcher.changed(false); return }
            for index in 0..<min(count, names.count) where names[index] == watcher.file {
                if flags[index] & FSEventStreamEventFlags(kFSEventStreamEventFlagItemModified | kFSEventStreamEventFlagItemRenamed) != 0 { watcher.changed(true) }
            }
        }, &context, [directory] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.1,
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot))
        guard let stream else { throw Failure(8, "desktop_download_watch_failed") }
        FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
        guard FSEventStreamStart(stream) else { stop(); throw Failure(8, "desktop_download_watch_failed") }
    }
    func stop() {
        expiry?.cancel(); expiry = nil
        guard let stream else { return }
        self.stream = nil
        FSEventStreamStop(stream); FSEventStreamInvalidate(stream); FSEventStreamRelease(stream)
    }
    deinit { stop() }
}
