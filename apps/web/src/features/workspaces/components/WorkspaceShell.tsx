"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkspaceController } from "../hooks/useWorkspaceController";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
export function WorkspaceShell({
  model,
  children,
  dialogs,
}: {
  model: WorkspaceController;
  children: ReactNode;
  dialogs: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [mobile, setMobile] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLElement>(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => toggle.current?.focus());
  }
  useEffect(() => {
    const query = matchMedia("(max-width: 1024px)");
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (open)
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  const label = model.developer
    ? "Developer Tools"
    : model.destination.kind === "interface"
      ? "Interface"
      : model.destination.kind === "conversation"
        ? "Chat"
        : "New chat";
  return (
    <div className={`app-shell ${model.active ? "workspace-open" : ""}`}>
      {mobile && open && (
        <button
          tabIndex={-1}
          className="sidebar-backdrop"
          aria-label="Dismiss navigation"
          onClick={close}
        />
      )}
      <aside
        id="workspace-navigation"
        className="sidebar"
        ref={panel}
        data-open={open}
        hidden={mobile && !open}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label="Workspace navigation"
        onKeyDown={(event) => {
          if (event.key === "Escape" && mobile && open) {
            event.preventDefault();
            close();
          }
          if (event.key === "Tab" && mobile && open) {
            const controls = Array.from(
              panel.current!.querySelectorAll<HTMLElement>(
                'button:not([disabled]), summary, a[href], [tabindex="0"]',
              ),
            ).filter((el) => el.getClientRects().length);
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <WorkspaceSidebar
          model={model}
          close={() => {
            if (mobile) close();
          }}
        />
      </aside>
      <div className="main-area" inert={mobile && open ? true : undefined}>
        <header className="topbar">
          <button
            ref={toggle}
            className="navigation-toggle"
            aria-label="Open navigation"
            aria-controls="workspace-navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <span className="truncate">
            {model.active
              ? `${model.active.name} / ${label}`
              : "Personal workspace"}
          </span>
          <button onClick={() => model.setAccount(true)}>Account</button>
          <button className="mobile-signout" onClick={model.signout}>
            Sign out
          </button>
        </header>
        {children}
      </div>
      {dialogs}
    </div>
  );
}
