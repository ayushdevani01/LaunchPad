export type SessionUser = { id: string; email: string; username: string };

export function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    !!user.id &&
    typeof user.username === "string" &&
    !!user.username &&
    typeof user.email === "string"
  );
}

// The API verifies the signature. Decoding here only supplies display data and
// prevents malformed or expired callback values from creating a local session.
export function userFromToken(token: string, now = Date.now()): SessionUser {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid session");
  const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now)
    throw new Error("Expired session");
  const user = {
    id: payload.userId,
    email: payload.email,
    username: payload.username,
  };
  if (!isSessionUser(user)) throw new Error("Invalid session");
  return user;
}

export function workspaceDestination(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x1f]/.test(value)
  )
    return "/dashboard";
  const url = new URL(value, "https://launchpad.invalid");
  return url.pathname === "/dashboard" ||
    url.pathname === "/launch" ||
    /^\/project\/[^/]+$/.test(url.pathname)
    ? url.pathname + url.search
    : "/dashboard";
}

export function rememberDestination() {
  try {
    sessionStorage.setItem(
      "launchpad:return-to",
      workspaceDestination(window.location.pathname + window.location.search),
    );
  } catch {
    /* Sign-in still works when session storage is unavailable. */
  }
}

export function consumeDestination() {
  try {
    const value = sessionStorage.getItem("launchpad:return-to");
    sessionStorage.removeItem("launchpad:return-to");
    return workspaceDestination(value);
  } catch {
    return "/dashboard";
  }
}

export function clearSession() {
  try {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  } catch {
    /* Storage may be disabled. */
  }
}
