import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ message, onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <AlertTriangle className="size-6 text-destructive" />
      <p className="max-w-md text-sm text-destructive">{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
