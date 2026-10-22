import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { buttonStyles } from "@/components/ui/button";

export function Cta() {
  return (
    <section aria-labelledby="closing-title" className="border-t border-white/[0.07]">
      <div className="mx-auto w-full px-5 py-14 sm:px-8 sm:py-20">
        <Reveal y={10} className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          <div>
            <p className="text-sm leading-6 text-dim">Ready when you are</p>
            <h2 id="closing-title" className="mt-3 font-sans text-[clamp(1.875rem,3vw,2.5rem)] font-medium leading-[1.2] tracking-[-0.03em]">
              Put it online tonight.
            </h2>
            <p className="mt-4 max-w-[57ch] text-base leading-7 text-dim">
              Connect GitHub, pick the folder that holds your app, and follow
              the build from the first install command to the final health
              check.
            </p>
          </div>

          <div className="lg:max-w-[290px]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/register"
                className={buttonStyles("primary", "md", "group h-11 px-4")}
              >
                Start deploying
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 ease-smooth group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center rounded text-sm font-medium text-dim transition-colors hover:text-fg"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-4 max-w-[36ch] text-[13px] leading-5 text-faint">
              GitHub OAuth · private and public repositories
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
