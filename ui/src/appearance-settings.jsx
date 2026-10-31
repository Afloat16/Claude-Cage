import React, { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { api } from "./api";
import { useAppearance } from "./appearance";
import {
  mix,
  presets,
  presetNames,
  systemUIFont,
  systemCodeFont,
  themeVariables,
} from "./appearance-state.mjs";

function SettingRow({ label, description, children }) {
  return (
    <div className="appearance-row">
      <div>
        <span>{label}</span>
        {description && <p>{description}</p>}
      </div>
      <div className="appearance-control">{children}</div>
    </div>
  );
}
function FontSizeInput({ label, value, min, onChange }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="font-size-control">
      <input
        aria-label={label}
        type="number"
        min={min}
        max="24"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const number = Number(event.target.value);
          if (Number.isInteger(number) && number >= min && number <= 24)
            onChange(number);
        }}
        onBlur={() => setText(String(value))}
      />
      <span>px</span>
    </div>
  );
}
function ThemeCard({ variant, value, active, onChange }) {
  const [advanced, setAdvanced] = useState(false);
  const label = variant === "light" ? "浅色主题" : "深色主题";
  const options = presets[variant];
  const patch = (delta) => onChange({ ...value, ...delta });
  const vars = themeVariables(value, variant);
  return (
    <section
      className={`appearance-theme-card ${active ? "current" : ""}`}
      aria-label={label}
    >
      <div className="theme-card-heading">
        <strong>{label}</strong>
        {active && <small>当前使用</small>}
        <select
          aria-label={label + "预设"}
          value={value.preset}
          onChange={(e) =>
            patch({ ...options[e.target.value], preset: e.target.value })
          }
        >
          {Object.keys(options).map((key) => (
            <option key={key} value={key}>
              {presetNames[key]}
            </option>
          ))}
          {!options[value.preset] && (
            <option value={value.preset}>
              {presetNames[value.preset] || "自定义"}
            </option>
          )}
        </select>
      </div>
      <div
        className="theme-miniature"
        aria-hidden="true"
        style={{ ...vars, background: value.surface, color: value.ink }}
      >
        <div
          className="mini-sidebar"
          style={{ background: mix(value.surface, value.ink, 0.055) }}
        >
          <i />
          <i />
          <i />
        </div>
        <div className="mini-content">
          <span style={{ background: value.ink }} />
          <span />
          <div style={{ borderColor: vars["--line"] }}>
            <i />
            <b style={{ background: value.accent }} />
          </div>
        </div>
      </div>
      <div className="theme-colors">
        {[
          ["accent", "强调色"],
          ["surface", "背景"],
          ["ink", "文字"],
        ].map(([key, name]) => (
          <label key={key}>
            <input
              type="color"
              aria-label={label + name}
              value={value[key]}
              onChange={(e) => patch({ [key]: e.target.value })}
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <button
        className="theme-customize"
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
      >
        自定义
        <ChevronDown size={14} className={advanced ? "rotated" : ""} />
      </button>
      {advanced && (
        <div className="theme-options">
          <label>
            对比度 <output>{value.contrast}</output>
            <input
              aria-label={label + "对比度"}
              type="range"
              min="0"
              max="100"
              value={value.contrast}
              onChange={(e) => patch({ contrast: Number(e.target.value) })}
            />
          </label>
          <label>
            界面字体
            <input
              aria-label={label + "界面字体"}
              list="ui-fonts"
              value={value.fonts.ui}
              placeholder="系统默认"
              onChange={(e) =>
                patch({ fonts: { ...value.fonts, ui: e.target.value } })
              }
            />
          </label>
          <label>
            代码字体
            <input
              aria-label={label + "代码字体"}
              list="code-fonts"
              value={value.fonts.code}
              placeholder="系统等宽字体"
              onChange={(e) =>
                patch({ fonts: { ...value.fonts, code: e.target.value } })
              }
            />
          </label>
          <label className="appearance-switch">
            <span>半透明侧栏</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={label + "半透明侧栏"}
              checked={!value.opaqueWindows}
              onChange={(e) => patch({ opaqueWindows: !e.target.checked })}
            />
          </label>
        </div>
      )}
    </section>
  );
}
export function AppearanceSettings() {
  const { appearance, theme, variant, loading, saving, error, update, retry } =
    useAppearance();
  const [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState(""),
    [synced, setSynced] = useState(false);
  const patch = (delta) => update((previous) => ({ ...previous, ...delta }));
  const sync = async () => {
    setSyncing(true);
    setSyncError("");
    setSynced(false);
    try {
      const value = await api("/appearance/codex");
      await update(value);
      setSynced(true);
    } catch (e) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="appearance-settings">
      <div className="section-title">
        <h3>外观</h3>
        <p>更改自动保存并即时生效，无需重启项目。</p>
      </div>
      <fieldset disabled={loading || syncing} className="appearance-fields">
        <SettingRow
          label="主题"
          description="跟随系统，或固定使用浅色、深色外观。"
        >
          <div className="appearance-mode" role="group" aria-label="主题模式">
            {[
              ["light", "浅色", Sun],
              ["dark", "深色", Moon],
              ["system", "跟随系统", Monitor],
            ].map(([mode, label, Icon]) => (
              <button
                key={mode}
                aria-pressed={appearance.mode === mode}
                onClick={() => patch({ mode })}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </SettingRow>
        <div className="theme-card-grid">
          {["light", "dark"].map((key) => (
            <ThemeCard
              key={key}
              variant={key}
              value={appearance[key + "Theme"]}
              active={variant === key}
              onChange={(value) => patch({ [key + "Theme"]: value })}
            />
          ))}
        </div>
        <h4>字体</h4>
        <SettingRow
          label="界面字号"
          description="调整导航、标签和设置中的文字大小。"
        >
          <FontSizeInput
            label="界面字号"
            value={appearance.uiFontSize}
            min={12}
            onChange={(value) => patch({ uiFontSize: value })}
          />
        </SettingRow>
        <SettingRow
          label="代码字号"
          description="调整内置终端与代码预览的文字大小。"
        >
          <FontSizeInput
            label="代码字号"
            value={appearance.codeFontSize}
            min={10}
            onChange={(value) => patch({ codeFontSize: value })}
          />
        </SettingRow>
        <div
          className="appearance-sample"
          style={{ fontFamily: theme.fonts.ui || systemUIFont }}
        >
          <span>在熟悉的工作区，专注下一步。</span>
          <code
            style={{
              fontFamily: theme.fonts.code || systemCodeFont,
              fontSize: appearance.codeFontSize,
            }}
          >
            const workspace = "Cage";
          </code>
        </div>
        <h4>显示与交互</h4>
        <SettingRow
          label="使用指针光标"
          description="悬停在按钮等可交互元素上时显示手形。"
        >
          <label className="appearance-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="使用指针光标"
              checked={appearance.pointerCursors}
              onChange={(e) => patch({ pointerCursors: e.target.checked })}
            />
          </label>
        </SettingRow>
        <SettingRow label="字体平滑">
          <label className="appearance-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="字体平滑"
              checked={appearance.fontSmoothing}
              onChange={(e) => patch({ fontSmoothing: e.target.checked })}
            />
          </label>
        </SettingRow>
        <SettingRow label="减少动态效果">
          <select
            aria-label="减少动态效果"
            value={appearance.reducedMotion}
            onChange={(e) => patch({ reducedMotion: e.target.value })}
          >
            <option value="system">跟随系统</option>
            <option value="on">开启</option>
            <option value="off">关闭</option>
          </select>
        </SettingRow>
        <div className="appearance-import">
          <div>
            <strong>沿用 Codex 的外观</strong>
            <p>导入本机 Codex 当前的主题、配色与字体偏好。</p>
          </div>
          <button onClick={sync}>
            {syncing ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Download size={15} />
            )}
            从本机 Codex 同步
          </button>
        </div>
      </fieldset>
      <div className="appearance-save-state" role="status">
        {saving ? (
          <>
            <LoaderCircle size={13} className="spin" />
            正在保存…
          </>
        ) : error ? (
          <>
            <span>未保存</span>
            <button className="text-button" onClick={retry}>
              重试保存
            </button>
          </>
        ) : (
          <>
            <Check size={14} />
            {synced ? "已同步 Codex 外观" : "更改自动保存，即时生效"}
          </>
        )}
      </div>
      {(error || syncError) && (
        <div className="error-message" role="alert">
          {syncError || error}
        </div>
      )}
      <datalist id="ui-fonts">
        <option value="system-ui" />
        <option value="PingFang SC" />
        <option value="Helvetica Neue" />
        <option value="Arial" />
      </datalist>
      <datalist id="code-fonts">
        <option value="SF Mono" />
        <option value="Menlo" />
        <option value="Monaco" />
        <option value="JetBrains Mono" />
      </datalist>
    </div>
  );
}
