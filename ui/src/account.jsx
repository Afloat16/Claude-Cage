import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Camera,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  LogOut,
  Settings2,
} from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import logo from "./logo.png";
import "./account.css";

const AccountContext = createContext(null);
export const useAccount = () => useContext(AccountContext);

export function AccountProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [deviceSupport, setDeviceSupport] = useState(null);
  const [deviceNotice, setDeviceNotice] = useState("");
  const sequence = useRef(0);
  const refresh = async () => {
    const current = ++sequence.current;
    try {
      const value = await api("/account");
      if (sequence.current === current) {
        setAccount(value);
        setError("");
      }
      return value;
    } catch (e) {
      if (sequence.current === current) setError(e.message);
      throw e;
    }
  };
  const act = async (action, input = {}) => {
    const current = ++sequence.current;
    const value = await api(`/account/${action}`, input);
    if (action !== "logout" && sequence.current === current) setAccount(value);
    return value;
  };
  useEffect(() => {
    if (!account || deviceSupport !== null) return;
    if (!nativeAvailable()) { setDeviceSupport({ supported: false }); return; }
    let live = true;
    native("accountDevice", { operation: "status" })
      .then((value) => { if (live) setDeviceSupport(value || { supported: false }); })
      .catch(() => { if (live) setDeviceSupport({ supported: false }); });
    return () => { live = false; };
  }, [Boolean(account), deviceSupport]);
  const deviceAction = async (operation, kind) => {
    await native("accountDevice", { operation, kind });
    return refresh();
  };
  useEffect(() => {
    let live = true,
      timer;
    const poll = async () => {
      try {
        await refresh();
      } catch {
        /* Keep the last state while disconnected. */
      }
      if (live) timer = setTimeout(poll, document.hidden ? 10000 : 2500);
    };
    const start = async () => {
      try {
        if (location.hash) {
          await api("/session", { token: location.hash.slice(1) });
          history.replaceState(null, "", location.pathname);
        }
        window.dispatchEvent(new Event("cage-session-ready"));
        if (live) await poll();
      } catch (e) {
        if (live) setError(e.message);
      }
    };
    const locked = () => {
      setAccount((previous) =>
        previous ? { ...previous, unlocked: false } : previous,
      );
      refresh().catch(() => {});
    };
    start();
    window.addEventListener("cage-account-locked", locked);
    return () => {
      live = false;
      sequence.current++;
      clearTimeout(timer);
      window.removeEventListener("cage-account-locked", locked);
    };
  }, []);
  return (
    <AccountContext.Provider value={{ account, error, refresh, act, deviceSupport, deviceAction, deviceNotice, setDeviceNotice }}>
      {children}
    </AccountContext.Provider>
  );
}

