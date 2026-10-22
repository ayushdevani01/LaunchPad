"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/cn";

const items = [
  {
    question: "Which frameworks can I deploy?",
    answer:
      "Next.js with server rendering and API routes, plus static websites built with tools such as Vite, React, Vue, or Astro. Other server frameworks need a compatible static export; arbitrary server runtimes are not supported. Detection checks the folder you choose before deployment.",
  },
  {
    question: "How does a monorepo work?",
    answer:
      "After picking a repository and branch, the folder picker walks the tree. Choose apps/web and LaunchPad builds only that directory. Install command, build command and output path are all resolved relative to it.",
  },
  {
    question: "Can I deploy a private repository?",
    answer:
      "Yes, when your connected GitHub account can read it. LaunchPad uses that connection to list and inspect repositories and clone the selected source during a build. You can also paste a public GitHub repository URL.",
  },
  {
    question: "Where does the built site live?",
    answer:
      "Static assets are stored in S3. Next.js server rendering and API routes run on demand in AWS Lambda. Your project receives a TLS-secured LaunchPad subdomain once its first deployment is ready.",
  },
  {
    question: "What happens when a build fails?",
    answer:
      "The task exits with the real error code, the full log is archived, and the previous successful deployment keeps serving. The dashboard keeps both the live stream and the replay for comparison.",
  },
  {
    question: "Do I need a custom domain?",
    answer:
      "No. Every project gets a LaunchPad subdomain when its first build succeeds. Connecting your own domain is not currently available in the dashboard.",
  },
];

export function Faq() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section id="faq" className="relative pb-20 pt-6 sm:pb-28 sm:pt-10">
      <div className="mx-auto grid w-full gap-10 px-5 sm:px-8 md:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <p className="label-mono">04 / Questions</p>
          <h2 className="mt-4 max-w-[16ch] text-[clamp(1.85rem,3.4vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.035em]">
            The things people ask before the first deploy.
          </h2>
          <p className="mt-4 max-w-[32ch] text-[13px] leading-relaxed text-faint">
            Still stuck? Open an issue or reach out. The pipeline details are
            documented in the repository.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="border-t border-white/[0.08]">
            {items.map((item, index) => {
              const isOpen = open === index;
              return (
                <div
                  key={item.question}
                  className="border-b border-white/[0.08]"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : index)}
                    className="group flex w-full items-start justify-between gap-6 py-4 text-left"
                  >
                    <span
                      className={cn(
                        "text-[14px] leading-snug transition-colors duration-200",
                        isOpen ? "text-fg" : "text-dim group-hover:text-fg",
                      )}
                    >
                      {item.question}
                    </span>
                    <Plus
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform duration-300 ease-smooth",
                        isOpen && "rotate-45 text-accent",
                      )}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-[62ch] pb-5 pr-8 text-[13px] leading-relaxed text-faint">
                          {item.answer}
                        </p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
