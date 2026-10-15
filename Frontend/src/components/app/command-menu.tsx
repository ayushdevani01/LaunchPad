"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CornerDownLeft, Plus, Search } from "lucide-react";
import type { Project } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_DOMAIN } from "@/lib/api";
import { useModalFocus } from "@/components/ui/use-modal-focus";

export function CommandMenu({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((state) => !state);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
      document.body.style.overflow = "hidden";
      return () => {
        window.clearTimeout(timer);
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  const actions = React.useMemo(() => {
    const create = {
      id: "new",
      label: "New deployment",
      hint: "Connect a repository",
      run: () => router.push("/launch"),
    };
    const list = projects.map((project) => ({
      id: project._id,
      label: project.name || project.slug,
      hint: `${project.slug}.${APP_DOMAIN}`,
      run: () => router.push(`/project/${project.slug}`),
    }));
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list.filter((item) =>
          `${item.label} ${item.hint}`.toLowerCase().includes(needle),
        )
      : list;
    return [create, ...filtered];
  }, [projects, query, router]);

  const run = (index: number) => {
    actions[index]?.run();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-9 w-full items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.02] px-3 text-left text-[13px] text-faint transition-colors hover:border-white/[0.16] hover:text-dim sm:w-56"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Search projects</span>
        <kbd className="rounded border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px] text-faint">
          ⌘K
        </kbd>
      </button>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
            <motion.button
              aria-label="Close search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search projects"
              initial={{ opacity: 0, y: -8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.99 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-[520px] overflow-hidden rounded-xl border border-white/[0.1] bg-raised shadow-lift"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, actions.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  run(active);
                }
              }}
            >
              <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-4">
                <Search className="h-4 w-4 shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  placeholder="Jump to a project…"
                  aria-label="Search projects"
                  className="h-12 w-full bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
                />
                <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-faint">
                  esc
                </kbd>
              </div>

              <div className="max-h-[320px] overflow-y-auto p-1.5">
                {actions.map((action, index) => (
                  <button
                    key={action.id}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors",
                      index === active
                        ? "bg-white/[0.06]"
                        : "hover:bg-white/[0.03]",
                    )}
                  >
                    {action.id === "new" ? (
                      <Plus className="h-3.5 w-3.5 text-accent" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">
                        {action.label}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-faint">
                        {action.hint}
                      </span>
                    </span>
                    {index === active ? (
                      <ArrowUpRight className="h-3.5 w-3.5 text-faint" />
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                <span className="flex items-center gap-2">
                  <CornerDownLeft className="h-3 w-3" /> open
                </span>
                <span>{actions.length} actions</span>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
