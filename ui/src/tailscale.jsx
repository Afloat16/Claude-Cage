import React, { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Network, RefreshCw, Trash2 } from "lucide-react";
import { api, writeClipboard } from "./api";
import { Modal } from "./modal";
import "./tailscale.css";

const labels = { Running: "已连接", NeedsLogin: "等待登录", NeedsMachineAuth: "等待管理员批准设备", Starting: "正在连接", Stopped: "已断开", NotInstalled: "尚未安装" };
export function TailscalePanel({ status, onClose, onOpenBrowser, onInstall, onConfirm }) {
  const [state, setState] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [key, setKey] = useState(""), [notice, setNotice] = useState("");
  const mounted = useRef(true), inflight = useRef(false), loginRequested = useRef(false), revision = useRef(0);
  const ready = status.ready && !status.job?.running;
  const refresh = async () => {
    if (inflight.current || !ready) return;
    inflight.current = true;
    const current = ++revision.current;
    try { const value = await api("/tailscale"); if (mounted.current && current === revision.current) { setState(value); setError(""); if (loginRequested.current && value.auth_url) { loginRequested.current = false; await onOpenBrowser(value.auth_url); } } return value; }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { inflight.current = false; }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [ready]);
  const act = async (action, body = {}) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice(""); revision.current++;
    try {
      inflight.current = true;
      const value = await api(`/tailscale/${action}`, body);
      if (mounted.current) { setState(value); if (action === "add-key") setKey(""); }
      return value;
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  };
  const login = async () => {
    loginRequested.current = true;
    const result = await act(state?.enabled ? "login" : "connect");
    if (result?.auth_url) { loginRequested.current = false; await onOpenBrowser(result.auth_url); }
    else if (!result || result.backend === "Running") loginRequested.current = false;
  };
  const copy = async text => {
    try { await writeClipboard(text); setNotice("已复制"); }
    catch { setNotice("请选中命令后复制"); }
  };
  const address = state?.ips?.find(ip => !ip.includes(":"));
  const connected = state?.backend === "Running";
  return <Modal title="Tailscale" onClose={onClose} wide>
    <div className="modal-body tailscale-panel">
      <p className="field-help">让 Cage 与本机加入同一私网，通过 SSH 双向连接。本机也需安装 Tailscale 并加入同一网络。</p>
      <div className="tailscale-state" role="status">
        <Network size={20} />
        <div><strong>{!ready ? "等待 Cage 环境就绪" : labels[state?.backend] || (state ? "连接状态待确认" : "正在读取状态…")}</strong>
          {state?.name && <span>{state.name}</span>}
        </div>
        <button className="icon-button" aria-label="刷新 Tailscale 状态" disabled={!ready || busy} onClick={refresh}><RefreshCw size={16} /></button>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {ready && state && <div className="tailscale-actions">
        {!state.installed ? <button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await onInstall(); } finally { inflight.current = false; if (mounted.current) setBusy(false); } }}>{["macos", "windows-11"].includes(status.guest_system) ? "更新环境组件以安装" : "安装 Tailscale"}</button>
          : <>
            {!connected && <button className="primary-button" disabled={busy} onClick={login}>{busy && <LoaderCircle size={15} className="spin" />}{state.enabled ? "在浏览器登录" : "连接 Tailscale"}</button>}
            {state.auth_url && <button className="quiet-button" disabled={busy} onClick={() => onOpenBrowser(state.auth_url)}>打开登录页面</button>}
            {state.enabled && <button className="quiet-button" disabled={busy} onClick={async () => {
              if (await onConfirm({ title: "断开 Tailscale？", body: "正在使用的私网 SSH 连接会中断，登录状态和公钥保留。", confirm: "断开连接" })) await act("disconnect");
            }}>断开连接</button>}
            {(state.enabled || state.ips?.length > 0) && <button className="quiet-button" disabled={busy} onClick={async () => {
              if (await onConfirm({ title: "退出 Tailscale 登录？", body: "私网 SSH 连接会中断，下次连接需要重新登录。已添加的 SSH 公钥保留。", confirm: "退出登录" })) await act("logout");
            }}>退出登录</button>}
          </>}
      </div>}
      {state?.installed && <>
        <section className="tailscale-section">
          <h3>本机连接 Cage</h3>
          <p className="field-help">添加本机的 SSH 公钥后，在本机终端执行下面的命令。私钥留在本机。</p>
          {address ? <div className="tailscale-command"><code>{`ssh ${state.user}@${address}`}</code><button className="icon-button" aria-label="复制连接 Cage 命令" onClick={() => copy(`ssh ${state.user}@${address}`)}><Copy size={15} /></button></div> : <p className="field-help">连接成功后显示 Cage 的私网地址。</p>}
          <label className="field-label" htmlFor="tailscale-key"><KeyRound size={14} /> 本机 SSH 公钥</label>
          <textarea className="tailscale-key-input" id="tailscale-key" rows={3} placeholder="ssh-ed25519 AAAA…" value={key} onChange={e => setKey(e.target.value)} maxLength={8192} spellCheck={false} />
          <button className="quiet-button" disabled={!ready || busy || !key.trim()} onClick={() => act("add-key", { key: key.trim() })}>添加公钥</button>
          <div className="tailscale-keys">{state.keys.map(entry => <div className="tailscale-key" key={entry}><code title={entry}>{entry}</code><button className="icon-button" disabled={!ready || busy} aria-label="移除 SSH 公钥" onClick={() => act("remove-key", { key: entry })}><Trash2 size={14} /></button></div>)}</div>
        </section>
        <section className="tailscale-section">
          <h3>Cage 连接本机</h3>
          <p className="field-help">本机开启远程登录或 SSH 服务，再在 Cage 终端执行 <code>ssh 本机用户名@私网地址</code>，按本机 SSH 的认证方式登录。</p>
          {connected && state.peers.length === 0 && <p className="field-help">尚未发现其他设备，请确认本机已加入同一 Tailscale 网络。</p>}
          <div className="tailscale-peers">{state.peers.map(peer => <div className="tailscale-peer" key={peer.ip}><div><strong>{peer.name}</strong><span>{peer.ip} · {peer.online ? "在线" : "离线"}</span></div><button className="quiet-button" onClick={() => copy(`ssh 本机用户名@${peer.ip}`)}>复制命令</button></div>)}</div>
        </section>
        <p className="field-help">私网连接仍受 Tailscale 访问规则控制。Cage 暂停外网、停止环境或退出后台时会断开私网；重新连接沿用设备身份。公网 UDP 受限时通过 Tailscale 中继传输。</p>
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </Modal>;
}
