import React, { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, CircleAlert } from "lucide-react";
import { api } from "./api";
import { Modal } from "./views";

export function useDownloadNotifications(downloads = [], onStatus) {
  const previous = useRef(new Map());
  useEffect(() => {
    for (const item of downloads) {
      if (item.state === "failed" && previous.current.get(item.id) !== "failed")
        onStatus(`“${item.name}”未能保存：${item.error || "请在下载列表中重试"}`);
    }
    previous.current = new Map(downloads.map((item) => [item.id, item.state]));
  }, [downloads]);
}

export function BrowserDownloads({ downloads = [], ready, onStatus }) {
  const [open, setOpen] = useState(false), [retrying, setRetrying] = useState("");
  const failed = downloads.some((item) => item.state === "failed");
  const labels = { downloading: "正在下载", saving: "正在保存到本机", saved: "已保存到本机", failed: "保存失败", canceled: "下载已取消" };
  return (
    <>
      <button className="icon-button browser-download-button" aria-label="浏览器下载" title={failed ? "有下载未能保存，点击查看" : "浏览器下载"} onClick={() => setOpen(true)}>
        {failed ? <CircleAlert size={16} /> : <ArrowDownToLine size={16} />}
      </button>
      {open && (
        <Modal title="浏览器下载" onClose={() => setOpen(false)}>
          <div className="browser-download-list">
            {!downloads.length && <p>暂无下载。文件会保存到默认工作区的 Downloads 文件夹。</p>}
            {downloads.map((item) => (
              <article key={item.id} className="browser-download-item">
                <strong>{item.name}</strong>
                <p>{labels[item.state] || "状态待确认"}
                  {item.state === "downloading" && item.totalBytes > 0 && ` · ${Math.min(100, Math.floor(item.receivedBytes / item.totalBytes * 100))}%`}
                </p>
                {item.path && <p className="download-path">{item.path}</p>}
                {item.error && <p role="status">{item.error}</p>}
                {item.retryable && <button disabled={!ready || Boolean(retrying)} onClick={async () => {
                  setRetrying(item.id);
                  try { await api("/browser/download-retry", { id: item.id }); }
                  catch (error) { onStatus(error.message); }
                  finally { setRetrying(""); }
                }}>{retrying === item.id ? "正在重试…" : "重试保存"}</button>}
              </article>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
