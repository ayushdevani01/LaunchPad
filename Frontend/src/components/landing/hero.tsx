import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { BuildPreview } from "@/components/landing/build-preview";
import { buttonStyles } from "@/components/ui/button";

const facts = ["GitHub sign-in", "Live build output", "TLS project URLs"];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-16 pt-28 sm:pb-20 sm:pt-36">
      <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-14 xl:gap-20">
        <Reveal y={10}>
          <p className="flex items-center gap-2.5 text-[13px] leading-6 text-dim sm:text-sm">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            Live build logs, streamed line by line
          </p>

          <h1
            id="hero-title"
            className="mt-5 font-sans text-[clamp(2.25rem,4.4vw,3.5rem)] font-medium leading-[1.12] tracking-[-0.035em] text-fg"
          >
            Your repo in.
            <br />
            A live site out.
          </h1>

          <p className="mt-6 max-w-[47ch] text-base leading-7 text-dim">
            LaunchPad clones your repository, detects the framework, builds it
            on Fargate and serves the output from the edge. Pick a folder,
            watch it compile, keep the subdomain.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/launch"
              className={buttonStyles("primary", "md", "group h-11 px-4")}
            >
              Deploy a repository
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 ease-smooth group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#workflow"
              className="group inline-flex min-h-11 items-center gap-2 rounded text-sm font-medium text-dim transition-colors hover:text-fg"
            >
              See the pipeline
              <ArrowDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5 motion-reduce:transform-none" />
            </a>
          </div>

          <ul aria-label="Platform essentials" className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] leading-5 text-dim">
            {facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </Reveal>

        <Reveal delay={0.12} y={12}>
          <BuildPreview />
        </Reveal>
      </div>
    </section>
  );
}
