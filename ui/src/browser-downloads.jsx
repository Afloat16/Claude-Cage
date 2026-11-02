import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, CircleAlert } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { Modal } from "./views";

export function useDownloadNotifications(
  downloads = [],
  onStatus,
  uploading = false,
) {
  const previous = useRef(new Map());
  const observed = useRef(new Set()),
    prompted = useRef(new Set()),
    queue = useRef(Promise.resolve());
  useEffect(() => {
    for (const item of downloads) {
      if (["downloading", "saving"].includes(item.state))
        observed.current.add(item.id);
      if (item.state === "failed" && previous.current.get(item.id) !== "failed")
        onStatus(
          `“${item.name}”未能保存：${item.error || "请在下载列表中重试"}`,
        );
      if (
        nativeAvailable() &&
        !uploading &&
        observed.current.has(item.id) &&
        !prompted.current.has(item.id) &&
        (item.state === "saved" || (item.state === "failed" && item.retryable))
      ) {
        prompted.current.add(item.id);
        queue.current = queue.current
          .then(() => saveDownload(item))
          .catch((error) => onStatus(error.message));
      }
    }
    previous.current = new Map(downloads.map((item) => [item.id, item.state]));
  }, [downloads, uploading]);
}

async function saveDownload(item) {
  if (!nativeAvailable()) {
    const link = document.createElement("a");
    link.href = `/api/browser/files/downloads/${encodeURIComponent(item.id)}/content`;
    link.download = item.name;
    link.click();
    return;
  }
  const result = await native("saveBrowserDownload", {
    id: item.id,
    name: item.name,
  });
  if (result?.path)
    window.dispatchEvent(
      new CustomEvent("cage-download-saved", { detail: result }),
    );
  return result;
}

export function BrowserDownloads({
  downloads = [],
  ready,
  onStatus,
  sidebar = false,
}) {
  const [open, setOpen] = useState(false),
    [retrying, setRetrying] = useState("");
  const [saved, setSaved] = useState([]);
  useEffect(() => {
    const refresh = () =>
      api("/browser/files/saved")
        .then((value) => setSaved(Array.isArray(value) ? value : []))
        .catch(() => {});
    refresh();
    window.addEventListener("cage-download-saved", refresh);
    return () => window.removeEventListener("cage-download-saved", refresh);
  }, [open]);
  const items = downloads.map((item) => {
    const local = saved.find((entry) => entry.id === item.id);
    return local
      ? { ...item, ...local, state: "saved", retryable: false, error: "" }
      : item;
  });
  for (const item of saved)
    if (!items.some((entry) => entry.id === item.id))
      items.push({ ...item, state: "saved" });
  const failed = items.some((item) => item.state === "failed");
  const labels = {
    downloading: "正在下载",
    saving: "正在保存到本机",
    saved: "已保存到本机",
    failed: "保存失败",
    canceled: "下载已取消",
  };
  return (
    <>
      <button
        className={
          sidebar ? "sidebar-link" : "icon-button browser-download-button"
        }
        aria-label={sidebar ? "下载文件" : "浏览器下载"}
        title={failed ? "有下载未能保存，点击查看" : "浏览器下载"}
        onClick={() => setOpen(true)}
      >
        {failed ? <CircleAlert size={16} /> : <ArrowDownToLine size={16} />}
        {sidebar && "下载"}
      </button>
      {open &&
        createPortal(
          <Modal title="浏览器下载" onClose={() => setOpen(false)}>
            <div className="browser-download-list">
              {!items.length && (
                <p>
                  暂无下载。下载完成后可另存为到本机；取消时，原文件仍保留在默认工作区的
                  Downloads 文件夹。
                </p>
              )}
              {items.map((item) => (
                <article key={item.id} className="browser-download-item">
                  <strong>{item.name}</strong>
                  <p>
                    {labels[item.state] || "状态待确认"}
                    {item.state === "downloading" &&
                      item.totalBytes > 0 &&
                      ` · ${Math.min(100, Math.floor((item.receivedBytes / item.totalBytes) * 100))}%`}
                  </p>
                  {item.path && <p className="download-path">{item.path}</p>}
                  {item.error && <p role="status">{item.error}</p>}
                  {(item.state === "saved" || item.retryable) && (
                    <div className="download-actions">
                      <button
                        disabled={Boolean(retrying)}
                        onClick={async () => {
                          setRetrying(item.id);
                          try {
                            await saveDownload(item);
                          } catch (error) {
                            onStatus(error.message);
                          } finally {
                            setRetrying("");
                          }
                        }}
                      >
                        {retrying === item.id ? "正在保存…" : "另存为…"}
                      </button>
                      {nativeAvailable() &&
                        item.state === "saved" &&
                        [
                          ["open", "打开文件"],
                          ["reveal", "在文件夹中显示"],
                        ].map(([operation, label]) => (
                          <button
                            key={operation}
                            onClick={async () => {
                              try {
                                await native("browserDownloadAction", {
                                  operation,
                                  id: item.id,
                                });
                              } catch (error) {
                                onStatus(error.message);
                              }
                            }}
                          >
                            {label}
                          </button>
                        ))}
                    </div>
                  )}
                  {item.retryable && (
                    <button
                      disabled={!ready || Boolean(retrying)}
                      onClick={async () => {
                        setRetrying(item.id);
                        try {
                          await api("/browser/download-retry", { id: item.id });
                        } catch (error) {
                          onStatus(error.message);
                        } finally {
                          setRetrying("");
                        }
                      }}
                    >
                      {retrying === item.id ? "正在重试…" : "重试保存"}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
