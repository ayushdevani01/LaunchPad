"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Github,
  Globe2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Triangle,
  X,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AppShell } from "@/components/app/app-shell";
import { FolderPicker } from "@/components/app/folder-picker";
import { GitHubButton } from "@/components/auth/github-button";
import { SegmentedTabs } from "@/components/ui/tabs";
import { Select, type SelectOption } from "@/components/ui/select";
import { Field, Input, SuffixInput } from "@/components/ui/field";
import { Button, buttonStyles } from "@/components/ui/button";
import { Pill } from "@/components/ui/badge";
import {
  APP_DOMAIN,
  checkProjectName,
  createProject,
  detectFramework,
  listBranches,
  repositoryConnection,
  connectRepositories,
  projectUrl,
  type Detection,
  type GitHubRepo,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { environmentIssue, validSourcePath } from "@/lib/deployment-form";

type Mode = "mine" | "url";
type NameState =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid"
  | "error";

type RepoRef = {
  owner: string;
  repo: string;
  fullName: string;
  gitUrl: string;
  defaultBranch?: string;
};

const steps = ["Source", "Configure", "Review"];

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseRepoUrl(
  value: string,
): { owner: string; repo: string; gitUrl: string } | null {
  const match = value
    .trim()
    .match(
      /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i,
    );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    gitUrl: `https://github.com/${match[1]}/${match[2]}`,
  };
}

