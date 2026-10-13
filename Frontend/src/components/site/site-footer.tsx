import Link from "next/link";
import { Logo } from "@/components/site/logo";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "#platform" },
      { label: "Workflow", href: "#workflow" },
      { label: "Get started", href: "#access" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Build logs", href: "#platform" },
      { label: "Project subdomains", href: "#platform" },
      { label: "Framework support", href: "#platform" },
    ],
  },
  {
    title: "Resources",
    links: [
      {
        label: "Repository",
        href: "https://github.com/ayushdevani01/LaunchPad",
      },
      { label: "Questions", href: "#faq" },
      { label: "Support", href: "#faq" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.07] bg-ink">
      <div className="mx-auto max-w-[1180px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-[260px] text-[13px] leading-relaxed text-faint">
              A deployment platform for frontends. Connect a repository, choose
              a folder, get a URL.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              GitHub to deployment
            </div>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="label-mono mb-3.5">{column.title}</h3>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="link-underline text-[13px] text-dim transition-colors duration-200 hover:text-fg"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/[0.06] pt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 LaunchPad</span>
          <span className="flex items-center gap-4">
            <span>Built on AWS</span>
            <span aria-hidden>·</span>
            <span>TLS secured</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
