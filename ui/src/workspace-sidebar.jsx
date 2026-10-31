import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  FileCode2,
  FolderOpen,
  Globe2,
  Home,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Settings2,
  TerminalSquare,
  X,
} from "lucide-react";
import { EnvironmentShield } from "./environment-shield";
import { projectName, tabName } from "./workspace-state.mjs";

export const TabIcon = ({ kind, size = 16 }) =>
  kind === "terminal" ? (
    <TerminalSquare size={size} />
  ) : kind === "editor" ? (
    <FileCode2 size={size} />
  ) : (
    <Globe2 size={size} />
  );

export function WorkspaceSidebar({
  workspace,
  projects,
  tabs,
  saved,
  active,
  home,
  busy,
  ready,
  running,
  runtimeLabel,
  network,
  onHome,
  onOpenProject,
  onSelect,
  onClose,
  onRename,
  onPin,
  onReorder,
  onForgetProject,
  onNew,
  onEditor,
  onSettings,
  onSafety,
  onCollapse,
}) {
  const [expanded, setExpanded] = useState(true);
  const [menu, setMenu] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [menuTop, setMenuTop] = useState(0);
  const menuTrigger = useRef();
  const toggleMenu = (id, event) => {
    menuTrigger.current = event.currentTarget;
    setMenuTop(
      Math.max(
        8,
        Math.min(
          event.currentTarget.getBoundingClientRect().bottom + 4,
          window.innerHeight - 160,
        ),
      ),
    );
    setMenu(menu === id ? null : id);
  };
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenu(null);
        menuTrigger.current?.focus();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [menu]);
  const project = "Cage 环境";
  const healthy = ready && network.mode === "open";
  return (
    <aside className="workspace-sidebar" aria-label="项目与标签">
      <div className="sidebar-top">
        <span className="sidebar-brand">
          <EnvironmentShield size={21} healthy={healthy} />
          Cage
        </span>
        <button
          className="icon-button"
          onClick={onCollapse}
          aria-label="收起侧栏"
          title="收起侧栏"
        >
          <PanelLeftClose size={17} />
        </button>
      </div>
      <nav className="sidebar-navigation" aria-label="主导航">
        <button
          className={`sidebar-link ${home ? "selected" : ""}`}
          onClick={onHome}
        >
          <Home size={17} />
          工作台
        </button>
        <button
          className="sidebar-link"
          onClick={() => onNew("web")}
          disabled={!ready || busy}
          aria-label="打开浏览器"
          title="打开浏览器 ⌘T"
        >
          <Globe2 size={17} />
          打开浏览器<span className="shortcut-hint">⌘T</span>
        </button>
        <button
          className="sidebar-link"
          onClick={() => onOpenProject()}
          disabled={busy || !running}
        >
          <FolderOpen size={17} />
          打开项目<span className="shortcut-hint">⌘O</span>
        </button>
        <button
          className="sidebar-link"
          onClick={onEditor}
          disabled={!ready || busy}
        >
          <FileCode2 size={17} />
          项目文件
          <ArrowUpRight size={13} className="trailing-icon" />
        </button>
      </nav>
      <div className="sidebar-scroll">
        <div className="sidebar-section-heading">
          <span>环境标签</span>
          <button
            className="icon-button"
            onClick={() => onOpenProject()}
            aria-label="添加项目"
            title="添加项目"
            disabled={busy || !running}
          >
            <Plus size={15} />
          </button>
        </div>
        {workspace ? (
          <>
            <div className="project-heading">
              <button
                className="project-disclosure"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                title="所有项目共用的 Cage 环境"
              >
                <ChevronDown
                  size={13}
                  className={expanded ? "" : "collapsed"}
                />
                <FolderOpen size={16} />
                <span>{project}</span>
              </button>
              <button
                className="icon-button"
                aria-label="新建标签"
                title="新建标签"
                onClick={(event) => toggleMenu("new", event)}
                disabled={!running || busy}
              >
                <Plus size={15} />
              </button>
              {menu === "new" && (
                <>
                  <div className="menu-dismiss" onClick={() => setMenu(null)} />
                  <div
                    className="menu sidebar-menu"
                    style={{ top: menuTop }}
                    role="menu"
                    aria-label="新建标签"
                  >
                    <button
                      role="menuitem"
                      disabled={!ready}
                      onClick={() => {
                        setMenu(null);
                        onNew("web");
                      }}
                    >
                      <Globe2 size={16} />
                      浏览器<kbd>⌘T</kbd>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        onNew("terminal");
                      }}
                    >
                      <TerminalSquare size={16} />
                      终端<kbd>⌘⇧↵</kbd>
                    </button>
                    <button
                      role="menuitem"
                      disabled={!ready}
                      onClick={() => {
                        setMenu(null);
                        onEditor();
                      }}
                    >
                      <FileCode2 size={16} />
                      文件编辑器
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className={`project-children ${expanded ? "expanded" : ""}`}>
              <div>
                <div
                  role="tablist"
                  aria-label="工作区标签"
                  aria-orientation="vertical"
                  className="sidebar-tabs"
                >
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`sidebar-tab ${tab.id === active && !home ? "active" : ""} ${tab.closed ? "ended" : ""}`}
                      draggable={!busy}
                      onDragStart={(event) => {
                        setDragged(tab.id);
                        event.dataTransfer.setData("text/plain", tab.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        if (dragged) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (dragged) onReorder(dragged, tab.id);
                        setDragged(null);
                      }}
                      onDragEnd={() => setDragged(null)}
                    >
                      <button
                        role="tab"
                        aria-selected={tab.id === active && !home}
                        disabled={!ready && tab.kind !== "terminal"}
                        onClick={() => onSelect(tab.id)}
                        title={tabName(tab, saved, project)}
                      >
                        <TabIcon kind={tab.kind} size={15} />
                        <span>{tabName(tab, saved, project)}</span>
                        {saved[tab.id]?.pinned && (
                          <Pin size={11} className="tab-pin" />
                        )}
                      </button>
                      <button
                        className="tab-more icon-button"
                        aria-label={`管理 ${tabName(tab, saved, project)}`}
                        onClick={(event) => toggleMenu(tab.id, event)}
                        disabled={busy || !running}
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      {menu === tab.id && (
                        <>
                          <div
                            className="menu-dismiss"
                            onClick={() => setMenu(null)}
                          />
                          <div
                            className="menu sidebar-menu"
                            style={{ top: menuTop }}
                            role="menu"
                            aria-label="标签操作"
                          >
                            <button
                              role="menuitem"
                              onClick={() => {
                                setMenu(null);
                                onRename(tab);
                              }}
                            >
                              重命名标签
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setMenu(null);
                                onPin(tab.id);
                              }}
                            >
                              <Pin size={14} />
                              {saved[tab.id]?.pinned ? "取消置顶" : "置顶标签"}
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setMenu(null);
                                onClose(tab);
                              }}
                            >
                              <X size={15} />
                              关闭标签<kbd>⌘W</kbd>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {!tabs.length && (
                  <p className="sidebar-empty">
                    {running
                      ? "从 + 打开浏览器或终端"
                      : "启动 Cage 环境后，在这里管理标签"}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="sidebar-empty">打开本地文件夹开始工作</p>
        )}
        {projects.some(
          (path) =>
            path !== workspace && !path.endsWith("/.claude-cage-workspace"),
        ) && (
          <div className="recent-projects">
            <div className="sidebar-section-heading">
              <span>最近项目</span>
            </div>
            {projects
              .filter(
                (path) =>
                  path !== workspace &&
                  !path.endsWith("/.claude-cage-workspace"),
              )
              .map((path) => (
                <div className="recent-project" key={path}>
                  <button
                    onClick={() => onOpenProject(path)}
                    disabled={busy || !running}
                    title={path}
                  >
                    <FolderOpen size={16} />
                    <span>{projectName(path)}</span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`从最近项目移除 ${projectName(path)}`}
                    title="从最近项目移除，不删除文件"
                    onClick={() => onForgetProject(path)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-status" onClick={onSafety}>
          <i className={`status-dot ${network.mode}`} />
          <span>{healthy ? "环境运行正常" : runtimeLabel}</span>
          <EnvironmentShield size={17} healthy={healthy} />
        </button>
        <button className="sidebar-link" onClick={onSettings}>
          <Settings2 size={17} />
          设置<kbd>⌘,</kbd>
        </button>
      </div>
    </aside>
  );
}
