"use client";
import { useEffect, type RefObject } from "react";

export function useModalFocus(open: boolean, root: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open || !root.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) || [],
      ).filter((node) => node.getClientRects().length > 0);
    (
      root.current.querySelector<HTMLElement>("input") || focusable()[0]
    )?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable(),
        first = items[0],
        last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        !root.current?.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, root]);
}
