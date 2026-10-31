import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Plus,
  Search,
  RefreshCw,
  Check,
  Activity,
  Server,
  Trash2,
  Pencil,
  LoaderCircle,
  Square,
} from "lucide-react";
import { api } from "./api";
import "./proxy.css";

const bytes = (v) => {
  const n = Math.max(0, Number(v) || 0);
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
};
function usageLabel(raw) {
  const values = Object.fromEntries(
    (raw || "").split(";").map((v) => v.trim().split("=")),
  );
  const used = Number(values.upload || 0) + Number(values.download || 0);
  return [
    values.total ? `${bytes(used)} / ${bytes(values.total)}` : "",
    Number(values.expire) > 0
      ? `到期 ${new Date(Number(values.expire) * 1000).toLocaleDateString()}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
const emptyForm = {
  name: "",
  url: "",
  content: "",
  interval_hours: 24,
  host_download: false,
};
export function ProxySettings({ status, onApplied, onConfirm }) {
  const [proxy, setProxy] = useState(null),
    [tab, setTab] = useState("nodes"),
    [search, setSearch] = useState(""),
    [source, setSource] = useState(""),
    [form, setForm] = useState(null),
    [mode, setMode] = useState("url"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(""),
    [notice, setNotice] = useState(""),
    [delays, setDelays] = useState({}),
    [connections, setConnections] = useState({ connections: [] }),
    [logs, setLogs] = useState([]),
    [port, setPort] = useState("17896"),
    [rates, setRates] = useState({ up: 0, down: 0 });
  const [manual, setManual] = useState({
    name: "",
    type: "socks5",
    server: "",
    port: "1080",
    username: "",
    password: "",
  });
  const [hostRefresh, setHostRefresh] = useState(false);
  const alive = useRef(true),
    loading = useRef(false),
    latest = useRef(null),
    measuring = useRef(false),
    file = useRef(),
    portDirty = useRef(false);
  const reload = async () => {
    const value = await api("/proxy");
    if (alive.current) {
      setProxy(value);
      if (!portDirty.current) setPort(String(value.port));
    }
    return value;
  };
  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      if (loading.current) return;
      loading.current = true;
      try {
        await reload();
      } catch (e) {
        if (alive.current) setError(e.message);
      } finally {
        loading.current = false;
      }
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (tab !== "connections" && tab !== "diagnostics") return;
    let cancelled = false;
    const tick = async () => {
      try {
        if (tab === "diagnostics") {
          const result = await api("/proxy/logs");
          if (!cancelled) setLogs(result.lines);
        } else {
          const result = await api("/proxy/connections"),
            now = Date.now();
          if (cancelled) return;
          if (latest.current) {
            const seconds = (now - latest.current.time) / 1000;
            if (seconds > 0)
              setRates({
                up: Math.max(
                  0,
                  (result.uploadTotal - latest.current.uploadTotal) / seconds,
                ),
                down: Math.max(
                  0,
                  (result.downloadTotal - latest.current.downloadTotal) /
                    seconds,
                ),
              });
          }
          latest.current = { ...result, time: now };
          setConnections(result);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      latest.current = null;
    };
  }, [tab]);
  const busy = Boolean(pending) || Boolean(status.job?.running);
  const mutate = async (action, input = {}) => {
    setError("");
    setNotice("");
    setPending(action);
    try {
      const job = await api(`/proxy/${action}`, input);
      let current;
      do {
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = (await api("/status")).job;
        if (current.id !== job.id)
          throw new Error("操作已被其他任务替代，请查看当前状态");
      } while (current.running);
      portDirty.current = false;
      await reload();
      await onApplied();
      if (current.error) throw new Error(current.error);
      if (alive.current) {
        setForm(null);
        setNotice(current.message || "已完成");
        setDelays({});
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setPending("");
    }
  };
  const select = async (id) => {
    if (
      !proxy.active &&
      status.vm_running &&
      !(await onConfirm({
        title: "启用内置代理并重启环境？",
        body: "首次启用或修改代理端口需要重启，当前终端会结束。后续只切换节点会保留终端进程，但网络连接会重新建立。",
        confirm: "启用并重启",
      }))
    )
      return;
    mutate("select", { node_id: id, port: Number(port) });
  };
  const measure = async (ids) => {
    if (measuring.current) return;
    measuring.current = true;
    setPending("delay");
    setError("");
    try {
      // A small worker pool bounds probes without changing the selected group.
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (index < ids.length && alive.current) {
            const id = ids[index++];
            try {
              const result = await api("/proxy/delay", { node_id: id });
              if (alive.current)
                setDelays((old) => ({ ...old, [id]: `${result.delay} ms` }));
            } catch {
              if (alive.current)
                setDelays((old) => ({ ...old, [id]: "不可用 / 未载入" }));
            }
          }
        }),
      );
    } finally {
      measuring.current = false;
      if (alive.current) setPending("");
    }
  };
  const submit = () => {
    let value = {
      id: form.id || "",
      name: form.name,
      url: form.url,
      content: form.content,
      interval_hours: form.interval_hours,
      host_download: form.host_download,
    };
    if (mode === "manual" && !form.id) {
      const node = { ...manual, port: Number(manual.port) };
      value = {
        ...form,
        name: form.name || manual.name,
        url: "",
        content: JSON.stringify({ proxies: [node] }),
        interval_hours: 0,
      };
    }
    mutate(form.id ? "edit" : "import", value);
  };
  if (!proxy)
    return <div className="proxy-loading">{error || "正在读取代理配置…"}</div>;
  const allNodes = proxy.sources.flatMap((s) =>
    s.nodes.map((n) => ({ ...n, source: s.name, sourceID: s.id })),
  );
  const selected = allNodes.find((n) => n.id === proxy.selected);
  const nodes = allNodes.filter(
    (n) =>
      (!source || n.sourceID === source) &&
      `${n.name} ${n.source} ${n.type}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="proxy-manager">
      <div className="section-title">
        <h3>内置代理</h3>
        <p>导入订阅、选择节点，供 Cage 内所有程序共用。</p>
      </div>
      <div className="proxy-summary">
        <Server size={22} />
        <div>
          <strong>{selected?.name || "尚未选择节点"}</strong>
          <span>
            {proxy.active
              ? proxy.running
                ? "核心运行中"
                : "核心未就绪"
              : "尚未启用内置代理"}{" "}
            · 独立端口 {proxy.port}
          </span>
        </div>
        <span
          className={`proxy-badge ${proxy.running && proxy.active ? "online" : ""}`}
        >
          {proxy.active && proxy.running ? "已应用" : "离线"}
        </span>
      </div>
      {proxy.active && status.location && (
        <p className="field-help">
          最近检测出口：{status.location.ip} · {status.location.country}{" "}
          {status.location.city}。联网是否放行以工作台检查状态为准。
        </p>
      )}
      {!proxy.core_available && (
        <div role="alert" className="error-message">
          安装包缺少随附代理核心，请重新构建或安装完整 Cage 应用。
        </div>
      )}
      <p className="field-help">
        仅允许经节点转发的 IPv4 TCP 和 DNS；公网 UDP、IPv6、ICMP
        持续阻断。切换会关闭旧网络连接并重新检查出口。
      </p>
      <div role="tablist" aria-label="代理管理" className="proxy-tabs">
        {[
          ["nodes", "节点"],
          ["sources", "订阅"],
          ["connections", "连接"],
          ["diagnostics", "诊断"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "nodes" && (
        <>
          <div className="proxy-toolbar">
            <label className="proxy-search">
              <Search size={15} />
              <input
                aria-label="搜索节点"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索节点、来源或协议"
              />
            </label>
            <select
              aria-label="节点来源"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">全部来源</option>
              {proxy.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !proxy.running || !nodes.length}
              onClick={() => measure(nodes.map((n) => n.id))}
            >
              <Activity size={14} />
              测速
            </button>
          </div>
          {!allNodes.length ? (
            <div className="proxy-empty">
              <Download size={26} />
              <strong>添加第一份节点来源</strong>
              <p>支持 Clash/Mihomo YAML 订阅、本地配置或手动节点。</p>
              <button
                onClick={() => {
                  setTab("sources");
                  setForm({ ...emptyForm });
                  setMode("url");
                }}
              >
                <Plus size={15} />
                添加来源
              </button>
            </div>
          ) : (
            <div className="proxy-node-list">
              {nodes.map((n) => (
                <div
                  className={`proxy-node ${n.id === proxy.selected && proxy.active ? "selected" : ""}`}
                  key={n.id}
                >
                  <button
                    className="proxy-node-choice"
                    disabled={busy || !proxy.core_available}
                    onClick={() => select(n.id)}
                    aria-label={`选择节点 ${n.name}`}
                  >
                    <span className="proxy-radio">
                      {n.id === proxy.selected && proxy.active && (
                        <Check size={12} />
                      )}
                    </span>
                    <span>
                      <strong>{n.name}</strong>
                      <small>
                        {n.source} · {n.type.toUpperCase()}
                      </small>
                    </span>
                  </button>
                  <span className="proxy-delay">
                    {delays[n.id] || "未测速"}
                  </span>
                  <button
                    aria-label={`测速 ${n.name}`}
                    title="测试此节点延迟"
                    disabled={busy || !proxy.running}
                    onClick={() => measure([n.id])}
                  >
                    <Activity size={14} />
                  </button>
                </div>
              ))}
              {!nodes.length && (
                <p className="field-help">没有符合搜索条件的节点。</p>
              )}
            </div>
          )}
        </>
      )}
      {tab === "sources" && (
        <>
          <label className="check-line">
            <input
              type="checkbox"
              checked={hostRefresh}
              onChange={(e) => setHostRefresh(e.target.checked)}
            />
            手动更新订阅时通过主机网络下载
          </label>
          <p className="field-help">
            自动更新始终使用当前配置的代理，不会切换到主机下载。
          </p>
          <div className="proxy-toolbar">
            <span>
              {proxy.sources.length} 个来源 · {allNodes.length} 个节点
            </span>
            <button
              disabled={busy}
              onClick={() => {
                setForm({ ...emptyForm });
                setMode("url");
              }}
            >
              <Plus size={14} />
              添加来源
            </button>
          </div>
          {proxy.sources.map((s) => (
            <div className="proxy-source" key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.remote ? s.host : "本地导入"} · {s.nodes.length} 个节点 ·{" "}
                  {s.interval_hours && s.remote
                    ? `每 ${s.interval_hours} 小时更新`
                    : "手动更新"}
                </small>
                <small>
                  更新于 {new Date(s.updated_at).toLocaleString()}
                  {usageLabel(s.usage) && ` · ${usageLabel(s.usage)}`}
                </small>
                {s.error && (
                  <span className="proxy-source-error">{s.error}</span>
                )}
              </div>
              <div className="proxy-source-actions">
                {s.remote && (
                  <button
                    disabled={busy}
                    aria-label={`更新 ${s.name}`}
                    onClick={() =>
                      mutate("refresh", {
                        id: s.id,
                        host_download: hostRefresh,
                      })
                    }
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                <button
                  disabled={busy}
                  aria-label={`编辑 ${s.name}`}
                  onClick={() => {
                    setForm({
                      ...emptyForm,
                      id: s.id,
                      name: s.name,
                      interval_hours: s.interval_hours,
                      remote: s.remote,
                    });
                    setMode("url");
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  disabled={busy}
                  aria-label={`删除 ${s.name}`}
                  onClick={async () => {
                    if (
                      await onConfirm({
                        title: `删除来源“${s.name}”？`,
                        body: s.nodes.some((n) => n.id === proxy.selected)
                          ? "当前节点来自此来源。删除后 Cage 会保持离线，直到你选择其他节点。"
                          : "将移除此来源及其节点，本地项目文件不受影响。",
                        confirm: "删除来源",
                      })
                    )
                      mutate("delete", { id: s.id });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {form && (
            <div className="proxy-import">
              <h4>{form.id ? "编辑来源" : "添加节点来源"}</h4>
              {!form.id && (
                <div className="proxy-tabs">
                  {[
                    ["url", "订阅链接"],
                    ["file", "本地 YAML"],
                    ["manual", "手动节点"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={mode === id ? "selected" : ""}
                      onClick={() => {
                        setMode(id);
                        setForm((old) => ({ ...old, content: "", url: "" }));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <label>
                来源名称
                <input
                  value={form.name}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：日常代理"
                />
              </label>
              {mode === "url" && (!form.id || form.remote) && (
                <>
                  <label>
                    {form.id ? "新订阅链接（留空保留）" : "订阅链接"}
                    <input
                      value={form.url}
                      type="url"
                      autoComplete="off"
                      onChange={(e) =>
                        setForm({ ...form, url: e.target.value })
                      }
                      placeholder="https://…"
                    />
                  </label>
                  <label>
                    自动更新间隔
                    <select
                      value={form.interval_hours}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          interval_hours: Number(e.target.value),
                        })
                      }
                    >
                      {[
                        [0, "仅手动更新"],
                        [1, "每小时"],
                        [6, "每 6 小时"],
                        [24, "每天"],
                        [168, "每周"],
                      ].map(([v, label]) => (
                        <option value={v} key={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!form.id && (
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={form.host_download}
                        onChange={(e) =>
                          setForm({ ...form, host_download: e.target.checked })
                        }
                      />
                      通过主机网络下载这份订阅
                    </label>
                  )}
                  <p className="field-help">
                    默认经当前配置的代理下载。首次没有可用节点时，可勾选主机下载或导入本地文件；失败不会自动改用其他路径。
                  </p>
                </>
              )}
              {mode === "file" && !form.id && (
                <>
                  <input
                    hidden
                    type="file"
                    ref={file}
                    accept=".yaml,.yml,.json,text/yaml,application/yaml"
                    onChange={async (e) => {
                      const value = e.target.files?.[0];
                      if (!value) return;
                      if (value.size > 8 * 1024 * 1024) {
                        setError("文件超过 8 MiB");
                        return;
                      }
                      try {
                        const content = await value.text();
                        setForm((old) => ({
                          ...old,
                          content,
                          name: old.name || value.name.replace(/\.[^.]+$/, ""),
                          interval_hours: 0,
                        }));
                      } catch {
                        setError("文件读取失败，请重新选择");
                      }
                    }}
                  />
                  <button onClick={() => file.current.click()}>
                    <Upload size={14} />
                    选择 YAML 文件
                  </button>
                  <label>
                    或粘贴配置
                    <textarea
                      aria-label="节点 YAML"
                      rows={7}
                      value={form.content}
                      onChange={(e) =>
                        setForm({ ...form, content: e.target.value })
                      }
                      spellCheck={false}
                      placeholder="proxies: …"
                    />
                  </label>
                  <p className="field-help">
                    只导入节点和明确的代理链，Cage 自行管理
                    DNS、监听端口及出站规则。
                  </p>
                </>
              )}
              {mode === "manual" && !form.id && (
                <>
                  <div className="field-row">
                    <label>
                      节点名称
                      <input
                        value={manual.name}
                        onChange={(e) =>
                          setManual({ ...manual, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      协议
                      <select
                        value={manual.type}
                        onChange={(e) =>
                          setManual({ ...manual, type: e.target.value })
                        }
                      >
                        <option value="socks5">SOCKS5</option>
                        <option value="http">HTTP CONNECT</option>
                      </select>
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      服务器
                      <input
                        value={manual.server}
                        onChange={(e) =>
                          setManual({ ...manual, server: e.target.value })
                        }
                        placeholder="域名或 IP"
                      />
                    </label>
                    <label>
                      端口
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={manual.port}
                        onChange={(e) =>
                          setManual({ ...manual, port: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      用户名
                      <input
                        value={manual.username}
                        autoComplete="off"
                        onChange={(e) =>
                          setManual({ ...manual, username: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      密码
                      <input
                        type="password"
                        value={manual.password}
                        autoComplete="new-password"
                        onChange={(e) =>
                          setManual({ ...manual, password: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="proxy-form-actions">
                <button disabled={busy} onClick={() => setForm(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (!form.id &&
                      (mode === "url"
                        ? !form.url || !form.name
                        : mode === "file"
                          ? !form.content || !form.name
                          : !manual.name || !manual.server))
                  }
                  onClick={submit}
                >
                  {form.id ? "保存来源" : "导入并验证"}
                </button>
              </div>
            </div>
          )}
          <details className="proxy-migration">
            <summary>迁移已有 Cage 节点</summary>
            <p className="field-help">
              从当前 Cage 私有配置复制节点，不读取或修改本机 Clash 的选择。
            </p>
            <button disabled={busy} onClick={() => mutate("migrate")}>
              <Download size={14} />
              导入已有 Cage 节点
            </button>
          </details>
        </>
      )}
      {tab === "connections" && (
        <>
          <div className="proxy-metrics">
            <span>
              上传 <strong>{bytes(rates.up)}/s</strong>
              <small>累计 {bytes(connections.uploadTotal)}</small>
            </span>
            <span>
              下载 <strong>{bytes(rates.down)}/s</strong>
              <small>累计 {bytes(connections.downloadTotal)}</small>
            </span>
          </div>
          <p className="field-help">
            显示当前核心的连接与流量，包含 Cage
            自身检测请求；重启核心后累计值重置。
          </p>
          <div className="proxy-node-list">
            {connections.connections.map((c) => (
              <div className="proxy-connection" key={c.id}>
                <span>
                  {c.host}:{c.port}
                  <small>{c.network}</small>
                </span>
                <small>
                  ↑ {bytes(c.upload)} · ↓ {bytes(c.download)}
                </small>
              </div>
            ))}
            {!connections.connections.length && (
              <p className="proxy-empty">暂无活动连接</p>
            )}
          </div>
        </>
      )}
      {tab === "diagnostics" && (
        <>
          <p className="field-help">
            随附核心 {proxy.version || "未运行"}。以下为 Cage
            状态摘要；含凭据风险的核心原始日志不向页面公开。
          </p>
          <div className="proxy-diagnostics" role="log">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
          <label>
            独立代理端口
            <input
              type="number"
              min="1024"
              max="65535"
              value={port}
              onChange={(e) => {
                portDirty.current = true;
                setPort(e.target.value);
              }}
            />
          </label>
          <div className="proxy-toolbar">
            <button
              disabled={busy || !selected}
              onClick={async () => {
                if (
                  Number(port) !== proxy.port &&
                  status.vm_running &&
                  !(await onConfirm({
                    title: "更换代理端口并重启环境？",
                    body: "端口变化需要重启环境，当前终端会结束。",
                    confirm: "更换并重启",
                  }))
                )
                  return;
                mutate("restart", { port: Number(port) });
              }}
            >
              <RefreshCw size={14} />
              应用端口并重启核心
            </button>
            <button
              disabled={busy || !proxy.running}
              onClick={() => mutate("stop")}
            >
              <Square size={14} />
              停止核心
            </button>
          </div>
          <p className="field-help">
            Cage 不设置系统代理或主机 TUN。本机其他代理的 TUN
            仍可能影响核心出站，需要结合实际路由验证。
          </p>
        </>
      )}
      {pending && (
        <p className="proxy-progress" role="status">
          <LoaderCircle size={14} className="spin" />
          {pending === "delay"
            ? "正在检测节点延迟…"
            : status.job?.message || "正在处理…"}
        </p>
      )}
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="proxy-notice">
          <Check size={14} />
          {notice}
        </p>
      )}
    </div>
  );
}
