"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  meta?: string;
  icon?: React.ReactNode;
};

export function Select({
  id,
  value,
  options,
  onValueChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search…",
  emptyLabel = "Nothing matches",
  disabled,
  loading,
  invalid,
  searchable,
  className,
  footer,
}: {
  id?: string;
  value: string | null;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  searchable?: boolean;
  className?: string;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.hint?.toLowerCase().includes(needle)
    );
  }, [options, query]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(Math.max(0, options.findIndex((option) => option.value === value)));
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
  }, [open, options, value]);

  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const commit = (option: SelectOption) => {
    onValueChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (option) commit(option);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-3 rounded-lg border bg-white/[0.03] px-3 text-left text-sm transition-colors duration-200 hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-50",
          invalid ? "border-danger/60" : "border-white/[0.09]",
          open && "border-white/25 bg-white/[0.05]"
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {loading ? (
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border border-white/30 border-t-transparent" />
          ) : selected?.icon ? (
            <span className="shrink-0 text-dim">{selected.icon}</span>
          ) : null}
          <span className={cn("truncate", selected ? "text-fg" : "text-faint")}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {selected?.meta ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              {selected.meta}
            </span>
          ) : null}
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-faint transition-transform duration-200", open && "rotate-180")}
          />
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-white/[0.1] bg-raised shadow-lift"
            onKeyDown={onKeyDown}
          >
            {searchable ? (
              <div className="flex items-center gap-2 border-b border-white/[0.07] px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="h-10 w-full bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none"
                />
                <kbd className="hidden shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
                  esc
                </kbd>
              </div>
            ) : null}

            <div ref={listRef} role="listbox" aria-label={placeholder} className="max-h-64 overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-faint">{emptyLabel}</p>
              ) : (
                filtered.map((option, index) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => commit(option)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                        index === active ? "bg-white/[0.06] text-fg" : "text-dim",
                        isSelected && "text-fg"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {option.icon ? <span className="shrink-0 text-faint">{option.icon}</span> : null}
                        <span className="min-w-0">
                          <span className="block truncate">{option.label}</span>
                          {option.hint ? (
                            <span className="block truncate text-[11px] text-faint">{option.hint}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {option.meta ? (
                          <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                            {option.meta}
                          </span>
                        ) : null}
                        {isSelected ? <Check className="h-3.5 w-3.5 text-accent" /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {footer ? <div className="border-t border-white/[0.07] p-1.5">{footer}</div> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
