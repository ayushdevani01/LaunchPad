"use client";

import * as React from "react";
import {
  ChevronRight,
  CornerLeftUp,
  FileCode2,
  FolderClosed,
  FolderOpen,
} from "lucide-react";
import { listDirectories, type DirectoryListing } from "@/lib/api";
import { cn } from "@/lib/cn";

export function FolderPicker({
  owner,
  repo,
  branch,
  value,
  onChange,
  id,
}: {
  owner?: string;
  repo?: string;
  branch?: string;
  value: string;
  onChange: (path: string) => void;
  id?: string;
}) {
  const [browse, setBrowse] = React.useState(value);
  const [manual, setManual] = React.useState(false);
  const [listing, setListing] = React.useState<DirectoryListing | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const canBrowse = Boolean(owner && repo && branch);
  const segments = browse ? browse.split("/") : [];

  React.useEffect(() => {
    setBrowse(value);
  }, [value]);

  React.useEffect(() => {
    if (!canBrowse || manual) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");

    setListing(null);
    listDirectories(owner!, repo!, branch!, browse, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setListing(data);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Could not list folders",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [canBrowse, manual, owner, repo, branch, browse]);

  if (!canBrowse) {
    return (
      <input
        id={id}
        aria-label="Source folder"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="frontend or packages/web"
        className="h-10 w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 font-mono text-[13px] text-fg placeholder:text-faint focus:border-white/25 focus:outline-none"
      />
    );
  }

  const atSelection = value === browse;

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.09] bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1 font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setBrowse("")}
            className={cn(
              "shrink-0 rounded px-1 py-0.5 hover:bg-white/[0.06]",
              browse ? "text-faint" : "text-fg",
            )}
          >
            {repo}
          </button>
          {segments.map((segment, index) => {
            const path = segments.slice(0, index + 1).join("/");
            return (
              <React.Fragment key={path}>
                <ChevronRight className="h-3 w-3 shrink-0 text-white/20" />
                <button
                  type="button"
                  onClick={() => setBrowse(path)}
                  className={cn(
                    "truncate rounded px-1 py-0.5 hover:bg-white/[0.06]",
                    index === segments.length - 1 ? "text-fg" : "text-faint",
                  )}
                >
                  {segment}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setManual((state) => !state)}
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint hover:bg-white/[0.06] hover:text-dim"
        >
          {manual ? "Browse" : "Type path"}
        </button>
      </div>

      {manual ? (
        <div className="p-2.5">
          <input
            id={id}
            aria-label="Source folder path"
            value={value}
            onChange={(event) =>
              onChange(event.target.value.replace(/^\/+|\/+$/g, ""))
            }
            placeholder="apps/web"
            autoFocus
            className="h-9 w-full rounded-md border border-white/[0.09] bg-black/30 px-2.5 font-mono text-[12px] text-fg placeholder:text-faint focus:border-white/25 focus:outline-none"
          />
          <p className="mt-2 text-[11px] text-faint">
            Relative to the repository root. Leave empty to build the root.
          </p>
        </div>
      ) : (
        <div className="max-h-[190px] min-h-[92px] overflow-y-auto p-1.5">
          {browse ? (
            <button
              type="button"
              onClick={() => setBrowse(segments.slice(0, -1).join("/"))}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-mono text-[12px] text-faint hover:bg-white/[0.04]"
            >
              <CornerLeftUp className="h-3 w-3" />
              ..
            </button>
          ) : null}

          {loading ? (
            <div className="space-y-1.5 p-1">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-7 animate-pulse rounded bg-white/[0.04]"
                />
              ))}
            </div>
          ) : error ? (
            <div className="p-2.5">
              <p className="text-[12px] text-warn">{error}</p>
              <button
                type="button"
                onClick={() => setManual(true)}
                className="mt-2 rounded border border-white/[0.12] px-2 py-1 text-[11px] text-dim hover:text-fg"
              >
                Enter the path manually
              </button>
            </div>
          ) : listing && listing.directories.length === 0 ? (
            <p className="px-2.5 py-4 text-center font-mono text-[11px] text-faint">
              No subfolders here
            </p>
          ) : (
            listing?.directories.map((directory) => (
              <button
                key={directory.path}
                type="button"
                onClick={() => setBrowse(directory.path)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors",
                  directory.path === value
                    ? "bg-accent/[0.07] text-fg"
                    : "text-dim hover:bg-white/[0.04] hover:text-fg",
                )}
              >
                {directory.path === value ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                ) : (
                  <FolderClosed className="h-3.5 w-3.5 shrink-0 text-white/25" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {directory.name}
                </span>
                {directory.hasPackageJson ? (
                  <span className="flex shrink-0 items-center gap-1 rounded border border-white/[0.08] px-1.5 py-px text-[9px] text-mint">
                    <FileCode2 className="h-2.5 w-2.5" />
                    pkg
                  </span>
                ) : null}
                <ChevronRight className="h-3 w-3 shrink-0 text-white/20" />
              </button>
            ))
          )}
        </div>
      )}

      {!manual ? (
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-2.5 py-2">
          <span className="min-w-0 truncate font-mono text-[10.5px] text-faint">
            {listing?.hasPackageJson
              ? "package.json in this folder"
              : "no package.json here"}
          </span>
          <button
            type="button"
            onClick={() => onChange(browse)}
            disabled={atSelection || loading || !!error}
            className={cn(
              "shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
              atSelection
                ? "border-accent/25 bg-accent/[0.07] text-accent"
                : "border-white/[0.14] text-fg hover:border-white/30 hover:bg-white/[0.05]",
            )}
          >
            {atSelection
              ? `using ${browse.split("/").pop() || "root"}`
              : browse
                ? `use ${browse.split("/").pop()}`
                : "use root"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
