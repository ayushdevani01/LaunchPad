"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";

/** A quiet reading-progress cue that follows the shared brand accent. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] bg-white/[0.035]"
    >
      <motion.div
        className="h-full origin-left bg-accent shadow-[0_0_10px_rgb(var(--accent)/0.55)]"
        style={{ scaleX: reduceMotion ? scrollYProgress : smoothProgress }}
      />
    </div>
  );
}
