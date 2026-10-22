"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, RefreshCw, Rocket } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AppShell } from "@/components/app/app-shell";
import { ProjectCard } from "@/components/app/project-card";
import { CommandMenu } from "@/components/app/command-menu";
import { Button, buttonStyles } from "@/components/ui/button";
import { listProjects, type Project } from "@/lib/api";

function DashboardBody() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setProjects(await listProjects());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">Projects</h1>
            <span className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-faint">
              {loading ? "-" : projects.length}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-faint">
            Every deployment, its domain and the branch it tracks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <CommandMenu projects={projects} />
          <Link href="/launch" className={buttonStyles("primary", "md", "shrink-0")}>
            <Plus className="h-3.5 w-3.5" />
            New deployment
          </Link>
        </div>
      </div>

      <div className="mt-8">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-[136px] animate-pulse rounded-xl border border-white/[0.06] bg-panel/40"
                style={{ animationDelay: `${index * 60}ms` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-danger/25 bg-danger/[0.05] p-6">
            <p className="text-sm text-danger">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()} className="mt-4">
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="relative overflow-hidden rounded-xl border border-dashed border-white/[0.12] bg-panel/30 px-6 py-16 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-white/[0.1] bg-white/[0.03]">
              <Rocket className="h-4 w-4 text-dim" />
            </div>
            <h2 className="mt-5 text-[15px] font-medium">No deployments yet</h2>
            <p className="mx-auto mt-1.5 max-w-[36ch] text-[13px] leading-relaxed text-faint">
              Connect a repository, choose the folder that holds your app, and the first build will
              appear here with its own subdomain.
            </p>
            <Link href="/launch" className={buttonStyles("primary", "md", "mt-6")}>
              <Plus className="h-3.5 w-3.5" />
              Deploy a repository
            </Link>
            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              GitHub · public or private
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project._id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <DashboardBody />
      </AppShell>
    </ProtectedRoute>
  );
}
