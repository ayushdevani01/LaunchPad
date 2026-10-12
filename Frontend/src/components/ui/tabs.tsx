"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  className,
  idPrefix = "tab",
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
  idPrefix?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex w-full items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-200 sm:px-3",
              active ? "text-ink" : "text-dim hover:text-fg"
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${idPrefix}-indicator`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-md bg-accent"
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
