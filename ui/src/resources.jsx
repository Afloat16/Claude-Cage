import React, { useEffect, useState } from "react";
import { api } from "./api";
import { SafetyMessage } from "./safety-message";

const gib = (bytes) => `${(bytes / 1073741824).toFixed(1)} GiB`;

export function ResourceSettings({ status, onConfirm }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data && data.runtime !== "container") setDraft((current) => current || { automatic: data.automatic, memory_gib: data.memory_gib, cpus: data.cpus });
  }, [data]);
  const save = async (event) => {
    event.preventDefault();
    setStarting(true);
    setSaved(false);
    try {
      await api("/environment/resources", { allocation: draft });
      setData(await api("/environment/resources"));
      setSaved(true);
      setError("");
    } catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };
  useEffect(() => {
    let live = true;
    let timer;
    const refresh = async () => {
      try {
        const next = await api("/environment/resources");
        if (live) { setData(next); setReadError(""); }
      } catch (e) { if (live) setReadError(e.message); }
      if (live) timer = setTimeout(refresh, 4000);
    };
    refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [status.vm_running, status.job?.running]);
  const apply = async () => {
    if (!(await onConfirm({
      title: "重启并应用已保存的资源配置？",
      body: "正在运行的命令会结束，浏览器和编辑器会重启。请先保存内容；项目文件和登录数据保留。手动暂停的网络仍保持暂停。",
      confirm: "保存后重启",
    }))) return;
    setStarting(true);
    try { await api("/environment/resources", {}); setError(""); }
    catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };
  const observation = data?.observation;
  const guest = observation?.guest;
  const macOS = data?.runtime === "vz-macos";
  const fresh = observation && Date.now() - Date.parse(observation.observed_at) < 10000;
  const resourceError = error || readError || data?.resource_error;
  const resourcesVerified = data?.resources_verified === true && !resourceError;
  if (data?.runtime === "container") return <section className="environment-versions" aria-label="计算资源">
    <h4>服务器容器资源上限</h4>
    <p className="field-help">CPU、内存与进程数量由服务器上的容器资源组限制。</p>
    <div className="setting-summary-row"><span>资源限制核验</span><strong>{data.running ? resourcesVerified ? "已核验" : "未通过核验" : "环境未运行"}</strong></div>
    <div className="setting-summary-row"><span>容器内存上限</span><strong>{data.running ? resourcesVerified ? gib(data.configured_memory_bytes) : "未核验" : gib(data.recommended_memory_bytes)}</strong></div>
    <div className="setting-summary-row"><span>容器 CPU 上限</span><strong>{data.running ? resourcesVerified ? `${data.configured_cpus} 个逻辑核心` : "未核验" : `${data.recommended_cpus} 个逻辑核心`}</strong></div>
    <div className="setting-summary-row"><span>进程与线程总数上限</span><strong>{data.running ? resourcesVerified ? data.pids_limit : "未核验" : "运行后核验"}</strong></div>
    <p className="field-help">{data.running ? resourcesVerified ? "已从服务器核验容器所属资源组的实际限制。实时内存与 CPU 用量尚未提供。" : "无法确认运行中容器的实际资源限制，请查看下方错误或等待重新核验。" : "环境尚未运行，当前显示部署配置中的资源上限。"}</p>
    {resourceError && <p role="alert" className="error-message"><SafetyMessage message={resourceError} /></p>}
  </section>;
  return <section className="environment-versions" aria-label="计算资源">
    <h4>计算资源</h4>
    <p className="field-help">{macOS ? "macOS 客机使用固定的启动内存容量，修改容量需要重启。CPU 按实际任务使用，核心数表示可同时使用的逻辑核心数。自动上限使用主机资源的一半，并受这台客机的最低配置约束。" : "内存随程序需求增长，持续空闲后逐步归还主机。默认上限为主机资源的一半；CPU 按实际任务使用，上限表示可同时使用的逻辑核心数。"}</p>
    <div className="setting-summary-row"><span>自动内存上限</span><strong>{data ? gib(data.recommended_memory_bytes) : "正在读取…"}</strong></div>
    <div className="setting-summary-row"><span>自动 CPU 上限</span><strong>{data ? `${data.recommended_cpus} 个逻辑核心` : "—"}</strong></div>
    {draft && <form className="resource-allocation" onSubmit={save} onChange={() => setSaved(false)}>
      <label className="check-line"><input type="checkbox" checked={draft.automatic} onChange={(e) => setDraft({ ...draft, automatic: e.target.checked })} />自动分配资源上限</label>
      {!draft.automatic && <>
        <label>内存上限（GiB）<input aria-label="内存上限（GiB）" type="number" min={data.min_memory_gib || 2} max={data.max_memory_gib} step="1" required value={draft.memory_gib} onChange={(e) => setDraft({ ...draft, memory_gib: e.target.value === "" ? "" : Number(e.target.value) })} /></label>
        <label>CPU 逻辑核心数<input aria-label="CPU 逻辑核心数" type="number" min={data.min_cpus || 1} max={data.max_cpus} step="1" required value={draft.cpus} onChange={(e) => setDraft({ ...draft, cpus: e.target.value === "" ? "" : Number(e.target.value) })} /></label>
        <p className="field-help">可设置 {data.min_memory_gib || 2}–{data.max_memory_gib} GiB 内存、{data.min_cpus || 1}–{data.max_cpus} 个逻辑核心。{macOS ? "保存后在下次启动时应用。" : "内存仍会在上限内按需分配和回收。"}</p>
      </>}
      <button type="submit" disabled={starting || status.job?.running}>保存资源配置</button>
      {saved && <p role="status" className="field-help">已保存，{data.running ? "重启环境后生效。" : "下次启动环境时生效。"}</p>}
    </form>}
    {macOS && data.minimum_requirements?.source === "existing-configuration" && <p className="field-help">当前最低值沿用已有启动配置。尚未从原恢复镜像读回 Apple 的最低要求。</p>}
    {data?.running && <>
      <div className="setting-summary-row"><span>本次启动的内存上限</span><strong>{gib(data.configured_memory_bytes)}</strong></div>
      <div className="setting-summary-row"><span>本次启动的 CPU 上限</span><strong>{data.configured_cpus} 个逻辑核心</strong></div>
      <div className="setting-summary-row"><span>{macOS ? "环境内存用量（估算）" : "环境内存用量"}</span><strong>{fresh && guest ? gib(guest.total_bytes - guest.available_bytes) : "等待采样"}</strong></div>
      <div className="setting-summary-row"><span>{macOS ? "客机物理内存容量" : "环境当前可用内存总量"}</span><strong>{fresh && guest ? gib(guest.total_bytes) : "—"}</strong></div>
      <div className="setting-summary-row"><span>CPU 使用率</span><strong>{fresh && Number.isFinite(observation.cpu_percent) ? `${observation.cpu_percent.toFixed(0)}% / ${observation.cpus} 个核心` : "等待采样"}</strong></div>
      {fresh && guest?.oom_kills > 0 && <p className="field-help" role="status">本次环境启动后，系统因内存不足终止过 {guest.oom_kills} 个进程。请降低重任务的并行数量，或使用内存更多的主机。</p>}
      {(observation?.pressure || observation?.host_pressure) && <p className="field-help" role="status">{macOS ? "客机内存压力升高，请减少并行任务，或保存工作后调整内存上限并重启。" : observation.host_pressure ? "主机内存紧张，暂缓扩大分配。" : "环境内存紧张，正在上限内增加可用内存。达到上限后请减少同时运行的任务。"}</p>}
      {data.restart_required && <button disabled={starting || status.job?.running} onClick={apply}>重启并应用已保存配置</button>}
    </>}
    {!data?.running && data && <p className="field-help">下次启动环境时应用已保存的资源配置。</p>}
    {(resourceError || observation?.error) && <p role="alert" className="error-message"><SafetyMessage message={resourceError || observation.error} /></p>}
    <p className="field-help">{macOS ? "内存估算使用客机物理容量减去空闲与非活跃页，压缩页计入用量。CPU 来自连续两次 Mach 计数采样。当前缺少可核验的内存回收量，Cage 使用固定容量；OOM 终止计数尚未提供。主机系统监视器还会统计虚拟化开销。" : data?.runtime === "hyperv" ? "内存与 CPU 用量来自 Windows 客机的系统观测。Hyper-V 会在设置的内存上下限内分配和回收内存；主机系统监视器还会统计虚拟化开销。" : "内存用量不含可回收缓存；这些数值反映环境内部状态，主机系统监视器还会统计虚拟化开销。短时故障导致内部断网后，会自动重新检查，通过后恢复；手动暂停需手动恢复。"}</p>
  </section>;
}
