import type { DeploymentStatus } from "@/lib/api";
import { cn } from "@/lib/cn";

const statusStyles: Record<DeploymentStatus, { dot: string; text: string; label: string }> = {
  PENDING: { dot: "bg-warn", text: "text-warn", label: "Queued" },
  BUILDING: { dot: "bg-accent", text: "text-accent", label: "Building" },
  SUCCESS: { dot: "bg-mint", text: "text-mint", label: "Ready" },
  FAILED: { dot: "bg-danger", text: "text-danger", label: "Failed" },
};

export function StatusBadge({ status, className }: { status: DeploymentStatus; className?: string }) {
  const style = statusStyles[status] ?? statusStyles.PENDING;
  const live = status === "BUILDING";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium",
        style.text,
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {live ? <span className={cn("absolute inset-0 animate-pulse-ring rounded-full", style.dot)} /> : null}
        <span className={cn("relative h-1.5 w-1.5 rounded-full", style.dot)} />
      </span>
      {style.label}
    </span>
  );
}

export function Pill({
  children,
  className,
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "accent" | "danger" | "warn" | "mint";
}) {
  const tones = {
    neutral: "border-white/[0.1] bg-white/[0.03] text-dim",
    accent: "border-accent/25 bg-accent/10 text-accent",
    danger: "border-danger/25 bg-danger/10 text-danger",
    warn: "border-warn/25 bg-warn/10 text-warn",
    mint: "border-mint/25 bg-mint/10 text-mint",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
