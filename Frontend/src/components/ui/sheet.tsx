"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useModalFocus } from "./use-modal-focus";

export function Sheet({
  open,
  onClose,
  title,
  children,
  hideAt = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  hideAt?: "md" | "lg";
}) {
  const root = React.useRef<HTMLDivElement>(null);
  useModalFocus(open, root);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const media = window.matchMedia(
      hideAt === "lg" ? "(min-width: 1024px)" : "(min-width: 768px)",
    );
    const resized = () => {
      if (media.matches) onClose();
    };
    media.addEventListener("change", resized);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", resized);
      document.body.style.overflow = previous;
    };
  }, [open, onClose, hideAt]);

  return (
    <AnimatePresence>
      {open ? (
        <div
          className={
            hideAt === "lg"
              ? "fixed inset-0 z-[60] lg:hidden"
              : "fixed inset-0 z-[60] md:hidden"
          }
        >
          <motion.button
            aria-label="Close menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            ref={root}
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Menu"}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-panel p-5 pb-8"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="label-mono">{title}</span>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-dim hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
