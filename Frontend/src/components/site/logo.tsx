import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";

export function Logo({
  href = "/",
  className,
  showBeta = true,
}: {
  href?: string;
  className?: string;
  showBeta?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="LaunchPad home"
      className={cn("group inline-flex items-center gap-2.5 text-fg", className)}
    >
      <Image
        src="/brand/launchpad-mark.svg"
        width={32}
        height={32}
        alt=""
        aria-hidden="true"
        className="shrink-0 transition-transform duration-300 ease-smooth group-hover:-translate-y-0.5 motion-reduce:transform-none"
      />
      <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">
        Launch<span className="text-fg/75">Pad</span>
      </span>
      {showBeta ? (
        <span className="mt-[-6px] rounded border border-white/10 px-1 py-px font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          beta
        </span>
      ) : null}
    </Link>
  );
}