export function AccountAvatar({ account, large = false }) {
  const initial = Array.from(
    account?.username?.trim() || "C",
  )[0].toLocaleUpperCase();
  return (
    <span
      className={`account-avatar ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      {account?.avatar ? <img src={account.avatar} alt="" /> : initial}
    </span>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "current-password",
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          maxLength={1024}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </div>
  );
}

export function AccountGate({ children }) {
  const { account, error: connectionError, refresh, act, deviceSupport, deviceAction, setDeviceNotice } = useAccount();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const automaticAttempt = useRef("");
  const gateAcknowledged = useRef(false);
  useEffect(() => {
    if (!account || account.unlocked || connectionError || gateAcknowledged.current || !nativeAvailable()) return;
    // A working lock/setup screen is a valid upgraded UI. Waiting for the
    // user's password would incorrectly leave the native update unconfirmed.
    native("workbenchReady").then((accepted) => {
      if (accepted === true) gateAcknowledged.current = true;
    }).catch(() => {});
  }, [Boolean(account), account?.unlocked, connectionError]);
  useEffect(() => {
    const id = account?.devices?.automatic;
    if (!id || account.unlocked || account.require_authentication || !deviceSupport?.supported || automaticAttempt.current === id) return;
    automaticAttempt.current = id;
    setBusy(true);
    deviceAction("unlock", "automatic").catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, [account?.unlocked, account?.devices?.automatic, account?.require_authentication, deviceSupport]);
  useEffect(() => {
    if (account?.unlocked) return;
    window.cageNativeAction = async (action) => {
      if (action === "quit") await native("quitNow");
    };
    return () => {
      delete window.cageNativeAction;
    };
  }, [account?.unlocked]);
  if (account?.unlocked) return children;
  const creating = account && !account.exists;
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (creating && password !== confirmation) {
      setError("两次密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await act(
        creating ? "create" : "unlock",
        creating
          ? { username, password, confirm_password: confirmation }
          : { password },
      );
      setPassword("");
      setConfirmation("");
      if (creating && rememberLogin && deviceSupport?.supported) {
        try { await deviceAction("enable", "automatic"); }
        catch (e) { setDeviceNotice(`账户已创建，记住登录未能开启：${e.message}。可在「设置 → 账户」中重试。`); }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="account-gate">
      <div className="account-brand">
        <img src={logo} alt="" />
        Cage
      </div>
      <section
        className="account-entry"
        aria-label={creating ? "创建本地账户" : "解锁 Cage"}
      >
        {creating ? (
          <img className="account-welcome-logo" src={logo} alt="" />
        ) : (
          account && <AccountAvatar account={account} large />
        )}
        <h1>
          {creating
            ? "让 Cage 成为你的工作空间"
            : account
              ? `欢迎回来，${account.username}`
              : "正在连接 Cage"}
        </h1>
        <p className="account-entry-intro">
          {creating
            ? "创建一个本地账户，收好你的工作与登录状态。"
            : account
              ? "输入密码，继续你的工作。"
              : "正在读取本机账户…"}
        </p>
        {account?.background_running && (
          <div className="account-background">
            <i />
            后台环境仍在运行，任务没有停止
          </div>
        )}
        {account && (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {creating && (
                <label className="account-field">
                  用户名
                  <input
                    autoFocus
                    autoComplete="username"
                    maxLength={40}
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="你希望怎样被称呼"
                  />
                </label>
              )}
              <PasswordField
                label={creating ? "设置密码" : "账户密码"}
                value={password}
                onChange={setPassword}
                autoComplete={creating ? "new-password" : "current-password"}
              />
              {creating && (
                <PasswordField
                  label="确认密码"
                  value={confirmation}
                  onChange={setConfirmation}
                  autoComplete="new-password"
                />
              )}
              {(error || connectionError) && (
                <p className="account-error" role="alert">
                  {error || connectionError}
                </p>
              )}
              {creating && deviceSupport?.supported && (
                <label className="account-device-option check-line">
                  <input type="checkbox" checked={rememberLogin} onChange={(e) => setRememberLogin(e.target.checked)} />
                  <span><strong>记住登录</strong><small>下次打开直接进入。手动锁定后仍需验证。</small></span>
                </label>
              )}
              {!creating && deviceSupport?.supported && account.devices?.biometric && (
                <button type="button" className="quiet-button account-submit" disabled={busy}
                  onClick={async () => {
                    setBusy(true); setError("");
                    try { await deviceAction("unlock", "biometric"); }
                    catch (e) { setError(e.message); }
                    finally { setBusy(false); }
                  }}>
                  <Fingerprint size={18} />使用 Touch ID 解锁
                </button>
              )}
              <button
                className="primary account-submit"
                disabled={busy || !password || (creating && (!username.trim() || (nativeAvailable() && deviceSupport === null)))}
              >
                {busy ? "正在解锁…" : creating ? "创建本地账户" : "解锁 Cage"}
              </button>
            </fieldset>
          </form>
        )}
        {!account && connectionError && (
          <>
            <p role="alert" className="account-error">
              {connectionError}
            </p>
            <button onClick={() => refresh().catch(() => {})}>重新连接</button>
          </>
        )}
        <p className="account-local-note">
          <LockKeyhole size={14} />
          账户资料仅保存在这台设备上
        </p>
        <p className="account-recovery-note">
          {creating
            ? "密码至少 8 个字符，用于保护应用登录凭据。请妥善保存，当前不支持在线找回。"
            : "请输入本地账户密码；当前不支持在线找回。"}
        </p>
      </section>
      {nativeAvailable() && (
        <button
          className="text-button account-exit-app"
          onClick={() => native("quitNow").catch((e) => setError(e.message))}
        >
          {account?.background_running ? "退出应用，后台继续运行" : "退出 Cage"}
        </button>
      )}
    </main>
  );
}

export function AccountMenu({ onSettings, onConfirm, onStatus, busy }) {
  const { account, act, deviceNotice, setDeviceNotice } = useAccount();
  useEffect(() => {
    if (deviceNotice) { onStatus(deviceNotice); setDeviceNotice(""); }
  }, [deviceNotice]);
  const [open, setOpen] = useState(false);
  const root = useRef();
  useEffect(() => {
    if (!open) return;
    root.current.querySelector('[role="menuitem"]').focus();
    const dismiss = (event) => {
      if (
        event.key === "Escape" ||
        (event.type === "click" && !root.current?.contains(event.target))
      ) {
        if (event.key === "Escape") root.current?.querySelector(".account-trigger")?.focus();
        setOpen(false);
      }
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  const perform = async (action) => {
    setOpen(false);
    if (
      action === "logout" &&
      !(await onConfirm({
        title: "退出本地账户？",
        body: "这会停止 Cage 环境与后台任务，并锁定登录凭据。请先保存文件。",
        confirm: "停止环境并退出账户",
      }))
    )
      return;
    try {
      await act(action);
    } catch (e) {
      onStatus(e.message);
    }
  };
  return (
    <div className="account-menu-root" ref={root}>
      <button
        className="account-trigger"
        aria-label={`账户菜单，${account.username}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <AccountAvatar account={account} />
        <span className="account-trigger-name">
          <strong>{account.username}</strong>
          <small>本地账户</small>
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label="本地账户菜单"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll("button:enabled")];
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(items.indexOf(event.target) + step + items.length) % items.length].focus();
          }}
        >
          <div className="account-menu-label">你的 Cage</div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSettings("account");
            }}
          >
            <Settings2 size={16} />
            设置
          </button>
          <div className="account-menu-divider" />
          <button role="menuitem" onClick={() => perform("lock")}>
            <LockKeyhole size={16} />
            锁定 Cage<small>任务继续运行</small>
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => perform("logout")}
          >
            <LogOut size={16} />
            退出账户
          </button>
        </div>
      )}
    </div>
  );
}

