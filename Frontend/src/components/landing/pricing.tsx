import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";

const included = [
  "Next.js server rendering and API routes",
  "Static websites and supported frontend builds",
  "Live logs with replay history",
  "A subdomain per project with TLS",
  "Monorepo folder targeting",
  "Manual redeploys and GitHub webhooks where permitted",
];

export function Pricing() {
  return (
    <section id="access" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/60">
          <div className="grid md:grid-cols-[1fr_1fr]">
            <div className="relative border-b border-white/[0.07] p-7 sm:p-9 md:border-b-0 md:border-r">
              <p className="label-mono">03 — Access</p>
              <h2 className="mt-4 max-w-[16ch] text-[clamp(1.8rem,3.2vw,2.4rem)] font-medium leading-[1.05] tracking-[-0.035em]">
                Start with your GitHub account.
              </h2>
              <p className="mt-4 max-w-[38ch] text-sm leading-relaxed text-dim">
                Connect your account, pick an app folder, and review the
                detected build settings before you start a deployment.
              </p>

              <Link
                href="/register"
                className={buttonStyles("primary", "lg", "mt-6 w-fit")}
              >
                Continue with GitHub
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                GitHub sign-in · public and private repositories
              </p>
            </div>

            <div className="p-7 sm:p-9">
              <p className="label-mono">Included</p>
              <ul className="mt-5 space-y-0">
                {included.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-3 border-b border-white/[0.06] py-3 text-[13px] text-dim last:border-b-0"
                  >
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/[0.08]">
                      <Check className="h-2.5 w-2.5 text-accent" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
