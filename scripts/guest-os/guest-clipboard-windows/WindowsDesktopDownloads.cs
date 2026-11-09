using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32.SafeHandles;

namespace Cage.GuestClipboard;

// Only destinations reserved for a verified Claude Save dialog enter this
// catalog. A wire request names an opaque receipt, never a filesystem path.
internal static class WindowsDesktopDownloads
{
    private sealed class Download
    {
        public string ID { get; set; } = "";
        public string Name { get; set; } = "";
        public string State { get; set; } = "downloading";
        public string Error { get; set; } = "";
        public long Size { get; set; }
        public long Written { get; set; }
        public DateTimeOffset Started { get; set; } = DateTimeOffset.UtcNow;
    }
    private sealed class Transfer(FileStream file, string session, long epoch)
    {
        internal readonly FileStream File = file;
        internal bool SessionValid => ClipboardAgent.Current is { SessionEventsRegistered: true } agent && agent.Session == session && agent.SessionEpoch == epoch;
        internal int Sequence;
        internal DateTimeOffset Used = DateTimeOffset.UtcNow;
    }
    private static readonly object Gate = new();
    private static readonly Dictionary<string, Download> Downloads = new();
    private static readonly Dictionary<string, Transfer> Transfers = new();
    private static readonly System.Threading.Timer TransferExpiry = new(_ =>
    {
        lock (Gate)
        {
            if (Transfers.Count == 0) return;
            bool available;
            try { available = SessionGuard.Available(); } catch { available = false; }
            foreach (var pair in Transfers.ToArray())
                if (!available || !pair.Value.SessionValid || DateTimeOffset.UtcNow - pair.Value.Used > TimeSpan.FromMinutes(2))
                { pair.Value.File.Dispose(); Transfers.Remove(pair.Key); }
        }
    }, null, 2000, 2000);
    private static string? directory;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);

    private static FileStream OpenSource(Download item)
    {
        var path = Source(item);
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            var actual = new StringBuilder(32768);
            var length = GetFinalPathNameByHandleW(stream.SafeFileHandle, actual, (uint)actual.Capacity, 0);
            if (length == 0 || length >= actual.Capacity ||
                !string.Equals(actual.ToString(), @"\\?\" + Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase) ||
                stream.Length > AttachmentsRpc.FileLimit)
                throw new InvalidDataException("desktop_download_file_invalid");
            return stream;
        }
        catch { stream.Dispose(); throw; }
    }

    private static string DirectoryPath()
    {
        if (directory is not null) return directory;
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var root = Path.Combine(home, "Cage", "DesktopDownloads");
        using var user = WindowsIdentity.GetCurrent();
        foreach (var path in new[] { Path.Combine(home, "Cage"), root })
        {
            Directory.CreateDirectory(path);
            var info = new DirectoryInfo(path);
            if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.GetAccessControl().GetOwner(typeof(SecurityIdentifier))?.Value != user.User?.Value)
                throw new InvalidDataException("desktop_download_directory_invalid");
        }
        var manifest = Path.Combine(root, "downloads.json");
        if (File.Exists(manifest))
        {
            var info = new FileInfo(manifest);
            if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length > 1 << 20) throw new InvalidDataException("desktop_download_catalog_invalid");
            var saved = JsonSerializer.Deserialize<Download[]>(File.ReadAllBytes(manifest)) ?? [];
            foreach (var item in saved.TakeLast(100))
            {
                if (!Guid.TryParseExact(item.ID, "D", out _) || !AttachmentsRpc.NameValid(item.Name)) continue;
                if (item.State == "downloading") { item.State = "failed"; item.Error = "保存过程被中断，请从 Claude Desktop 重新下载。"; }
                Downloads[item.ID] = item;
            }
        }
        directory = root;
        return root;
    }
    private static string Source(Download item) => Path.Combine(DirectoryPath(), item.ID, item.Name);
    private static void Persist()
    {
        var file = Path.Combine(DirectoryPath(), "downloads.json");
        var temporary = file + "." + Guid.NewGuid().ToString("N");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, Downloads.Values.TakeLast(100).ToArray());
                stream.Flush(true);
            }
            File.Move(temporary, file, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal static string Reserve(string name, Action<string> submit)
    {
        if (!AttachmentsRpc.NameValid(name)) throw new InvalidDataException("desktop_download_name_invalid");
        lock (Gate)
        {
            DirectoryPath();
            if (Downloads.Values.Count(item => item.State == "downloading") >= 12) throw new InvalidDataException("desktop_download_limit");
            var item = new Download { ID = Guid.NewGuid().ToString("D"), Name = name };
            var folder = Path.GetDirectoryName(Source(item))!;
            Directory.CreateDirectory(folder);
            var watcher = new FileSystemWatcher(folder) { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
            var changed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var renamed = 0;
            watcher.Changed += (_, eventArgs) => { if (eventArgs.Name == name) changed.TrySetResult(); };
            watcher.Renamed += (_, eventArgs) => { if (eventArgs.Name == name) { Interlocked.Exchange(ref renamed, 1); changed.TrySetResult(); } };
            watcher.Error += (_, _) => changed.TrySetException(new InvalidDataException("desktop_download_watch_failed"));
            watcher.EnableRaisingEvents = true;
            while (Downloads.Count >= 100)
            {
                var oldest = Downloads.Values.FirstOrDefault(value => value.State != "downloading");
                if (oldest is null) break;
                Downloads.Remove(oldest.ID);
            }
            Downloads.Add(item.ID, item);
            Persist();
            try { submit(Source(item)); }
            catch
            {
                watcher.Dispose(); item.State = "failed"; item.Error = "客机保存窗口未接收文件位置，请重新下载。"; Persist(); throw;
            }
            _ = Task.Run(async () =>
            {
                using (watcher)
                using (var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(30)))
                {
                    try
                    {
                        await changed.Task.WaitAsync(timeout.Token);
                        while (true)
                        {
                            timeout.Token.ThrowIfCancellationRequested();
                            if (!File.Exists(Source(item) + ".crdownload"))
                            {
                                try
                                {
                                    using var source = OpenSource(item);
                                    if (source.Length == 0 && Volatile.Read(ref renamed) == 0) throw new IOException("empty reservation is waiting for completion");
                                    lock (Gate)
                                    {
                                        item.Size = source.Length; item.Written = File.GetLastWriteTimeUtc(Source(item)).Ticks;
                                        item.State = "saved"; Persist();
                                    }
                                    return;
                                }
                                catch (IOException) { }
                            }
                            await Task.Delay(100, timeout.Token);
                        }
                    }
                    catch
                    {
                        lock (Gate) { item.State = "failed"; item.Error = "未能确认文件保存完成，请从 Claude Desktop 重新下载。"; Persist(); }
                    }
                }
            });
            return item.ID;
        }
    }

    internal static JsonArray Snapshot()
    {
        lock (Gate)
        {
            DirectoryPath();
            return new JsonArray(Downloads.Values.TakeLast(100).Reverse().Select(item => (JsonNode)new JsonObject
            {
                ["id"] = item.ID, ["name"] = item.Name, ["state"] = item.State, ["target"] = "desktop",
                ["receivedBytes"] = item.Size, ["totalBytes"] = item.Size, ["retryable"] = false,
                ["error"] = item.Error, ["startedAt"] = item.Started.ToString("O"),
            }).ToArray());
        }
    }

    internal static (string ID, bool Directory)? FindPath(string path)
    {
        lock (Gate)
        {
            DirectoryPath();
            foreach (var item in Downloads.Values)
            {
                var source = Source(item);
                if (string.Equals(path, source, StringComparison.OrdinalIgnoreCase)) return (item.ID, false);
                if (string.Equals(path, Path.GetDirectoryName(source), StringComparison.OrdinalIgnoreCase)) return (item.ID, true);
            }
            return null;
        }
    }

    internal static JsonObject Read(JsonObject input)
    {
        lock (Gate)
        {
            SessionGuard.Assert(); DirectoryPath();
            foreach (var pair in Transfers.ToArray())
                if (!pair.Value.SessionValid || DateTimeOffset.UtcNow - pair.Value.Used > TimeSpan.FromMinutes(2)) { pair.Value.File.Dispose(); Transfers.Remove(pair.Key); }
            var action = input["action"]?.GetValue<string>();
            if (action == "files-download-retry")
            {
                var id = input["id"]?.GetValue<string>() ?? "";
                if (!Downloads.TryGetValue(id, out var item) || item.State != "saved") throw new InvalidDataException("desktop_download_incomplete");
                using var file = OpenSource(item);
                if (file.Length != item.Size || File.GetLastWriteTimeUtc(Source(item)).Ticks != item.Written) throw new InvalidDataException("desktop_download_changed");
                return new JsonObject { ["ok"] = true };
            }
            if (action == "files-download-open")
            {
                var agent = ClipboardAgent.Current;
                if (agent is null || !agent.SessionEventsRegistered) throw new InvalidDataException("desktop_download_session_unavailable");
                var id = input["id"]?.GetValue<string>() ?? "";
                if (!Downloads.TryGetValue(id, out var item) || item.State != "saved" || Transfers.Count >= 12) throw new InvalidDataException("desktop_download_unavailable");
                var file = OpenSource(item);
                if (file.Length != item.Size || File.GetLastWriteTimeUtc(Source(item)).Ticks != item.Written)
                { file.Dispose(); throw new InvalidDataException("desktop_download_changed"); }
                var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                Transfers.Add(key, new Transfer(file, agent.Session, agent.SessionEpoch));
                return new JsonObject { ["transfer"] = key, ["size"] = file.Length, ["name"] = item.Name };
            }
            var transfer = input["transfer"]?.GetValue<string>() ?? "";
            if (action == "files-download-close")
            {
                if (Transfers.Remove(transfer, out var old)) old.File.Dispose();
                return new JsonObject { ["ok"] = true };
            }
            if (action != "files-download-read" || !Transfers.TryGetValue(transfer, out var current) || current.Sequence != input["sequence"]?.GetValue<int>())
                throw new InvalidDataException("desktop_download_transfer_invalid");
            var data = new byte[64 << 10];
            var count = current.File.Read(data);
            current.Used = DateTimeOffset.UtcNow;
            var result = new JsonObject { ["data"] = Convert.ToBase64String(data, 0, count), ["sequence"] = ++current.Sequence, ["eof"] = current.File.Position == current.File.Length };
            if (current.File.Position == current.File.Length) { current.File.Dispose(); Transfers.Remove(transfer); }
            return result;
        }
    }
}
