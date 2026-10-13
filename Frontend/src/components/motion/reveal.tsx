"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

const easing = [0.22, 1, 0.36, 1] as const;

const motionTags = {
  div: motion.div,
  span: motion.span,
  li: motion.li,
  section: motion.section,
} as const;

export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "span" | "li" | "section";
}) {
  const reduce = useReducedMotion();
  const Comp = motionTags[as];
  return (
    <Comp
      initial={reduce ? undefined : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.6, delay, ease: easing }}
      className={className}
    >
      {children}
    </Comp>
  );
}

/** Word-level mask reveal — the headline rises out of its own baseline. */
export function MaskedHeading({
  lines,
  className,
  delay = 0,
  as: Tag = "h1",
}: {
  lines: React.ReactNode[][];
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "p" | "span";
}) {
  const reduce = useReducedMotion();

  return (
    <Tag className={className}>
      {lines.map((words, lineIndex) => (
        <span key={lineIndex} className="block">
          {words.map((word, wordIndex) => (
            <span key={wordIndex} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
              <motion.span
                className="inline-block"
                initial={reduce ? undefined : { y: "110%" }}
                animate={{ y: "0%" }}
                transition={{
                  duration: 0.85,
                  delay: delay + lineIndex * 0.08 + wordIndex * 0.045,
                  ease: easing,
                }}
              >
                {word}
                {wordIndex < words.length - 1 ? "\u00a0" : ""}
              </motion.span>
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}

/** Pointer-following sheen. Neutral by design: lightens, never tints. */
export function Spotlight({
  children,
  className,
  radius = 340,
}: {
  children: React.ReactNode;
  className?: string;
  radius?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      onPointerMove={(event) => {
        const bounds = ref.current?.getBoundingClientRect();
        if (!bounds) return;
        ref.current!.style.setProperty("--mx", `${event.clientX - bounds.left}px`);
        ref.current!.style.setProperty("--my", `${event.clientY - bounds.top}px`);
      }}
      className={cn("group relative", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(${radius}px circle at var(--mx, 50%) var(--my, 0%), rgba(255,255,255,0.055), transparent 65%)`,
        }}
      />
      {children}
    </div>
  );
}
