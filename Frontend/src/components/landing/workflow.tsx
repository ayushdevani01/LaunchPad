import { Reveal, Spotlight } from "@/components/motion/reveal";
import {
  Check,
  FolderClosed,
  GitBranch,
  Globe2,
  Lock,
  Triangle,
} from "lucide-react";

function FolderVisual() {
  const rows = [
    { label: "apps", depth: 0, muted: true },
    { label: "web", depth: 1, active: true },
    { label: "admin", depth: 1, muted: true },
    { label: "packages", depth: 0, muted: true },
    { label: "ui", depth: 1, muted: true },
  ];

  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/40 p-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] ${
            row.active ? "bg-accent/[0.08] text-fg" : "text-faint"
          }`}
          style={{ paddingLeft: `${8 + row.depth * 14}px` }}
        >
          <FolderClosed
            className={
              row.active ? "h-3 w-3 text-accent" : "h-3 w-3 text-white/35"
            }
          />
          {row.label}
          {row.active ? (
            <span className="ml-auto flex items-center gap-1 rounded border border-accent/25 px-1.5 text-[9px] uppercase tracking-[0.1em] text-accent">
              <Triangle className="h-2 w-2" /> next.js
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BuildVisual() {
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[11px]">
      <div className="flex items-center justify-between text-faint">
        <span>pnpm build</span>
        <span className="text-accent">running</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full w-[68%] rounded-full bg-accent" />
      </div>
      <div className="space-y-1 pt-1 text-white/35">
        <p>✓ built in 42.6s</p>
        <p className="text-dim">→ 148 objects · 4.2 MB gzipped</p>
      </div>
    </div>
  );
}

function UrlVisual() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 font-mono text-[11px] text-dim">
        <Lock className="h-3 w-3 text-mint" />
        <span className="truncate">storefront.launch-pad.dev</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-2 font-mono text-[10px] text-faint">
        <Globe2 className="h-3 w-3" />
        <span>TLS-secured project URL</span>
        <span className="ml-auto rounded border border-mint/25 bg-mint/10 px-1.5 py-0.5 text-mint">
          ready
        </span>
      </div>
    </div>
  );
}

const steps = [
  {
    index: "01",
    title: "Connect and pick a folder",
    body: "Authorise GitHub, choose a repository and branch, then walk the folder tree. Monorepos are a first-class case, not a workaround.",
    visual: <FolderVisual />,
    icon: <GitBranch className="h-3.5 w-3.5" />,
  },
  {
    index: "02",
    title: "Let it detect the build",
    body: "The framework reader inspects the package manifest at that exact path, fills in the install and build commands, and tells you when something is unsupported.",
    visual: <BuildVisual />,
    icon: <Check className="h-3.5 w-3.5" />,
  },
  {
    index: "03",
    title: "Watch it go live",
    body: "An isolated task builds your app and streams the output. Static assets go to S3; Next.js server routes run on Lambda. A successful health check makes the deployment live.",
    visual: <UrlVisual />,
    icon: <Globe2 className="h-3.5 w-3.5" />,
  },
];

export function Workflow() {
  return (
    <section id="workflow" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid gap-8 border-b border-white/[0.07] pb-10 md:grid-cols-[1fr_0.9fr] md:items-end">
          <Reveal>
            <p className="label-mono">01 — Workflow</p>
            <h2 className="mt-4 max-w-[20ch] text-[clamp(1.85rem,3.4vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.035em]">
              From clone to certificate in three moves.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="max-w-[42ch] text-sm leading-relaxed text-dim md:justify-self-end">
              No YAML, no build matrix, no container to maintain. The platform
              owns the pipeline so you can keep owning the product.
            </p>
          </Reveal>
        </div>

        <div className="relative mt-12 grid gap-4 md:grid-cols-3">
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-[26px] hidden h-px bg-gradient-to-r from-white/[0.02] via-white/[0.12] to-white/[0.02] md:block"
          />
          {steps.map((step, index) => (
            <Reveal key={step.index} delay={index * 0.08}>
              <Spotlight className="h-full rounded-xl border border-white/[0.08] bg-panel/60 p-5 transition-colors duration-300 hover:border-white/[0.16]">
                <div className="flex items-center justify-between">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.12] bg-ink font-mono text-[10px] text-dim">
                    {step.index}
                  </span>
                  <span className="text-faint">{step.icon}</span>
                </div>
                <h3 className="mt-5 text-[15px] font-medium tracking-[-0.01em] text-fg">
                  {step.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-faint">
                  {step.body}
                </p>
                <div className="mt-5">{step.visual}</div>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
