import * as React from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  optional,
  htmlFor,
  children,
  action,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  optional?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg/90">
          {label}
          {optional ? <span className="ml-1.5 text-2xs font-normal text-faint">optional</span> : null}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-lg border bg-white/[0.03] px-3 text-sm text-fg placeholder:text-faint/80 transition-colors duration-200 hover:border-white/[0.14] focus:border-white/25 focus:bg-white/[0.05] focus:outline-none disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputBase, "h-10 border-white/[0.09]", className)} {...props} />;
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputBase, "min-h-24 border-white/[0.09] py-2", className)} {...props} />;
  }
);

/** Input with a fixed suffix such as the deployment domain. */
export function SuffixInput({
  suffix,
  invalid,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { suffix: string; invalid?: boolean }) {
  return (
    <div className="relative">
      <input
        {...props}
        className={cn(
          inputBase,
          "h-10 border-white/[0.09] pr-32 font-mono text-[13px]",
          invalid && "border-danger/60",
          className
        )}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-faint">
        {suffix}
      </span>
    </div>
  );
}
