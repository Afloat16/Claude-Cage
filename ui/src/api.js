let sessionRenewal;
async function responseError(response) {
  const error = new Error(
    (await response.text()).trim() || "连接未完成，请重试",
  );
  error.status = response.status;
  return error;
}
async function renewSession() {
  if (!sessionRenewal) {
    sessionRenewal = (async () => {
      const { url } = await native("refreshSession");
      const entry = new URL(url);
      if (entry.origin !== location.origin) {
        await native("reconnect");
        throw new Error("工作台地址已更新，连接恢复后请重试刚才的操作。");
      }
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: entry.hash.slice(1) }),
      });
      if (!response.ok) throw await responseError(response);
    })().finally(() => {
      sessionRenewal = null;
    });
  }
  return sessionRenewal;
}
export async function api(path, body, method) {
  const options = {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response = await fetch("/api" + path, options);
  // Authentication fails before a handler runs, so retrying this rejected
  // request once does not repeat an accepted mutation.
  if (response.status === 401 && path !== "/session" && nativeAvailable()) {
    await renewSession();
    response = await fetch("/api" + path, options);
  }
  if (!response.ok) throw await responseError(response);
  return response.json();
}
export const nativeAvailable = () =>
  Boolean(window.webkit?.messageHandlers?.cage);
export async function native(action, extra = {}) {
  return window.webkit.messageHandlers.cage.postMessage({ action, ...extra });
}
export const readClipboard = () =>
  nativeAvailable() ? native("clipboardRead") : navigator.clipboard.readText();
export const writeClipboard = (text) =>
  nativeAvailable()
    ? native("clipboardWrite", { text })
    : navigator.clipboard.writeText(text);
export function normalizeURL(text) {
  const value = text.trim();
  if (!value || value === "about:blank") return "about:blank";
  if (/^https?:\/\//i.test(value)) return new URL(value).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^localhost:\d+/i.test(value))
    throw new Error("地址仅支持 http 或 https");
  if (
    !/\s/.test(value) &&
    (value.includes(".") || /^localhost(?::\d+)?(?:\/|$)/i.test(value))
  )
    return new URL(
      (/^localhost|^127\./.test(value) ? "http://" : "https://") + value,
    ).href;
  return "https://www.google.com/search?q=" + encodeURIComponent(value);
}
