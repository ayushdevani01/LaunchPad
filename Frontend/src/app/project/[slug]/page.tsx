"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Copy,
  GitBranch,
  Globe2,
  Lock,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AppShell } from "@/components/app/app-shell";
import { LogStream } from "@/components/app/log-stream";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import {
  fetchDeploymentLogs,
  getProject,
  listDeployments,
  projectUrl,
  redeploy as triggerRedeploy,
  repoPath,
  APP_DOMAIN,
  type Deployment,
  type Project,
} from "@/lib/api";
import { absoluteTime, relativeTime, shortId } from "@/lib/format";
import { cn } from "@/lib/cn";

const ACTIVE = new Set(["BUILDING", "PENDING"]);

function ProjectBody() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [project, setProject] = React.useState<Project | null>(null);
  const [deployments, setDeployments] = React.useState<Deployment[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [logs, setLogs] = React.useState("");
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [logsError, setLogsError] = React.useState("");
  const [logsRetry, setLogsRetry] = React.useState(0);
  const [redeploying, setRedeploying] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const redeployLock = React.useRef(false);
  const loadSequence = React.useRef(0);

  const load = React.useCallback(
    async (signal?: AbortSignal, selectLatest = false) => {
      const sequence = ++loadSequence.current;
      try {
        const [nextProject, nextDeployments] = await Promise.all([
          getProject(slug, signal),
          listDeployments(slug, signal),
        ]);
        if (signal?.aborted || sequence !== loadSequence.current) return;
        setProject(nextProject);
        setDeployments(nextDeployments);
        setSelectedId((current) =>
          !selectLatest && nextDeployments.some((item) => item._id === current)
            ? current
            : (nextDeployments[0]?._id ?? null),
        );
        setError("");
      } catch (cause) {
        if (signal?.aborted || sequence !== loadSequence.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load this project",
        );
      } finally {
        if (!signal?.aborted && sequence === loadSequence.current)
          setLoading(false);
      }
    },
    [slug],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selected = deployments.find((item) => item._id === selectedId) ?? null;
  const live = selected ? ACTIVE.has(selected.status) : false;
  const active = deployments.some((item) => ACTIVE.has(item.status));
  const deploymentId = selected?._id;

  // Keep the deployment list fresh while a build is in flight.
  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [active, load]);

  // Finished deployments read their archived log, retrying while it uploads.
  React.useEffect(() => {
    setLogsError("");
    if (!deploymentId || live) {
      setLogs("");
      setLogsLoading(false);
      return;
    }

    const controller = new AbortController();
    setLogsLoading(true);
    setLogs("");

    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const data = await fetchDeploymentLogs(
            slug,
            deploymentId,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (data.pending && attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            if (controller.signal.aborted) return;
            continue;
          }
          if (data.pending)
            throw new Error(
              "The log archive is still being saved. Try loading it again shortly.",
            );
          if (!controller.signal.aborted)
            setLogs(data.logs || "No output was recorded for this build.");
          break;
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (attempt === 2) {
            setLogsError(
              cause instanceof Error
                ? cause.message
                : "Could not load the archived log.",
            );
          }
        }
      }
      if (!controller.signal.aborted) setLogsLoading(false);
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [deploymentId, live, slug, logsRetry]);

  const onRedeploy = async () => {
    if (redeployLock.current || active) return;
    redeployLock.current = true;
    setRedeploying(true);
    try {
      await triggerRedeploy(slug);
      await load(undefined, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not redeploy");
    } finally {
      setRedeploying(false);
      redeployLock.current = false;
    }
  };

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setLogsError(
        "Copy was unavailable. Select the log text and copy it manually.",
      );
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-4 w-80 animate-pulse rounded bg-white/[0.03]" />
        <div className="mt-6 grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="h-72 animate-pulse rounded-xl border border-white/[0.06] bg-panel/40" />
          <div className="h-72 animate-pulse rounded-xl border border-white/[0.06] bg-panel/40" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-danger/25 bg-danger/[0.05] p-6">
        <p className="text-sm text-danger">
          {error || "This project could not be found."}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
          <Link href="/dashboard" className={buttonStyles("ghost", "sm")}>
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[12px] text-faint transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Projects
      </Link>

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">
              {project.name || project.slug}
            </h1>
            {selected ? <StatusBadge status={selected.status} /> : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-faint">
            {project.currentDeployment ? (
              <a
                href={projectUrl(project.slug)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-dim hover:text-fg"
              >
                <Lock className="h-3 w-3 text-white/30" />
                {project.slug}.{APP_DOMAIN}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              <span className="font-mono text-[11.5px] text-faint">
                No production deployment yet
              </span>
            )}
            <a
              href={project.gitUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[11.5px] hover:text-dim"
            >
              <Globe2 className="h-3 w-3" />
              {repoPath(project.gitUrl)}
            </a>
            {project.branch ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px]">
                <GitBranch className="h-3 w-3" />
                {project.branch}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {project.currentDeployment ? (
            <a
              href={projectUrl(project.slug)}
              target="_blank"
              rel="noreferrer"
              className={buttonStyles("secondary", "md")}
            >
              Visit site
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <Button
            size="md"
            onClick={() => void onRedeploy()}
            loading={redeploying}
            disabled={active}
          >
            <RotateCw className="h-3.5 w-3.5" />
            {active ? "Build in progress" : "Redeploy"}
          </Button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-danger/25 bg-danger/[0.05] p-3 text-[13px] text-danger"
        >
          {error}
        </p>
      ) : null}
      {selected?.failureReason ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-danger/25 p-3 text-[13px] text-danger"
        >
          {selected.failureReason}
        </p>
      ) : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Folder", value: project.sourceDir || "/" },
          { label: "Build", value: project.buildCommand || "default" },
          { label: "Output", value: project.outputDir || "default" },
          { label: "Created", value: absoluteTime(project.createdAt) },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-white/[0.07] bg-panel/50 px-3 py-2.5"
          >
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
              {item.label}
            </p>
            <p className="mt-1 truncate font-mono text-[11.5px] text-dim">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
        <div className="rounded-xl border border-white/[0.08] bg-panel/60">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Deployments
            </span>
            <span className="font-mono text-[10px] text-faint">
              {deployments.length}
            </span>
          </div>

          {deployments.length === 0 ? (
            <p className="px-3.5 py-8 text-center text-[12px] text-faint">
              No builds yet. Redeploy to create the first one.
            </p>
          ) : (
            <div className="max-h-[420px] space-y-0.5 overflow-y-auto p-1.5">
              {deployments.map((deployment) => {
                const isSelected = deployment._id === selectedId;
                return (
                  <button
                    key={deployment._id}
                    type="button"
                    onClick={() => setSelectedId(deployment._id)}
                    aria-pressed={isSelected}
                    className={cn(
                      "relative flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                      isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent transition-opacity",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11.5px] text-dim">
                        #{shortId(deployment._id)}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-faint">
                        {relativeTime(deployment.createdAt)}
                      </span>
                    </span>
                    <StatusBadge
                      status={deployment.status}
                      className="shrink-0 scale-90 px-2 py-0.5"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-panel/60">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11px] text-fg">
                    build #{shortId(selected._id)}
                  </span>
                  <span className="font-mono text-[10px] text-faint">
                    {absoluteTime(selected.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!live ? (
                    <button
                      type="button"
                      onClick={() => void copyLogs()}
                      disabled={logsLoading || !logs}
                      className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2 py-1 font-mono text-[10px] text-faint hover:text-fg"
                    >
                      <Copy className="h-2.5 w-2.5" />
                      {copied ? "copied" : "copy"}
                    </button>
                  ) : null}
                </div>
              </div>

              {logsError ? (
                <p
                  role="alert"
                  className="border-b border-warn/20 p-3 text-[12px] text-warn"
                >
                  {logsError}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setLogsRetry((value) => value + 1)}
                  >
                    Reload logs
                  </button>
                </p>
              ) : null}
              {live ? (
                <LogStream slug={slug} deploymentId={selected._id} />
              ) : (
                <div className="max-h-[60vh] min-h-[320px] flex-1 overflow-y-auto bg-black/45 p-3.5 font-mono text-[11.5px] leading-[1.75]">
                  {logsLoading ? (
                    <div className="flex items-center gap-2.5 text-faint">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/25 border-t-transparent" />
                      Retrieving the archived log…
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words text-dim">
                      {logs}
                    </pre>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center px-6 text-center">
              <div>
                <p className="text-[13px] text-dim">
                  Select a deployment to read its output.
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  Archived logs replay in full
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <ProtectedRoute>
      <AppShell>
        <ProjectBody key={slug} />
      </AppShell>
    </ProtectedRoute>
  );
}
