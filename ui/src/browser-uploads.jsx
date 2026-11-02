import React, { useEffect, useRef, useState } from "react";
import { api, uploadFile } from "./api";
import { Modal } from "./views";

export function BrowserUploads({ requests = [], onStatus }) {
  const [hidden, setHidden] = useState("");
  const request = requests.find((item) => item.id !== hidden);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [percent, setPercent] = useState(0);
  const transfer = useRef();
  useEffect(() => {
    setProgress("");
    setError("");
    return () => transfer.current?.abort();
  }, [request?.id]);
  if (!request) return null;
  const cancel = () => {
    transfer.current?.abort();
    setHidden(request.id);
    void api("/browser/upload-cancel", { id: request.id }).catch(() => {});
  };
  const select = async (files) => {
    if (!files.length) return;
    if (
      files.length > (request.multiple ? 100 : 1) ||
      files.some((file) => file.size > 2 * 1024 ** 3)
    ) {
      setError("每个文件不能超过 2 GB；多选最多 100 个文件。");
      return;
    }
    const controller = new AbortController();
    transfer.current = controller;
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(`正在传递 ${i + 1}/${files.length}：${file.name}`);
        setPercent(0);
        await uploadFile(
          `/browser/files/uploads/${request.id}?${new URLSearchParams({ name: file.name })}`,
          file,
          {
            signal: controller.signal,
            onProgress: (loaded, total) =>
              setPercent(
                total ? Math.min(100, Math.floor((loaded * 100) / total)) : 100,
              ),
          },
        );
      }
      setProgress("正在交给网页…");
      await api("/browser/upload-finish", { id: request.id });
      onStatus("所选文件已交给网页，请在网页中确认上传结果");
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error.message);
        setProgress("");
        // A failed batch must not retain half of the selected files.
        await api("/browser/upload-cancel", { id: request.id }).catch(() => {});
        onStatus(`${error.message}；请重新点击网页的上传按钮`);
      }
    }
  };
  return (
    <Modal
      title="上传本机文件"
      onClose={cancel}
      footer={<button onClick={cancel}>取消上传</button>}
    >
      <div className="modal-body browser-upload-body">
        <p>
          选择要上传的图片、视频或文档。仅传递所选文件，原网页负责处理附件。
        </p>
        <label className="field">
          选择本机文件
          <input
            type="file"
            multiple={request.multiple}
            disabled={Boolean(progress)}
            onChange={(event) =>
              void select(Array.from(event.target.files || []))
            }
          />
        </label>
        {progress && (
          <>
            <p role="status">
              {progress} · {percent}%
            </p>
            <progress aria-label="文件传递进度" max="100" value={percent} />
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
