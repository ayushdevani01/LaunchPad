export const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000").trim().replace(/\/+$/, "");
export const LOGS_URL =
  process.env.NEXT_PUBLIC_LOGS_URL || "http://localhost:9002";
export const APP_DOMAIN =
  process.env.NEXT_PUBLIC_APP_DOMAIN || "launch-pad.dev";
export const UI_PREVIEW = process.env.NEXT_PUBLIC_UI_PREVIEW === "1";

export type User = {
  id: string;
  email: string;
  username: string;
};

export type Project = {
  _id: string;
  name?: string;
  slug: string;
  gitUrl: string;
  branch?: string;
  sourceDir?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
  customDomain?: string;
  createdAt: string;
  currentDeployment?: string | null;
  latestDeployment?: string | Deployment | null;
  githubRepositoryId?: number;
  githubInstallationId?: number;
  githubSignInRequired?: boolean;
  autoDeploy?: boolean;
  watchPaths?: string[];
};

export type DeploymentStatus = "PENDING" | "BUILDING" | "SUCCESS" | "FAILED";

export type Deployment = {
  _id: string;
  projectId: string;
  status: DeploymentStatus;
  createdAt: string;
  failureReason?: string;
  commitHash?: string;
  trigger?: "manual" | "push";
};

export type GitHubRepo = {
  name: string;
  fullName: string;
  gitUrl: string;
  private: boolean;
  defaultBranch: string;
};

export type Detection = {
  autoDeployAvailable?: boolean;
  framework: string;
  supported: "YES" | "PARTIAL" | "NO";
  notes?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
};

export type CreateProjectInput = {
  gitURL: string;
  project_name?: string;
  sourceDir?: string;
  branch?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
  envVars?: Record<string, string>;
  deploymentTarget?: "auto" | "static" | "nextjs-lambda";
  autoDeploy?: boolean;
  watchPaths?: string[];
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function token() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}

export function authHeaders(): Record<string, string> {
  const value = token();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

export async function fetchWithAuth(path: string, options: RequestInit = {}) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...options.headers,
      },
    });
    if (response.status === 401 && token())
      window.dispatchEvent(new Event("launchpad:unauthorized"));
    return response;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      "The API server could not be reached. Check your connection and try again.",
      0,
    );
  }
}

async function readError(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return data?.error || data?.message || fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  fallback = "Request failed",
): Promise<T> {
  const res = await fetchWithAuth(path, options);
  if (!res.ok) throw new ApiError(await readError(res, fallback), res.status);
  return res.json() as Promise<T>;
}

export const listProjects = async (signal?: AbortSignal) =>
  (
    await request<{ projects?: Project[] }>(
      "/projects",
      { signal },
      "Could not load projects",
    )
  ).projects ?? [];

export const getProject = async (slug: string, signal?: AbortSignal) =>
  (
    await request<{ project: Project }>(
      `/projects/${encodeURIComponent(slug)}`,
      { signal },
      "Could not load project",
    )
  ).project;

export const listDeployments = async (slug: string, signal?: AbortSignal) =>
  (
    await request<{ deployments?: Deployment[] }>(
      `/projects/${encodeURIComponent(slug)}/deployments`,
      { signal },
      "Could not load deployments",
    )
  ).deployments ?? [];

export const listRepos = async (signal?: AbortSignal) =>
  (
    await request<{ repos?: GitHubRepo[] }>(
      "/projects/github/repos",
      { signal },
      "Could not load repositories",
    )
  ).repos ?? [];

export const repositoryConnection = (signal?: AbortSignal) =>
  request<{ repos: GitHubRepo[]; connectionRequired?: boolean; signInRequired?: boolean }>(
    "/projects/github/repos", { signal }, "Could not load connected repositories",
  );

export const connectRepositories = (projectSlug?: string) =>
  request<{ url: string }>("/github/install/start", {
    method: "POST", body: JSON.stringify({ projectSlug }),
  }, "Could not connect repositories");

export const setAutomaticDeploys = (slug: string, autoDeploy: boolean) =>
  request<{ autoDeploy: boolean }>(`/projects/${encodeURIComponent(slug)}/automation`, {
    method: "PATCH", body: JSON.stringify({ autoDeploy }),
  }, "Could not update automatic deployments");

export const listBranches = async (
  owner: string,
  repo: string,
  signal?: AbortSignal,
) =>
  (
    await request<{ branches?: string[] }>(
      `/projects/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      { signal },
      "Could not load branches",
    )
  ).branches ?? [];

export const detectFramework = async (
  owner: string,
  repo: string,
  branch: string,
  path: string,
  signal?: AbortSignal,
) =>
  (
    await request<{ detection: Detection }>(
      `/projects/github/detect?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
      { signal },
      "Could not analyse this repository",
    )
  ).detection;

export type DirectoryEntry = {
  name: string;
  path: string;
  hasPackageJson?: boolean;
};

export type DirectoryListing = {
  path: string;
  directories: DirectoryEntry[];
  hasPackageJson: boolean;
  truncated?: boolean;
};

/**
 * Lists the folders directly below `path`. The endpoint is additive; older API
 * deployments answer 404, in which case callers fall back to a free-text path.
 */
export const listDirectories = async (
  owner: string,
  repo: string,
  branch: string,
  path = "",
  signal?: AbortSignal,
) => {
  const listing = await request<DirectoryListing>(
    `/projects/github/tree?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
    { signal },
    "Could not list folders",
  );
  if (!Array.isArray(listing.directories) || typeof listing.path !== "string")
    throw new ApiError("The API returned an incompatible folder listing. The backend needs updating.", 502);
  return listing;
};

export const checkProjectName = async (name: string, signal?: AbortSignal) =>
  request<{ available: boolean }>(
    `/projects/check-name?name=${encodeURIComponent(name)}`,
    { signal },
    "Could not check that name",
  );

export const createProject = async (input: CreateProjectInput) =>
  request<
    { data?: { projectSlug?: string; url?: string } } & Record<string, unknown>
  >(
    "/projects",
    { method: "POST", body: JSON.stringify(input) },
    "Could not start the deployment",
  );

export const redeploy = async (slug: string) =>
  request<Record<string, unknown>>(
    `/projects/${encodeURIComponent(slug)}/redeploy`,
    { method: "POST" },
    "Could not redeploy",
  );

export async function fetchDeploymentLogs(
  slug: string,
  deploymentId: string,
  signal?: AbortSignal,
) {
  const res = await fetchWithAuth(
    `/projects/${encodeURIComponent(slug)}/deployments/${encodeURIComponent(deploymentId)}/logs`,
    { signal },
  );
  if (!res.ok)
    throw new ApiError(
      await readError(res, "Could not load build logs"),
      res.status,
    );
  return res.json() as Promise<{ logs?: string; pending?: boolean }>;
}

export const projectUrl = (slug: string) =>
  UI_PREVIEW
    ? `/preview-site/${encodeURIComponent(slug)}`
    : `https://${slug}.${APP_DOMAIN}`;

export function repoPath(gitUrl: string) {
  return gitUrl
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "");
}
