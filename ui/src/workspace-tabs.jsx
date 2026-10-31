import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FileCode2,
  Globe2,
  MoreHorizontal,
  Pin,
  TerminalSquare,
  X,
} from "lucide-react";
import { tabName } from "./workspace-state.mjs";

export const TabIcon = ({ kind, size = 16 }) =>
  kind === "terminal" ? (
    <TerminalSquare size={size} />
  ) : kind === "editor" ? (
    <FileCode2 size={size} />
  ) : (
    <Globe2 size={size} />
  );

// Active content carries the strongest emphasis; titles and actions use the
// existing paper/selected/muted tokens, 14px type and 8px spacing in both layouts.
export function WorkspaceTabs({
  tabs,
  saved,
  active,
  label,
  horizontal = false,
  busy,
  ready,
  onSelect,
  onClose,
  onRename,
  onPin,
  onReorder,
}) {
  const [menu, setMenu] = useState(null);
  const [dragged, setDragged] = useState(null);
  const trigger = useRef();
  const list = useRef();
  const showMenu = (tab, event) => {
    event.preventDefault();
    trigger.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      tab,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 224)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 152)),
    });
  };
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenu(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [menu]);
  return (
    <>
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        className={horizontal ? "browser-tabs" : "sidebar-tabs"}
      >
        {tabs.map((tab, index) => {
          const title = tabName(tab, saved);
          return (
            <div
              key={tab.id}
              className={`${horizontal ? "browser-tab" : "sidebar-tab"} ${tab.id === active ? "active" : ""} ${tab.closed ? "ended" : ""}`}
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
                aria-selected={tab.id === active}
                tabIndex={
                  tab.id === active ||
                  (!tabs.some((t) => t.id === active) && index === 0)
                    ? 0
                    : -1
                }
                disabled={!ready && tab.kind !== "terminal"}
                title={tab.url ? `${title}\n${tab.url}` : title}
                onClick={() => onSelect(tab.id)}
                onContextMenu={(event) => showMenu(tab, event)}
                onKeyDown={(event) => {
                  if (event.key === "F10" && event.shiftKey) {
                    showMenu(tab, event);
                    return;
                  }
                  const prev = horizontal ? "ArrowLeft" : "ArrowUp";
                  const next = horizontal ? "ArrowRight" : "ArrowDown";
                  if (![prev, next, "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const at =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index +
                            (event.key === prev ? -1 : 1) +
                            tabs.length) %
                          tabs.length;
                  list.current.querySelectorAll('[role="tab"]')[at]?.focus();
                  onSelect(tabs[at].id);
                }}
              >
                <TabIcon kind={tab.kind} size={15} />
                <span>{title}</span>
                {saved[tab.id]?.pinned && <Pin size={11} className="tab-pin" />}
              </button>
              {horizontal ? (
                <button
                  className="tab-close icon-button"
                  aria-label={`关闭 ${title}`}
                  disabled={busy}
                  onClick={() => onClose(tab)}
                >
                  <X size={14} />
                </button>
              ) : (
                <button
                  className="tab-more icon-button"
                  aria-label={`管理 ${title}`}
                  onClick={(event) => showMenu(tab, event)}
                  disabled={busy}
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu &&
        createPortal(
          <>
            <div className="menu-dismiss" onClick={() => setMenu(null)} />
            <div
              className="menu workspace-tab-menu"
              style={{ top: menu.top, left: menu.left }}
              role="menu"
              aria-label="标签操作"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onRename(menu.tab);
                }}
              >
                重命名标签
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onPin(menu.tab.id);
                }}
              >
                <Pin size={14} />
                {saved[menu.tab.id]?.pinned ? "取消置顶" : "置顶标签"}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onClose(menu.tab);
                }}
              >
                <X size={15} />
                关闭标签<kbd>⌘W</kbd>
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
