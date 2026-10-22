"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  FileWarning,
  GitBranch,
  GitCommitHorizontal,
  Globe2,
  Layers,
  Lock,
  ScanLine,
  Terminal,
  Triangle,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/cn";
import styles from "./platform.module.css";

function ConsoleVisual() {
  const lines = [
    { stage: "install", text: "added 412 packages in 8.2s", tone: "dim" },
    { stage: "build", text: "compiled successfully", tone: "mint" },
    {
      stage: "upload",
      text: "148 objects → s3://launchpad-outputs",
      tone: "dim",
    },
    {
      stage: "deploy",
      text: "storefront.launch-pad.dev is live",
      tone: "accent",
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-black/45">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          build output
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-mint">
          <span className="h-1 w-1 rounded-full bg-mint" /> streaming
        </span>
      </div>
      <div className="space-y-1.5 p-3 font-mono text-[11px] leading-relaxed">
        {lines.map((line) => (
          <div key={line.stage} className="flex gap-2.5">
            <span className="w-[46px] shrink-0 text-white/20">
              {line.stage}
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                line.tone === "mint" && "text-mint",
                line.tone === "accent" && "text-accent",
                line.tone === "dim" && "text-dim",
              )}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-black/45 p-3 font-mono text-[11px] leading-relaxed">
      <div className="flex gap-2">
        <span className="text-accent">POST</span>
        <span className="text-dim">/projects</span>
      </div>
      <div className="mt-1.5 text-white/30">{"{"}</div>
      <div className="pl-3 text-dim">
        <span className="text-faint">&quot;gitURL&quot;</span>:{" "}
        <span className="text-fg/80">
          &quot;github.com/acme/storefront&quot;
        </span>
        ,
      </div>
      <div className="pl-3 text-dim">
        <span className="text-faint">&quot;sourceDir&quot;</span>:{" "}
        <span className="text-fg/80">&quot;apps/web&quot;</span>,
      </div>
      <div className="pl-3 text-dim">
        <span className="text-faint">&quot;branch&quot;</span>:{" "}
        <span className="text-fg/80">&quot;main&quot;</span>
      </div>
      <div className="text-white/30">{"}"}</div>
    </div>
  );
}

function PipelineVisual() {
  const nodes = [
    { label: "GitHub", detail: "clone" },
    { label: "Fargate", detail: "build" },
    { label: "AWS", detail: "assets + server" },
    { label: "Edge", detail: "serve" },
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-black/40 p-4">
      <div className="flex items-center justify-between gap-1">
        {nodes.map((node, index) => (
          <div key={node.label} className="flex flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <span className="flex h-7 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                {node.label}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                {node.detail}
              </span>
            </div>
            {index < nodes.length - 1 ? (
              <div className="relative mx-1 h-px flex-1 bg-white/[0.09]">
                <span className="absolute -top-[2px] left-0 h-[5px] w-[5px] rounded-full bg-accent/70 animate-sweep" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-white/[0.06] pt-3 font-mono text-[10px] text-faint">
        ephemeral task · terminates after upload
      </p>
    </div>
  );
}

function FailureVisual() {
  return (
    <div className="rounded-lg border border-danger/20 bg-danger/[0.05] p-3 font-mono text-[11px] leading-relaxed">
      <p className="text-danger">error: build exited with code 1</p>
      <p className="mt-1 text-dim">src/app/page.tsx:42: type mismatch</p>
      <p className="mt-2 text-faint">logs archived · replay anytime</p>
    </div>
  );
}

function DomainsVisual() {
  const rows = [
    { host: "storefront", state: "ready", tone: "mint" as const },
    { host: "docs-site", state: "building", tone: "accent" as const },
    { host: "landing-v2", state: "ready", tone: "mint" as const },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div
          key={row.host}
          className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-black/35 px-2.5 py-1.5 font-mono text-[10.5px]"
        >
          <Lock className="h-2.5 w-2.5 text-white/25" />
          <span className="truncate text-dim">{row.host}.launch-pad.dev</span>
          <span
            className={cn(
              "ml-auto shrink-0",
              row.tone === "mint" ? "text-mint" : "text-accent",
            )}
          >
            {row.state}
          </span>
        </div>
      ))}
    </div>
  );
}

function WebhookVisual() {
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.07] bg-black/40 p-3">
      <div className="flex items-center gap-2 font-mono text-[10.5px]">
        <Webhook className="h-3 w-3 text-faint" />
        <span className="text-dim">push · main</span>
        <span className="ml-auto text-mint">200</span>
      </div>
      <div className="flex items-center gap-2 border-t border-white/[0.06] pt-2 font-mono text-[10.5px] text-faint">
        <GitCommitHorizontal className="h-3 w-3" />
        a91f2c4
        <ArrowRight className="h-3 w-3" />
        redeploy queued
      </div>
    </div>
  );
}

function FrameworkVisual() {
  const list = ["next.js", "react", "vite", "astro", "svelte"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((item) => (
        <span
          key={item}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px]",
            item === "next.js"
              ? "border-accent/25 bg-accent/[0.07] text-accent"
              : "border-white/[0.08] text-faint",
          )}
        >
          {item === "next.js" ? <Triangle className="h-2 w-2" /> : null}
          {item}
          {item === "next.js" ? (
            <span className="ml-0.5 text-[8px] uppercase tracking-[0.1em]">
              detected
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

const features = [
  {
    id: "logs",
    title: "Logs that stream, not poll",
    body: "Every line of the build is published to Redis and pushed over a socket. Reconnect and the history replays from the first byte.",
    label: "Build output",
    icon: Terminal,
    visual: ConsoleVisual,
  },
  {
    id: "api",
    title: "One request to deploy",
    body: "The same API the dashboard uses is available to your scripts and CI.",
    label: "Deployment API",
    icon: Code2,
    visual: RequestVisual,
  },
  {
    id: "pipeline",
    title: "A pipeline, not a control panel",
    body: "Builds run in ephemeral Fargate tasks and shut down when the upload finishes.",
    label: "Build pipeline",
    icon: Layers,
    visual: PipelineVisual,
  },
  {
    id: "failures",
    title: "Failures you can actually read",
    body: "Non-zero exits keep their full output, archived and replayable.",
    label: "Deployment history",
    icon: FileWarning,
    visual: FailureVisual,
  },
  {
    id: "domains",
    title: "Your own subdomain",
    body: "Every project gets a TLS-secured LaunchPad subdomain after its first successful build.",
    label: "Project domains",
    icon: Globe2,
    visual: DomainsVisual,
  },
  {
    id: "branches",
    title: "Build from your branch",
    body: "Redeploy from the dashboard. Push-triggered builds are available when GitHub permits webhook registration.",
    label: "GitHub connection",
    icon: GitBranch,
    visual: WebhookVisual,
  },
  {
    id: "frameworks",
    title: "Framework detection",
    body: "Recognised from the manifest at the folder you picked.",
    label: "Framework inspector",
    icon: ScanLine,
    visual: FrameworkVisual,
  },
];

function FeatureVisual({ index }: { index: number }) {
  const feature = features[index];
  const Visual = feature.visual;
  const Icon = feature.icon;
  return (
    <div className="relative flex h-full flex-col justify-center px-5 py-8 sm:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-blueprint opacity-[0.16] [mask-image:radial-gradient(70%_70%_at_50%_50%,black,transparent)]"
      />
      <div className="relative w-full">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/20 bg-accent/[0.05] text-accent">
            <Icon size={18} strokeWidth={1.5} />
          </span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              LaunchPad / {feature.id}
            </p>
            <p className="mt-1 text-[14px] text-fg">{feature.label}</p>
          </div>
        </div>
        <Visual />
      </div>
    </div>
  );
}

/** One scroll-driven story, with manual selection kept until scrolling resumes.
 * Inspired by the public feature/expand interactions in Skiper 35 and 76.
 * All content remains in normal document flow; no scroll interception is used.
 */
export function Platform() {
  const [active, setActive] = useState(0);
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const manualSelection = useRef(false);
  const reduceMotion = useReducedMotion();
  const feature = features[active];
  const selectFeature = (index: number) => {
    manualSelection.current = true;
    setActive(index);
  };

  useEffect(() => {
    let frame = 0;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const measure = () => {
      frame = 0;
      if (!desktop.matches || manualSelection.current) return;
      const nodes = rows.current.filter(
        (node): node is HTMLLIElement => !!node,
      );
      if (!nodes.length) return;
      if (
        nodes[0].getBoundingClientRect().top > window.innerHeight ||
        nodes[nodes.length - 1].getBoundingClientRect().bottom < 90
      )
        return;
      const focusLine = window.innerHeight * 0.45;
      let closest = 0,
        distance = Infinity;
      nodes.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        const next = Math.abs(rect.top + rect.height / 2 - focusLine);
        if (next < distance) {
          closest = index;
          distance = next;
        }
      });
      setActive((current) => (current === closest ? current : closest));
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Focus scrolling must not undo manual selection. Resume on user intent.
    const resume = () => {
      manualSelection.current = false;
      queue();
    };
    const keyboardScroll = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        resume();
    };
    const outsidePointer = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("#platform button")
      )
        resume();
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("wheel", resume, { passive: true });
    window.addEventListener("touchmove", resume, { passive: true });
    window.addEventListener("keydown", keyboardScroll);
    window.addEventListener("pointerdown", outsidePointer);
    window.addEventListener("resize", resume);
    window.addEventListener("hashchange", resume);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("wheel", resume);
      window.removeEventListener("touchmove", resume);
      window.removeEventListener("keydown", keyboardScroll);
      window.removeEventListener("pointerdown", outsidePointer);
      window.removeEventListener("resize", resume);
      window.removeEventListener("hashchange", resume);
    };
  }, []);

  return (
    <section
      id="platform"
      aria-labelledby="platform-title"
      className="relative py-20 sm:py-28"
    >
      <div className="mx-auto w-full px-5 sm:px-8">
        <div className="grid gap-6 border-b border-white/[0.07] pb-9 md:grid-cols-[1fr_0.9fr] md:items-end">
          <div>
            <p className="label-mono">02 / Platform</p>
            <h2
              id="platform-title"
              className="mt-4 max-w-[22ch] text-[clamp(1.85rem,3.4vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.035em]"
            >
              Everything between <span className="text-dim">git push</span> and
              a green URL.
            </h2>
          </div>
          <p className="max-w-[42ch] text-sm leading-relaxed text-dim md:justify-self-end">
            The pieces you would otherwise glue together, including cloning, building,
            storage, TLS, and cache invalidation, are one product here.
          </p>
        </div>

        <div className="relative mt-7 grid items-start gap-10 lg:mt-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <ol aria-label="Platform features" className="min-w-0">
            {features.map((item, index) => (
              <li
                key={item.id}
                ref={(node) => {
                  rows.current[index] = node;
                }}
                data-platform-feature={item.id}
                className={cn(
                  "relative border-b border-white/[0.08] py-7 first:pt-0 lg:py-8",
                  styles.feature,
                )}
              >
                <div className="flex gap-4 lg:gap-5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 font-mono text-[11px] transition-colors motion-reduce:transition-none",
                      active === index ? "text-accent" : "text-faint",
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3>
                      <button
                        type="button"
                        id={`platform-feature-${item.id}`}
                        aria-label={item.title}
                        aria-pressed={active === index}
                        aria-controls="platform-feature-preview"
                        onClick={() => selectFeature(index)}
                        onFocus={() => selectFeature(index)}
                        className={cn(
                          "hidden text-left text-[20px] font-medium leading-snug tracking-[-0.02em] transition-colors hover:text-fg motion-reduce:transition-none lg:inline-block",
                          active === index ? "text-fg" : "text-dim",
                        )}
                      >
                        {item.title}
                      </button>
                      <span className="text-[18px] font-medium leading-snug tracking-[-0.02em] text-fg lg:hidden">
                        {item.title}
                      </span>
                    </h3>
                    <p className="mt-2.5 max-w-[44ch] text-[13px] leading-[1.8] text-dim">
                      {item.body}
                    </p>
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className="mt-5 overflow-hidden rounded-xl border border-white/[0.07] bg-panel/60 lg:hidden"
                >
                  <FeatureVisual index={index} />
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute -left-4 bottom-8 top-8 hidden w-[2px] rounded-full bg-accent transition-opacity duration-200 motion-reduce:transition-none lg:block",
                    active === index ? "opacity-100" : "opacity-0",
                  )}
                />
              </li>
            ))}
          </ol>

          <aside
            id="platform-feature-preview"
            aria-label={`${feature.title} illustration`}
            className={cn("hidden min-w-0 lg:block", styles.stage)}
          >
            <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-panel shadow-[0_20px_80px_-40px_rgba(0,0,0,0.8)]">
              <div
                aria-hidden="true"
                className="flex h-11 items-center justify-between border-b border-white/[0.07] px-5"
              >
                <span className="flex gap-1.5">
                  <i className="h-[5px] w-[5px] rounded-full bg-white/25" />
                  <i className="h-[5px] w-[5px] rounded-full bg-white/15" />
                  <i className="h-[5px] w-[5px] rounded-full bg-white/10" />
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
                  Platform preview
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              </div>
              <div aria-hidden="true" className={cn("relative", styles.canvas)}>
                <AnimatePresence initial={false} mode="sync">
                  <motion.div
                    key={feature.id}
                    className="absolute inset-0"
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.26,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <FeatureVisual index={active} />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="flex min-h-[66px] items-center justify-between gap-4 border-t border-white/[0.07] px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-dim">
                    {feature.title}
                  </p>
                  <p className="mt-1 font-mono text-[9px] tracking-[0.12em] text-faint">
                    {String(active + 1).padStart(2, "0")} / 07
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    aria-label="Previous platform feature"
                    onClick={() =>
                      selectFeature(
                        (active + features.length - 1) % features.length,
                      )
                    }
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.1] text-dim transition-colors hover:border-white/25 hover:text-fg"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next platform feature"
                    onClick={() =>
                      selectFeature((active + 1) % features.length)
                    }
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.1] text-dim transition-colors hover:border-white/25 hover:text-fg"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
              Scroll to explore · select any feature
            </p>
          </aside>
        </div>

        <ul className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/[0.07] pt-5">
          {[
            "GitHub sign-in",
            "Live build logs",
            "Next.js API routes",
            "TLS subdomains",
          ].map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint"
            >
              <Check className="h-3 w-3 text-accent" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
