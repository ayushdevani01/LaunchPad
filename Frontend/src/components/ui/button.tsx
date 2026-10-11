import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,color,border-color,transform,box-shadow] duration-200 ease-smooth disabled:pointer-events-none disabled:opacity-45 active:translate-y-px select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-ink hover:bg-accent-hover shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset]",
  secondary:
    "bg-raised text-fg border border-white/[0.09] hover:border-white/20 hover:bg-hover",
  ghost: "text-dim hover:text-fg hover:bg-white/[0.05]",
  outline:
    "border border-white/[0.12] text-fg hover:border-white/30 hover:bg-white/[0.04]",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
  icon: "h-9 w-9",
};

export function buttonStyles(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={buttonStyles(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block animate-spin rounded-full border border-current border-t-transparent opacity-70",
        className ?? "h-4 w-4"
      )}
    />
  );
}
