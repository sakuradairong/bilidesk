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
import { useAuthStore } from "@/stores/auth";

type Props = {
  open: boolean;
};

export function LoginModal({ open }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("准备二维码…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;
    (async () => {
      try {
        const start = await authQrStart();
        if (cancelled) return;
        setUrl(start.url);
        setStatus("请使用哔哩哔哩 App 扫码");
        setError("");
        timer = window.setInterval(async () => {
          if (cancelled || inFlight) return;
          inFlight = true;
          try {
            const poll = await authQrPoll(start.qrcode_key);
            if (cancelled) return;
            if (poll.status === "scanned") setStatus("已扫描，请在手机上确认");
            if (poll.status === "confirmed" && poll.profile) {
              if (timer) window.clearInterval(timer);
              useAuthStore.getState().setProfile(poll.profile);
              useAuthStore.getState().setLoginOpen(false);
            }
            if (poll.status === "expired") {
              setStatus("二维码已过期，请关闭后重试");
              if (timer) window.clearInterval(timer);
            }
          } catch (err) {
            setError(toAppError(err).message);
          } finally {
            inFlight = false;
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
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && useAuthStore.getState().setLoginOpen(false)}>
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
