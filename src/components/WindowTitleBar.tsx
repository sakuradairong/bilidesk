import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

export function WindowTitleBar() {
  const appWindow = useMemo(() => (isTauri() ? getCurrentWindow() : null), []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;

    let unlisten: (() => void) | undefined;
    let mounted = true;
    const syncMaximized = async () => {
      const value = await appWindow.isMaximized();
      if (mounted) setMaximized(value);
    };

    void syncMaximized();
    void appWindow
      .onResized(() => void syncMaximized())
      .then((dispose) => {
        if (mounted) unlisten = dispose;
        else dispose();
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [appWindow]);

  const minimize = () => {
    if (appWindow) void appWindow.minimize();
  };

  const toggleMaximize = () => {
    if (!appWindow) return;
    void appWindow.toggleMaximize().then(async () => {
      setMaximized(await appWindow.isMaximized());
    });
  };

  const close = () => {
    if (appWindow) void appWindow.close();
  };

  return (
    <div className="window-titlebar">
      <div
        className="window-titlebar-drag-region"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button === 0 && event.detail === 1 && appWindow) {
            void appWindow.startDragging();
          }
        }}
        onDoubleClick={toggleMaximize}
      >
        <img
          className="window-titlebar-icon"
          src="/bilidesk-icon.png"
          alt=""
          draggable={false}
          data-tauri-drag-region
        />
        <span className="window-titlebar-name" data-tauri-drag-region>
          BiliDesk
        </span>
        <span className="window-titlebar-badge" data-tauri-drag-region>
          非官方客户端
        </span>
      </div>

      <div className="window-titlebar-controls" aria-label="窗口控制">
        <button
          type="button"
          className="window-titlebar-button"
          aria-label="最小化"
          title="最小化"
          onClick={minimize}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="window-titlebar-button"
          aria-label={maximized ? "还原" : "最大化"}
          title={maximized ? "还原" : "最大化"}
          onClick={toggleMaximize}
        >
          {maximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="window-titlebar-button is-close"
          aria-label="关闭"
          title="关闭"
          onClick={close}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
