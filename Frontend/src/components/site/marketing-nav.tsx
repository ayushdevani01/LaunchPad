"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { Sheet } from "@/components/ui/sheet";
import { buttonStyles } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/cn";

const links = [
  { href: "#platform", label: "Platform" },
  { href: "#workflow", label: "Workflow" },
  { href: "#access", label: "Get started" },
  { href: "#faq", label: "FAQ" },
];

export function MarketingNav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { user, loading } = useAuth();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-smooth",
          scrolled
            ? "border-b border-white/[0.07] bg-ink/80 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full items-center justify-between px-5 transition-all duration-500 ease-smooth sm:px-8",
            scrolled ? "h-14" : "h-[72px]",
          )}
        >
          <Logo />

          <nav
            aria-label="Sections"
            className="hidden items-center gap-1 md:flex"
          >
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-[13px] text-dim transition-colors duration-200 hover:text-fg"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {loading ? (
              <div className="h-8 w-40 animate-pulse rounded-lg bg-white/[0.04]" />
            ) : user ? (
              <Link href="/dashboard" className={buttonStyles("primary", "sm")}>
                Open dashboard
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonStyles("ghost", "sm")}>
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className={buttonStyles("primary", "sm")}
                >
                  Start deploying
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.1] text-dim md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      <Sheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Navigate"
      >
        <nav className="flex flex-col">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="border-b border-white/[0.06] py-3.5 text-[15px] text-dim"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="mt-5 grid gap-2">
          {user ? (
            <Link href="/dashboard" className={buttonStyles("primary", "lg")}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/register" className={buttonStyles("primary", "lg")}>
                Start deploying
              </Link>
              <Link href="/login" className={buttonStyles("outline", "lg")}>
                Sign in
              </Link>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
