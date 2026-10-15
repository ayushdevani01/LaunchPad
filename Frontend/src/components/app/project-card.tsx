import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { APP_DOMAIN, repoPath, type Project } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Spotlight } from "@/components/motion/reveal";

export function ProjectCard({ project }: { project: Project }) {
  const repo = repoPath(project.gitUrl);

  return (
    <Spotlight className="rounded-xl border border-white/[0.08] bg-panel/70 transition-colors duration-300 hover:border-white/[0.18]">
      <Link
        href={`/project/${project.slug}`}
        className="flex h-full flex-col justify-between p-4"
        aria-label={`Open ${project.name || project.slug}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-medium tracking-[-0.01em] text-fg">
              {project.name || project.slug}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] text-faint">
              <span className="truncate">{repo}</span>
              {project.branch ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 text-dim">{project.branch}</span>
                </>
              ) : null}
            </p>
          </div>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/[0.08] text-faint transition-all duration-300 group-hover:border-white/20 group-hover:text-fg">
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-dim">
            <Lock className="h-2.5 w-2.5 shrink-0 text-white/25" />
            <span className="truncate">
              {project.currentDeployment
                ? `${project.slug}.${APP_DOMAIN}`
                : "No production deployment yet"}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            {relativeTime(project.createdAt)}
          </span>
        </div>
      </Link>
    </Spotlight>
  );
}