export function AccountSettings({ busy: environmentBusy, onDirty }) {
  const { account, act } = useAccount();
  const [name, setName] = useState(account.username),
    [avatar, setAvatar] = useState(account.avatar || "");
  const [oldPassword, setOldPassword] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [feedbackTarget, setFeedbackTarget] = useState("profile");
  const file = useRef();
  const changed =
    name !== account.username || avatar !== (account.avatar || "");
  useEffect(() => {
    onDirty?.(changed || Boolean(oldPassword || password || confirmation));
  }, [changed, oldPassword, password, confirmation]);
  useEffect(() => () => onDirty?.(false), []);
  const upload = async (event) => {
    setFeedbackTarget("profile");
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (
      selected.size > 2 * 1024 * 1024 ||
      !["image/png", "image/jpeg"].includes(selected.type)
    ) {
      setError("请选择不超过 2 MB 的 PNG 或 JPEG 图片");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(reader.result);
      setError("");
      setMessage("");
    };
    reader.readAsDataURL(selected);
  };
  const save = async (event, changingPassword = false) => {
    event.preventDefault();
    if (busy) return;
    setFeedbackTarget(changingPassword ? "password" : "profile");
    if (changingPassword && password !== confirmation) {
      setError("两次密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await act(
        changingPassword ? "password" : "profile",
        changingPassword
          ? {
              old_password: oldPassword,
              password,
              confirm_password: confirmation,
            }
          : { username: name, avatar },
      );
      if (changingPassword) {
        setOldPassword("");
        setPassword("");
        setConfirmation("");
        setMessage("密码已修改，应用登录状态保持不变");
      } else {
        setName(value.username);
        setAvatar(value.avatar || "");
        setMessage("账户资料已保存");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const feedback = (
    <>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-saved" role="status">
          <Check size={15} />
          {message}
        </p>
      )}
    </>
  );
  return (
    <div className="account-settings">
      <div className="section-title">
        <h3>账户</h3>
        <p>给工作空间一点你的样子。</p>
      </div>
      <form onSubmit={(event) => save(event)}>
        <fieldset disabled={busy || environmentBusy}>
          <div className="account-profile-heading">
            <AccountAvatar account={{ username: name, avatar }} large />
            <div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => file.current.click()}
              >
                <Camera size={16} />
                更换头像
              </button>
              {avatar && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAvatar("")}
                >
                  恢复默认
                </button>
              )}
              <p className="field-help">
                PNG 或 JPEG，最多 2 MB，自动居中裁切。
              </p>
            </div>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={upload}
            aria-label="选择头像图片"
          />
          <label className="account-field">
            用户名
            <input
              value={name}
              maxLength={40}
              autoComplete="username"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <button
            className="primary"
            disabled={!changed || !name.trim() || busy}
          >
            <Check size={16} />
            保存资料
          </button>
        </fieldset>
      </form>
      {feedbackTarget === "profile" && feedback}
      <div className="account-section-divider" />
      <form onSubmit={(event) => save(event, true)}>
        <fieldset disabled={busy || environmentBusy}>
          <h4>账户密码</h4>
          <p className="field-help">
            修改密码不会清除 Claude
            的登录状态。密码仅用于本机解锁，没有在线找回。
          </p>
          <PasswordField
            label="当前密码"
            value={oldPassword}
            onChange={setOldPassword}
          />
          <PasswordField
            label="新密码"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <PasswordField
            label="确认新密码"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
          />
          <button
            className="quiet-button"
            disabled={busy || !oldPassword || !password || !confirmation}
          >
            修改密码
          </button>
        </fieldset>
      </form>

      {feedbackTarget === "password" && feedback}
      <AccountDeviceSettings />
      <p className="account-settings-note">
        <LockKeyhole size={15} />
        一个本地账户，一个持久工作环境。资料与凭据不上传到 Cage 服务器。
      </p>
    </div>
  );
}

