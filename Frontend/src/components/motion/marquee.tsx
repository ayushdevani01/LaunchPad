import { cn } from "@/lib/cn";

export function Marquee({
  children,
  className,
  speed = "42s",
  reverse,
}: {
  children: React.ReactNode;
  className?: string;
  speed?: string;
  reverse?: boolean;
}) {
  return (
    <div className={cn("group relative flex overflow-hidden mask-fade-x", className)}>
      <div
        className="flex min-w-full shrink-0 items-center gap-12 pr-12 animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none"
        style={{ animationDuration: speed, animationDirection: reverse ? "reverse" : undefined }}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="flex min-w-full shrink-0 items-center gap-12 pr-12 animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none"
        style={{ animationDuration: speed, animationDirection: reverse ? "reverse" : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
