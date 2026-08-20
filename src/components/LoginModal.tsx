import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { authQrPoll, authQrStart, toAppError } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Profile } from "@/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onLoggedIn: (profile: Profile) => void;
};

export function LoginModal({ open, onClose, onLoggedIn }: Props) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("准备二维码…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    (async () => {
      try {
        const start = await authQrStart();
        if (cancelled) return;
        setUrl(start.url);
        setKey(start.qrcode_key);
        setStatus("请使用哔哩哔哩 App 扫码");
        setError("");
        timer = window.setInterval(async () => {
          try {
            const poll = await authQrPoll(start.qrcode_key);
            if (cancelled) return;
            if (poll.status === "scanned") setStatus("已扫描，请在手机上确认");
            if (poll.status === "confirmed" && poll.profile) {
              onLoggedIn(poll.profile);
              onClose();
            }
            if (poll.status === "expired") {
              setStatus("二维码已过期，请关闭后重试");
              window.clearInterval(timer);
            }
          } catch (err) {
            setError(toAppError(err).message);
          }
        }, 1500);
      } catch (err) {
        setError(toAppError(err).message);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [open, onClose, onLoggedIn]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>扫码登录</DialogTitle>
          <DialogDescription>使用网页端登录态，不冒充官方客户端。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {url ? (
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <QRCodeSVG value={url} size={180} />
            </div>
          ) : (
            <div className="flex size-[180px] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              加载中…
            </div>
          )}
          <p className="text-sm text-muted-foreground">{status}</p>
          {key ? <p className="text-[11px] text-muted-foreground/70">key: {key.slice(0, 8)}…</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
