import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/stores/auth";

type Props = {
  children: ReactNode;
  title?: string;
  description: string;
};

export function LoginRequired({
  children,
  title = "登录后查看此内容",
  description,
}: Props) {
  const authReady = useAuthStore((state) => state.authReady);
  const profile = useAuthStore((state) => state.profile);
  const setLoginOpen = useAuthStore((state) => state.setLoginOpen);

  if (!authReady) {
    return (
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
        aria-label="正在检查登录状态"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="aspect-video w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!profile) {
    return (
      <EmptyState
        title={title}
        description={description}
        actionLabel="扫码登录"
        onAction={() => setLoginOpen(true)}
      />
    );
  }

  return children;
}