function AccountDeviceSettings() {
  const { account, deviceSupport, deviceAction } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (!deviceSupport?.supported) return null;
  const change = async (kind, enabled) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await deviceAction(enabled ? "enable" : "disable", kind);
      setMessage(enabled ? "已开启，解锁凭据保存在这台 Mac 的系统钥匙串中" : "已关闭快捷登录授权");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="account-device-settings" aria-label="登录与解锁">
    <h4>登录与解锁</h4>
    <label className="account-device-option check-line">
      <input type="checkbox" checked={Boolean(account.devices?.automatic)} disabled={busy}
        onChange={(event) => change("automatic", event.target.checked)} />
      <span><strong>记住登录</strong><small>重新打开直接进入。手动锁定后仍需指纹或密码。</small></span>
    </label>
    <label className="account-device-option check-line">
      <input type="checkbox" checked={Boolean(account.devices?.biometric)} disabled={busy || (!deviceSupport.biometric_available && !account.devices?.biometric)}
        onChange={(event) => change("biometric", event.target.checked)} />
      <span><strong>使用 Touch ID 解锁</strong><small>{deviceSupport.biometric_available ? "手动锁定后，通过系统指纹验证进入。" : "请先在 macOS 系统设置中设置 Touch ID。"}</small></span>
    </label>
    <p className="field-help">退出账户会撤销本机快捷登录授权。密码始终可以用于解锁。</p>
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p className="account-saved" role="status">{message}</p>}
  </section>;
}
