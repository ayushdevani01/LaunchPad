"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const frameworks = [
  { name: "Next.js", slug: "nextdotjs", color: "#FFFFFF" },
  { name: "React", slug: "react", color: "#61DAFB" },
  { name: "Vite", slug: "vite", color: "#646CFF" },
  { name: "Astro", slug: "astro", color: "#BC52EE" },
  { name: "Vue", slug: "vuedotjs", color: "#4FC08D" },
  { name: "Static HTML", slug: "html5", color: "#E34F26" },
];

export function FrameworkStack() {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const active = hovered ?? focused ?? selected;

  return (
    <section
      aria-label="Supported frameworks"
      className="relative border-y border-white/[0.07]"
    >
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-5 py-7 sm:px-8 md:flex-row md:items-center md:gap-10">
        <p className="label-mono shrink-0 whitespace-nowrap md:w-[186px]">
          Frameworks supported
        </p>
        <div
          role="group"
          aria-label="Framework logos"
          className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 xl:overflow-visible xl:pb-0"
          onMouseLeave={() => setHovered(null)}
        >
          {frameworks.map((framework, index) => {
            const isActive = active === index;
            const mask = `url(https://cdn.simpleicons.org/${framework.slug})`;

            return (
              <motion.button
                key={framework.name}
                type="button"
                aria-label={framework.name}
                aria-pressed={selected === index}
                onMouseEnter={() => setHovered(index)}
                onFocus={() => setFocused(index)}
                onBlur={() => setFocused(null)}
                onClick={() =>
                  setSelected((current) =>
                    current === index ? null : index,
                  )
                }
                initial={false}
                animate={{ flexGrow: isActive ? 1.6 : 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 360, damping: 32 }
                }
                className={`group relative flex h-[66px] min-w-[122px] flex-1 items-center gap-2.5 rounded-lg border px-3 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
                  isActive
                    ? "border-accent/35 bg-accent/[0.07]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${
                    isActive ? "scale-110" : "scale-100"
                  }`}
                  style={{
                    backgroundColor: framework.color,
                    maskImage: mask,
                    WebkitMaskImage: mask,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                  }}
                />
                <span
                  className={`whitespace-nowrap text-[12px] tracking-tight transition-colors duration-300 motion-reduce:transition-none ${
                    isActive ? "text-fg" : "text-dim"
                  }`}
                >
                  {framework.name}
                </span>
                {selected === index ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 h-1 w-1 rounded-full bg-accent"
                  />
                ) : null}
              </motion.button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
