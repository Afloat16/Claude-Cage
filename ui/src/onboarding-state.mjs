// The default endpoint exists before any proxy has been set up. A saved
// external profile (including one using this port) remains a valid start path.
export function needsProxySetup(settings, status, proxy) {
  if (status?.vm_running || status?.can_restore) return false;
  const endpoint = settings?.proxy_url?.trim();
  if (!endpoint) return true;
  if (endpoint !== "socks5://127.0.0.1:17896") return false;
  return !(proxy?.active && proxy?.selected);
}
