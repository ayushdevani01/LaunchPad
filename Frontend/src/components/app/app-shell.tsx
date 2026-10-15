"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, LogOut, Menu, Plus } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { Sheet } from "@/components/ui/sheet";
import { buttonStyles } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/cn";

const nav = [
  { href: "/dashboard", label: "Projects", icon: Boxes, match: "/dashboard" },
];

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-200",
        active
          ? "bg-white/[0.05] text-fg"
          : "text-dim hover:bg-white/[0.03] hover:text-fg",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const initial = (user?.username || user?.email || "?")
    .slice(0, 1)
    .toUpperCase();

  const account = (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.02] p-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] font-mono text-[11px] text-fg">
          {initial}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-fg">
            {user?.username ?? "Account"}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {user?.email}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => logout("/")}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] text-faint transition-colors hover:bg-white/[0.03] hover:text-fg"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-white/[0.07] p-4 lg:flex">
        <div className="px-1.5">
          <Logo href="/dashboard" showBeta={false} />
        </div>

        <Link
          href="/launch"
          className={buttonStyles("primary", "md", "mt-6 w-full")}
        >
          <Plus className="h-3.5 w-3.5" />
          New deployment
        </Link>

        <nav aria-label="Workspace" className="mt-5 space-y-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={
                pathname === item.match || pathname.startsWith(`${item.match}/`)
              }
            />
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            GitHub connected workspace
          </div>
          {account}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-ink/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Logo href="/dashboard" showBeta={false} />
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open workspace menu"
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.1] text-dim"
          >
            <Menu className="h-4 w-4" />
          </button>
        </header>

        <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-7 sm:px-8 sm:py-10">
          {children}
        </main>
      </div>

      <Sheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Workspace"
        hideAt="lg"
      >
        <nav className="space-y-1">
          <NavLink
            href="/launch"
            label="New deployment"
            icon={Plus}
            active={pathname === "/launch"}
            onNavigate={() => setMenuOpen(false)}
          />
          {nav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={pathname === item.match}
              onNavigate={() => setMenuOpen(false)}
            />
          ))}
        </nav>
        <div className="mt-5 border-t border-white/[0.07] pt-4">{account}</div>
      </Sheet>
    </div>
  );
}
