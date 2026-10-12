import Link from "next/link";
import { Check } from "lucide-react";
import { Logo } from "@/components/site/logo";

const promises = [
  "Clone straight from GitHub",
  "Pick the exact folder to build",
  "Watch the build stream live",
  "Get a TLS subdomain when it passes",
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      {/* Narrative side — hidden on small screens so the form gets the full view. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.07] p-10 lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-blueprint opacity-40 [mask-image:radial-gradient(85%_70%_at_20%_10%,black,transparent_75%)]" />
        </div>
        <div className="grain pointer-events-none absolute inset-0 -z-10" />

        <Logo />

        <div className="max-w-[26ch]">
          <h2 className="text-[clamp(2.1rem,3.4vw,3rem)] font-medium leading-[1.02] tracking-tightest">
            Ship the thing you built, not the pipeline around it.
          </h2>
          <ul className="mt-8 space-y-3">
            {promises.map((promise) => (
              <li key={promise} className="flex items-center gap-3 text-[13px] text-dim">
                <span className="grid h-4 w-4 place-items-center rounded-full border border-accent/25 bg-accent/[0.07]">
                  <Check className="h-2.5 w-2.5 text-accent" />
                </span>
                {promise}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <span>launch-pad.dev</span>
          <Link href="/" className="link-underline hover:text-fg">
            Back to site
          </Link>
        </div>
      </aside>

      <main className="relative flex flex-col">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4 sm:px-8 lg:hidden">
          <Logo />
          <Link href="/" className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-fg">
            Back to site
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
          <div className="w-full max-w-[380px]">
            <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">{title}</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-dim">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <div className="mt-6 text-center text-[13px] text-faint">{footer}</div>
          </div>
        </div>

        <div className="border-t border-white/[0.07] px-5 py-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-faint sm:px-8">
          Secured with TLS · builds isolated per deployment
        </div>
      </main>
    </div>
  );
}
