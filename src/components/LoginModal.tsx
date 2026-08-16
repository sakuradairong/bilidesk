import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { authQrPoll, authQrStart } from "../api";
import type { Profile } from "../types";

type Props = {
  onClose: () => void;
  onLoggedIn: (profile: Profile) => void;
};

export function LoginModal({ onClose, onLoggedIn }: Props) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("请使用哔哩哔哩手机 App 扫码");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let qrcodeKey = "";

    async function start() {
      try {
        const qr = await authQrStart();
        if (cancelled) return;
        qrcodeKey = qr.qrcode_key;
        setUrl(qr.url);
        timer = window.setInterval(poll, 1400);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function poll() {
      try {
        const result = await authQrPoll(qrcodeKey);
        if (result.status === "scanned") {
          setMessage("已扫码，请在手机上确认");
        } else if (result.status === "confirmed") {
          window.clearInterval(timer);
          if (result.profile) {
            onLoggedIn(result.profile);
          }
          onClose();
        } else if (result.status === "expired") {
          window.clearInterval(timer);
          setMessage("二维码已过期，请关闭后重试");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    start();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onClose, onLoggedIn]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>扫码登录</h2>
        <p className="status-line">{message}</p>
        {url ? (
          <div className="qr">
            <QRCodeSVG value={url} size={196} />
          </div>
        ) : (
          <p>正在生成二维码…</p>
        )}
        {error ? <p className="error-line">{error}</p> : null}
        <button className="ghost-btn" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