function Stepper({
  step,
  onJump,
}: {
  step: number;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((label, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (index < step ? onJump(index) : undefined)}
              disabled={index > step}
              className={cn(
                "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
                index < step && "hover:bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full border font-mono text-[10px]",
                  active && "border-accent bg-accent text-ink",
                  done && "border-accent/40 bg-accent/[0.1] text-accent",
                  !active && !done && "border-white/[0.12] text-faint",
                )}
              >
                {done ? <Check className="h-2.5 w-2.5" /> : `0${index + 1}`}
              </span>
              <span
                className={cn(
                  "text-[12px]",
                  active ? "text-fg" : done ? "text-dim" : "text-faint",
                )}
              >
                {label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "h-px w-6",
                  done ? "bg-accent/40" : "bg-white/[0.1]",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function DetectionPanel({
  detecting,
  detection,
  error,
  path,
}: {
  detecting: boolean;
  detection: Detection | null;
  error: string;
  path: string;
}) {
  if (detecting) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-[12px] text-dim">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/25 border-t-transparent" />
        Reading the manifest at{" "}
        {path ? (
          <code className="font-mono text-fg">{path}</code>
        ) : (
          "the repository root"
        )}
        …
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-warn/20 bg-warn/[0.05] px-3 py-2.5 text-[12px] text-warn">
        <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!detection) return null;

  const supported = detection.supported === "YES";
  const partial = detection.supported === "PARTIAL";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3",
        supported && "border-mint/20 bg-mint/[0.04]",
        partial && "border-warn/20 bg-warn/[0.04]",
        !supported && !partial && "border-danger/25 bg-danger/[0.05]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded border",
            supported && "border-mint/25 text-mint",
            partial && "border-warn/25 text-warn",
            !supported && !partial && "border-danger/25 text-danger",
          )}
        >
          <Triangle className="h-3 w-3" />
        </span>
        <span className="text-[13px] text-fg">{detection.framework}</span>
        <span
          className={cn(
            "rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em]",
            supported && "border-mint/25 bg-mint/10 text-mint",
            partial && "border-warn/25 bg-warn/10 text-warn",
            !supported &&
              !partial &&
              "border-danger/25 bg-danger/10 text-danger",
          )}
        >
          {supported ? "supported" : partial ? "warnings" : "unsupported"}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">
          detected automatically
        </span>
      </div>

      {detection.notes ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
          {detection.notes}
        </p>
      ) : null}

      {supported || partial ? (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-faint">
          {detection.installCommand ? (
            <span>install: {detection.installCommand}</span>
          ) : null}
          {detection.buildCommand ? (
            <span>build: {detection.buildCommand}</span>
          ) : null}
          {detection.outputDir ? (
            <span>output: {detection.outputDir}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-2.5 last:border-b-0">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        {label}
      </span>
      <span className="min-w-0 break-words text-right font-mono text-[11.5px] text-dim">
        {value}
      </span>
    </div>
  );
}

function LaunchBody() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>("mine");

  // Source
  const [repos, setRepos] = React.useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = React.useState(true);
  const [reposError, setReposError] = React.useState("");
  const [signInRequired, setSignInRequired] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [autoDeploy, setAutoDeploy] = React.useState(true);
  const [watchPaths, setWatchPaths] = React.useState("");
  const [repoFullName, setRepoFullName] = React.useState("");
  const [manualUrl, setManualUrl] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [branches, setBranches] = React.useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [sourceDir, setSourceDir] = React.useState("");

  // Detection
  const [detection, setDetection] = React.useState<Detection | null>(null);
  const [detecting, setDetecting] = React.useState(false);
  const [detectError, setDetectError] = React.useState("");

  // Configure
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [nameState, setNameState] = React.useState<NameState>("idle");
  const [checkedName, setCheckedName] = React.useState("");
  const [installCommand, setInstallCommand] = React.useState("");
  const [buildCommand, setBuildCommand] = React.useState("");
  const [startCommand, setStartCommand] = React.useState("");
  const [outputDir, setOutputDir] = React.useState("");
  const [envVars, setEnvVars] = React.useState<
    { key: string; value: string }[]
  >([]);
  const [advanced, setAdvanced] = React.useState(false);
  const [showEnvValues, setShowEnvValues] = React.useState(false);
  const [target, setTarget] = React.useState<
    "auto" | "static" | "nextjs-web" | "nodejs-web"
  >("auto");
  const submitLock = React.useRef(false);

  // Submit
  const [deploying, setDeploying] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [result, setResult] = React.useState<{
    slug: string;
    url: string;
  } | null>(null);

  const selectedRepo =
    repos.find((item) => item.fullName === repoFullName) ?? null;
  const parsedUrl = React.useMemo(() => parseRepoUrl(manualUrl), [manualUrl]);

  const repoRef: RepoRef | null = React.useMemo(() => {
    if (mode === "mine" && selectedRepo) {
      return {
        owner: selectedRepo.fullName.split("/")[0],
        repo: selectedRepo.name,
        fullName: selectedRepo.fullName,
        gitUrl: selectedRepo.gitUrl,
        defaultBranch: selectedRepo.defaultBranch,
      };
    }
    if (mode === "url" && parsedUrl) {
      return {
        owner: parsedUrl.owner,
        repo: parsedUrl.repo,
        fullName: `${parsedUrl.owner}/${parsedUrl.repo}`,
        gitUrl: parsedUrl.gitUrl,
      };
    }
    return null;
  }, [mode, selectedRepo, parsedUrl]);

  React.useEffect(() => {
    const controller = new AbortController();
    repositoryConnection(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRepos(data.repos);
          setSignInRequired(data.signInRequired === true);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setReposError(
            cause instanceof Error
              ? cause.message
              : "Could not load repositories",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setReposLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, []);

  React.useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("githubError");
    if (error) setReposError(error);
  }, []);

  const connect = async () => {
    setConnecting(true);
    setReposError("");
    try {
      const { url } = await connectRepositories();
      window.location.assign(url);
    } catch (cause) {
      setReposError(cause instanceof Error ? cause.message : "Could not connect repositories");
      setConnecting(false);
    }
  };

  // A new repository resets everything that was derived from the previous one.
  React.useEffect(() => {
    setBranch("");
    setBranches([]);
    setSourceDir("");
    setDetection(null);
    setDetectError("");
    setTarget("auto");
    setInstallCommand("");
    setBuildCommand("");
    setOutputDir("");
  }, [repoRef?.fullName]);

  React.useEffect(() => {
    if (!repoRef) return;
    const controller = new AbortController();
    setBranchesLoading(true);

    listBranches(repoRef.owner, repoRef.repo, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setBranches(data);
        const preferred =
          repoRef.defaultBranch && data.includes(repoRef.defaultBranch)
            ? repoRef.defaultBranch
            : data.includes("main")
              ? "main"
              : data[0];
        setBranch((current) =>
          current && data.includes(current) ? current : (preferred ?? "main"),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBranches([]);
          setBranch((current) => current || repoRef.defaultBranch || "main");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false);
      });

    return () => controller.abort();
  }, [repoRef]);

  // Framework detection follows repository + branch + folder.
  React.useEffect(() => {
    setDetecting(false);
    setDetectError("");
    setDetection(null);
    setInstallCommand("");
    setBuildCommand("");
    setOutputDir("");
    if (!repoRef || !branch.trim() || !validSourcePath(sourceDir)) return;
    const controller = new AbortController();
    setDetecting(true);

    const timer = window.setTimeout(() => {
      detectFramework(
        repoRef.owner,
        repoRef.repo,
        branch.trim(),
        sourceDir,
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          setDetection(data);
          if (data.supported !== "NO") {
            setInstallCommand(data.installCommand ?? "");
            setBuildCommand(data.buildCommand ?? "");
            setStartCommand(data.startCommand ?? "");
            setOutputDir(data.outputDir ?? "");
          }
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setDetection(null);
          setDetectError(
            cause instanceof Error
              ? cause.message
              : "Could not read this repository. Set the build commands manually.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetecting(false);
        });
    }, 650);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [repoRef, branch, sourceDir]);

  // Auto-suggest the project name from the repository the first time only.
  React.useEffect(() => {
    if (!repoRef || nameTouched) return;
    const suggestion = repoRef.repo
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setName(suggestion);
    setNameState("idle");
  }, [repoRef, nameTouched]);

  React.useEffect(() => {
    if (!name) {
      setNameState("idle");
      return;
    }
    if (!slugPattern.test(name) || name.length > 40) {
      setNameState("invalid");
      return;
    }
    setNameState("checking");
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkProjectName(name, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setCheckedName(name);
            setNameState(data.available ? "available" : "taken");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setNameState("error");
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [name]);

  const urlError =
    mode === "url" && manualUrl.trim().length > 0 && !parsedUrl
      ? "Use a GitHub repository URL, for example https://github.com/owner/repo"
      : "";

  const invalidPath = !validSourcePath(sourceDir);
  const sourceValid =
    Boolean(repoRef && branch.trim()) && !urlError && !invalidPath;
  const unsupported = detection?.supported === "NO" && target !== "static";
  const nameValid =
    !name ||
    (slugPattern.test(name) &&
      name.length <= 40 &&
      nameState === "available" &&
      checkedName === name);
  const envError = environmentIssue(envVars);
  const canDeploy =
    sourceValid && nameValid && !detecting && !unsupported && !envError;

  const setDir = (value: string) => {
    setSourceDir(value);
  };

  const selectBranch = (value: string) => {
    setBranch(value);
    setSourceDir("");
  };

  const reset = () => {
    setStep(0);
    setMode("mine");
    setRepoFullName("");
    setManualUrl("");
    setBranch("");
    setSourceDir("");
    setDetection(null);
    setName("");
    setNameTouched(false);
    setNameState("idle");
    setInstallCommand("");
    setBuildCommand("");
    setOutputDir("");
    setEnvVars([]);
    setSubmitError("");
    setResult(null);
    setAdvanced(false);
    setTarget("auto");
  };

  const deploy = async () => {
    if (!repoRef || !canDeploy || submitLock.current) return;
    submitLock.current = true;
    setDeploying(true);
    setSubmitError("");
    try {
      const env = Object.fromEntries(
        envVars
          .filter((item) => item.key.trim())
          .map((item) => [item.key.trim(), item.value]),
      );
      const response = await createProject({
        gitURL: repoRef.gitUrl,
        project_name: name.trim() || undefined,
        sourceDir: sourceDir || undefined,
        branch: branch.trim(),
        deploymentTarget: target,
        installCommand: installCommand.trim() || undefined,
        buildCommand: buildCommand.trim() || undefined,
        startCommand: startCommand.trim() || undefined,
        outputDir: outputDir.trim() || undefined,
        envVars: Object.keys(env).length > 0 ? env : undefined,
        autoDeploy: autoDeploy && detection?.autoDeployAvailable !== false,
        watchPaths: watchPaths.split(",").map(path => path.trim()).filter(Boolean),
      });
      const data = response as {
        data?: { projectSlug?: string; url?: string };
      };
      const slug = data.data?.projectSlug || "";
      if (!slug)
        throw new Error(
          "The server did not return a project. Check your dashboard before trying again.",
        );
      setResult({
        slug,
        url: data.data?.url || (slug ? projectUrl(slug) : ""),
      });
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : "The deployment could not be started",
      );
    } finally {
      setDeploying(false);
      submitLock.current = false;
    }
  };

  const repoOptions: SelectOption[] = repos.map((repo) => ({
    value: repo.fullName,
    label: repo.fullName,
    hint: repo.private ? "Private repository" : "Public repository",
    meta: repo.private ? "private" : undefined,
  }));

  const branchOptions: SelectOption[] = branches.map((item) => ({
    value: item,
    label: item,
  }));

  if (result) {
    return (
      <div className="w-full py-6">
        <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-panel">
          <div className="border-b border-white/[0.07] px-6 py-8 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-accent/30 bg-accent/[0.08]">
              <Check className="h-5 w-5 text-accent" />
            </span>
            <h1 className="mt-5 text-[20px] font-medium tracking-[-0.02em]">
              Deployment queued
            </h1>
            <p className="mx-auto mt-2 max-w-[38ch] text-[13px] leading-relaxed text-faint">
              The build task is starting. Open the project to follow the log
              stream line by line.
            </p>
            {result.url ? (
              <span className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 font-mono text-[11.5px] text-dim hover:text-fg">
                <Globe2 className="h-3 w-3 text-faint" />
                {result.url.replace(/^https?:\/\//, "")}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 p-4 sm:flex-row">
            {result.slug ? (
              <button
                type="button"
                onClick={() => router.push(`/project/${result.slug}`)}
                className={buttonStyles("primary", "md", "flex-1")}
              >
                Open build logs
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={reset}
            >
              Deploy another
            </Button>
            <Link href="/dashboard" className={buttonStyles("ghost", "md")}>
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[12px] text-faint transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Projects
      </Link>

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">
            New deployment
          </h1>
          <p className="mt-1 text-[13px] text-faint">
            {step === 0
              ? "Choose the repository, branch and folder that should be built."
              : step === 1
                ? "Confirm the domain and how the build should run."
                : "One last look before the build task starts."}
          </p>
        </div>
        <Stepper
          step={step}
          onJump={(next) => {
            if (!deploying) setStep(next);
          }}
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-white/[0.09] bg-panel">
        <div className="p-5 sm:p-6">
          {step === 0 ? (
            <div className="space-y-5">
              <SegmentedTabs
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setSourceDir("");
                  setDetection(null);
                }}
                idPrefix="source-mode"
                options={[
                  {
                    value: "mine",
                    label: "Repositories",
                    icon: <Github className="h-3.5 w-3.5" />,
                  },
                  {
                    value: "url",
                    label: "Public URL",
                    icon: <Globe2 className="h-3.5 w-3.5" />,
                  },
                ]}
              />

              <div className="flex flex-col gap-3 rounded-lg border border-white/[0.09] p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-5 text-dim">
                  Sign-in reads your identity and email. Connect only the repositories you want LaunchPad to deploy.
                </p>
                {signInRequired ? (
                  <GitHubButton label="Sign in with the GitHub App" />
                ) : (
                  <Button variant="secondary" size="sm" loading={connecting} onClick={() => void connect()}>
                    Connect repositories
                  </Button>
                )}
              </div>

              {mode === "mine" ? (
                <Field
                  label="Repository"
                  htmlFor="repository"
                  hint={
                    reposError
                      ? undefined
                      : "Only repositories selected in your LaunchPad GitHub App installation are listed."
                  }
                  error={reposError || undefined}
                >
                  <Select
                    id="repository"
                    value={repoFullName || null}
                    options={repoOptions}
                    onValueChange={setRepoFullName}
                    placeholder={
                      reposLoading
                        ? "Loading repositories…"
                        : "Select a repository"
                    }
                    searchPlaceholder="Filter repositories…"
                    emptyLabel={
                      reposLoading ? "Loading…" : "No repositories match"
                    }
                    loading={reposLoading}
                    searchable
                    invalid={Boolean(reposError)}
                  />
                </Field>
              ) : (
                <Field
                  label="Repository URL"
                  htmlFor="repository-url"
                  hint="Public repositories can be deployed manually. Connect a repository you own to enable automatic deployments."
                  error={urlError || undefined}
                >
                  <Input
                    id="repository-url"
                    value={manualUrl}
                    onChange={(event) => setManualUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo"
                    inputMode="url"
                    className="font-mono text-[12.5px]"
                  />
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Branch"
                  htmlFor="branch"
                  hint={branchesLoading ? "Loading branches…" : undefined}
                >
                  {branches.length > 0 ? (
                    <Select
                      id="branch"
                      value={branch || null}
                      options={branchOptions}
                      onValueChange={selectBranch}
                      placeholder="Select a branch"
                      searchPlaceholder="Filter branches…"
                      searchable
                      disabled={!repoRef}
                    />
                  ) : (
                    <Input
                      id="branch"
                      value={branch}
                      onChange={(event) => selectBranch(event.target.value)}
                      placeholder="main"
                      disabled={!repoRef}
                      className="font-mono text-[12.5px]"
                    />
                  )}
                </Field>

                <div className="space-y-2">
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="shrink-0 text-[13px] font-medium text-fg/90">
                      Folder
                    </span>
                    <span title={sourceDir || "repository root"} className="truncate font-mono text-[10px] text-faint">
                      {sourceDir ? sourceDir : "repository root"}
                    </span>
                  </div>
                  <FolderPicker
                    key={`${repoRef?.fullName ?? ""}:${branch}`}
                    id="source-dir"
                    owner={repoRef?.owner}
                    repo={repoRef?.repo}
                    branch={branch}
                    value={sourceDir}
                    onChange={setDir}
                  />
                </div>
              </div>

              {invalidPath ? (
                <p role="alert" className="text-[12px] text-danger">
                  Use a relative folder path inside the repository, without ..
                  or backslashes.
                </p>
              ) : null}
              <DetectionPanel
                detecting={detecting}
                detection={detection}
                error={detectError}
                path={sourceDir}
              />

              {unsupported ? (
                <p className="flex items-start gap-2 text-[12px] leading-relaxed text-danger">
                  <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  This framework needs a different target. Choose another
                  folder, or configure a static export on the next step.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-6">
              <Field
                label="Project name"
                htmlFor="project-name"
                hint="Lowercase letters, numbers and hyphens. This becomes the subdomain."
                error={
                  nameState === "invalid"
                    ? "Use lowercase letters, numbers and single hyphens only."
                    : nameState === "taken"
                      ? "That subdomain is already in use."
                      : nameState === "error"
                        ? "Could not check availability. Edit the name to retry, or leave it empty for an automatic name."
                        : undefined
                }
                action={
                  name && slugPattern.test(name) ? (
                    <span
                      className={cn(
                        "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em]",
                        nameState === "available" && "text-mint",
                        nameState === "taken" && "text-danger",
                        nameState === "checking" && "text-faint",
                        nameState === "invalid" && "text-danger",
                      )}
                    >
                      {nameState === "checking" ? (
                        <>
                          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                          checking
                        </>
                      ) : nameState === "available" ? (
                        <>
                          <Check className="h-2.5 w-2.5" /> available
                        </>
                      ) : nameState === "taken" ? (
                        <>
                          <X className="h-2.5 w-2.5" /> taken
                        </>
                      ) : null}
                    </span>
                  ) : undefined
                }
              >
                <SuffixInput
                  id="project-name"
                  maxLength={40}
                  value={name}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(
                      event.target.value.toLowerCase().replace(/\s+/g, "-"),
                    );
                  }}
                  placeholder={
                    repoRef
                      ? repoRef.repo.toLowerCase().replace(/[^a-z0-9]+/g, "-")
                      : "my-project"
                  }
                  invalid={nameState === "invalid" || nameState === "taken"}
                  suffix={`.${APP_DOMAIN}`}
                />
              </Field>

              <Field
                label="Deployment target"
                htmlFor="deployment-target"
                hint="Detect Next.js, Node.js servers such as Express and Hono, or static frontend builds."
              >
                <select
                  id="deployment-target"
                  value={target}
                  onChange={(event) =>
                    setTarget(event.target.value as typeof target)
                  }
                  className="h-10 w-full rounded-lg border border-white/[0.09] bg-panel px-3 text-[13px] text-fg"
                >
                  <option value="auto">Automatic</option>
                  <option value="nextjs-web">
                    Next.js: native Web Function
                  </option>
                  <option value="nodejs-web">Node.js server: Express / Hono / Fastify</option>
                  <option value="static">Static website / static export</option>
                </select>
              </Field>

              <label className="flex items-start gap-3 rounded-lg border border-white/[0.09] p-4 text-[13px] text-dim">
                <input type="checkbox" checked={autoDeploy && detection?.autoDeployAvailable !== false} disabled={detection?.autoDeployAvailable === false} onChange={event => setAutoDeploy(event.target.checked)} className="mt-0.5 accent-accent" />
                <span>Deploy pushes to this branch automatically.<span className="mt-1 block text-[12px] text-faint">Changes in this folder, shared packages and root lockfiles trigger a build. Failed builds keep the last working site live.</span></span>
              </label>
              {autoDeploy && detection?.autoDeployAvailable !== false ? (
                <Field label="Additional watched paths" htmlFor="watch-paths" hint="Optional repository paths, separated by commas. Shared packages and root lockfiles are already included.">
                  <Input id="watch-paths" value={watchPaths} onChange={event => setWatchPaths(event.target.value)} placeholder="shared, config/site.json" />
                </Field>
              ) : null}
              {unsupported ? (
                <p role="alert" className="text-[12px] text-warn">
                  This framework needs a static export. Choose the static target
                  and its export command, or go back and select another app.
                </p>
              ) : null}
              <div className="rounded-lg border border-white/[0.08]">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3.5 py-2.5">
                  <div>
                    <p className="text-[12.5px] text-fg">Build settings</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {detection && detection.supported !== "NO"
                        ? "Filled from the detected framework."
                        : "No framework detected. Set these yourself."}
                    </p>
                  </div>
                  {detection && detection.supported !== "NO" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setInstallCommand(detection.installCommand ?? "");
                        setBuildCommand(detection.buildCommand ?? "");
                        setStartCommand(detection.startCommand ?? "");
                        setOutputDir(detection.outputDir ?? "");
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/[0.1] px-2 py-1 font-mono text-[10px] text-faint hover:text-fg"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      reset
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-3 p-3.5 sm:grid-cols-2">
                  <Field label="Install command" htmlFor="install">
                    <Input
                      id="install"
                      value={installCommand}
                      onChange={(event) =>
                        setInstallCommand(event.target.value)
                      }
                      placeholder="npm install"
                      className="font-mono text-[12px]"
                    />
                  </Field>
                  <Field label="Build command" htmlFor="build">
                    <Input
                      id="build"
                      value={buildCommand}
                      onChange={(event) => setBuildCommand(event.target.value)}
                      placeholder="npm run build"
                      className="font-mono text-[12px]"
                    />
                  </Field>
                  <Field label="Output directory" htmlFor="output">
                    <Input
                      id="output"
                      value={outputDir}
                      onChange={(event) => setOutputDir(event.target.value)}
                      placeholder={
                        detection?.framework === "Next.js" &&
                        target !== "static"
                          ? "Managed Next.js standalone build"
                          : "Optional for Node servers; dist for static builds"
                      }
                      className="font-mono text-[12px]"
                    />
                  </Field>
                  <Field label="Node start command" htmlFor="start" hint="For Node server apps. Next.js starts automatically; static sites need no server.">
                    <Input id="start" value={startCommand} onChange={event => setStartCommand(event.target.value)} placeholder="node dist/server.js" className="font-mono text-[12px]" />
                  </Field>
                  <Field label="Source folder" htmlFor="source-summary">
                    <Input
                      id="source-summary"
                      value={sourceDir || "/"}
                      readOnly
                      className="font-mono text-[12px] text-dim"
                    />
                  </Field>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setAdvanced((state) => !state)}
                  aria-expanded={advanced}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
                >
                  <span className="text-[12.5px] text-fg">
                    Environment variables
                    <span className="ml-2 font-mono text-[10px] text-faint">
                      {envVars.length}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-faint transition-transform duration-200",
                      advanced && "rotate-180",
                    )}
                  />
                </button>

                {advanced ? (
                  <div className="space-y-2 border-t border-white/[0.07] p-3.5">
                    {envVars.length === 0 ? (
                      <p className="py-1 text-[11.5px] text-faint">
                        Nothing set. Add values needed by the build or the
                        supported server runtime.
                      </p>
                    ) : (
                      envVars.map((item, index) => (
                        <div key={index} className="flex gap-2">
                          <Input
                            value={item.key}
                            onChange={(event) => {
                              const next = [...envVars];
                              next[index] = {
                                ...item,
                                key: event.target.value,
                              };
                              setEnvVars(next);
                            }}
                            placeholder="NEXT_PUBLIC_API_URL"
                            aria-label={`Variable ${index + 1} name`}
                            className="font-mono text-[12px]"
                          />
                          <Input
                            value={item.value}
                            type={showEnvValues ? "text" : "password"}
                            autoComplete="off"
                            onChange={(event) => {
                              const next = [...envVars];
                              next[index] = {
                                ...item,
                                value: event.target.value,
                              };
                              setEnvVars(next);
                            }}
                            placeholder="value"
                            aria-label={`Variable ${index + 1} value`}
                            className="font-mono text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setEnvVars(
                                envVars.filter(
                                  (_, position) => position !== index,
                                ),
                              )
                            }
                            aria-label={`Remove variable ${index + 1}`}
                            className="grid h-10 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.09] text-faint transition-colors hover:border-danger/30 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAdvanced(true);
                        setEnvVars([...envVars, { key: "", value: "" }]);
                      }}
                      className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2 py-1 text-[11px] text-dim transition-colors hover:border-white/25 hover:text-fg"
                    >
                      <Plus className="h-3 w-3" />
                      Add variable
                    </button>
                    {envVars.length ? (
                      <button
                        type="button"
                        className="ml-3 text-[12px] text-dim underline"
                        onClick={() => setShowEnvValues((value) => !value)}
                      >
                        {showEnvValues ? "Hide values" : "Show values"}
                      </button>
                    ) : null}
                    {envError ? (
                      <p role="alert" className="text-[12px] text-danger">
                        {envError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="accent">
                  <Sparkles className="h-2.5 w-2.5" />
                  {detection?.framework || "custom build"}
                </Pill>
                {detection?.supported === "PARTIAL" ? (
                  <Pill tone="warn">warnings</Pill>
                ) : null}
                <Pill>{mode === "mine" ? "github repo" : "public url"}</Pill>
              </div>

              <div className="rounded-lg border border-white/[0.08] px-3.5 py-1">
                <SummaryRow label="Repository" value={repoRef?.fullName} />
                <SummaryRow label="Branch" value={branch} />
                <SummaryRow
                  label="Target"
                  value={
                    target === "auto"
                      ? detection?.framework || "Automatic"
                      : target === "static"
                        ? "Static website"
                        : target === "nodejs-web" ? "Node.js Web Function" : "Next.js Web Function"
                  }
                />
                <SummaryRow label="Folder" value={sourceDir || "/"} />
                <SummaryRow
                  label="Domain"
                  value={
                    name ? `${name}.${APP_DOMAIN}` : "generated at deploy time"
                  }
                />
                <SummaryRow
                  label="Install"
                  value={installCommand || "default"}
                />
                <SummaryRow label="Build" value={buildCommand || "default"} />
                <SummaryRow label="Output" value={outputDir || "default"} />
                <SummaryRow
                  label="Environment"
                  value={envVars.filter((item) => item.key).length || "none"}
                />
              </div>

              <p className="text-[12px] leading-relaxed text-faint">
                Deploying creates a build task immediately. The previous
                deployment keeps serving until this one succeeds. Nothing is
                overwritten on a failure.
              </p>

              {submitError ? (
                <p
                  role="alert"
                  className="rounded-md border border-danger/25 bg-danger/[0.07] px-3 py-2 text-[12px] text-danger"
                >
                  {submitError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] bg-black/20 px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || deploying}
            className="inline-flex items-center gap-1.5 text-[12px] text-faint transition-colors hover:text-fg disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-faint sm:block">
              step {step + 1} / {steps.length}
            </span>
            {step < 2 ? (
              <Button
                size="md"
                onClick={() => setStep((current) => current + 1)}
                disabled={
                  (step === 0 && (!sourceValid || detecting)) ||
                  (step === 1 && !canDeploy)
                }
              >
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="md"
                onClick={() => void deploy()}
                loading={deploying}
                disabled={!canDeploy || deploying}
              >
                Deploy project
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LaunchPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <LaunchBody />
      </AppShell>
    </ProtectedRoute>
  );
}
