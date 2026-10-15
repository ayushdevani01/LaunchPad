"use client";

import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { GitBranch, Lock, FolderClosed } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "muted" | "default" | "ok" | "warn";

const script: { stage: string; text: string; tone: Tone; hold: number }[] = [
  { stage: "clone", text: "git clone acme/storefront --depth 1", tone: "muted", hold: 620 },
  { stage: "detect", text: "framework: next@14.2 · root: apps/web", tone: "default", hold: 560 },
  { stage: "install", text: "npm ci — 412 packages in 8.2s", tone: "default", hold: 560 },
  { stage: "build", text: "next build", tone: "default", hold: 420 },
  { stage: "build", text: "compiled 11 routes in 4.8s", tone: "muted", hold: 520 },
  { stage: "build", text: "static assets emitted → .next", tone: "ok", hold: 460 },
  { stage: "upload", text: "uploaded 148 objects to s3://launchpad-outputs", tone: "default", hold: 620 },
  { stage: "deploy", text: "attaching storefront.launch-pad.dev", tone: "default", hold: 520 },
  { stage: "deploy", text: "tls certificate issued in 1.9s", tone: "ok", hold: 520 },
  { stage: "done", text: "deployment ready in 42.6s", tone: "ok", hold: 4200 },
];

const toneClass: Record<Tone, string> = {
  muted: "text-faint",
  default: "text-dim",
  ok: "text-mint",
  warn: "text-warn",
};

export function BuildPreview() {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-40px" });
  const [step, setStep] = React.useState(reduce ? script.length : 0);

  React.useEffect(() => {
    if (reduce || !inView) return;
    const timer = window.setTimeout(() => {
      setStep((current) => (current >= script.length ? 0 : current + 1));
    }, step === 0 ? 900 : script[Math.max(0, step - 1)].hold);
    return () => window.clearTimeout(timer);
  }, [step, inView, reduce]);

  const visible = script.slice(0, step);
  const done = step >= script.length;
  const progress = Math.round((visible.length / script.length) * 100);

  return (
    <div ref={ref} className="relative">
      <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-panel shadow-lift">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-[5px]">
              <span className="h-[7px] w-[7px] rounded-full bg-white/20" />
              <span className="h-[7px] w-[7px] rounded-full bg-white/12" />
              <span className="h-[7px] w-[7px] rounded-full bg-white/12" />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              deploy / #4821
            </span>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors duration-500",
                done ? "bg-mint" : "bg-accent"
              )}
            />
            <span className={done ? "text-mint" : "text-accent"}>{done ? "ready" : "live"}</span>
          </span>
        </div>

        <div className="px-4 pb-4 pt-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13px] font-medium tracking-tight text-fg">acme/storefront</span>
            <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-dim">
              <GitBranch className="h-2.5 w-2.5" />
              main
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-dim">
              <FolderClosed className="h-2.5 w-2.5" />
              apps/web
            </span>
            <span className="ml-auto rounded border border-accent/25 bg-accent/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-accent">
              next.js
            </span>
          </div>

          <div className="mt-3.5 flex items-center gap-3">
            <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="w-8 text-right font-mono text-[10px] text-faint">{progress}%</span>
          </div>

          <div className="mt-3 h-[248px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/50 p-3 font-mono text-[11px] leading-[1.75] sm:text-[11.5px]">
            <AnimatePresence initial={false}>
              {visible.map((line, index) => (
                <motion.div
                  key={`${index}-${line.text}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="flex gap-2"
                >
                  <span className="w-[52px] shrink-0 text-white/20">{line.stage}</span>
                  <span className={cn("min-w-0 flex-1 break-words", toneClass[line.tone])}>
                    {line.tone === "ok" ? <span className="mr-1.5 text-mint">✓</span> : null}
                    {line.text}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {!done ? (
              <span className="ml-[60px] inline-block h-3 w-[6px] animate-caret bg-accent/80 align-middle" />
            ) : null}
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
              <Lock className="h-3 w-3" />
              <span className="font-mono">storefront.launch-pad.dev</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {done ? "live" : "building"}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
