export function validSourcePath(path: string) {
  return (
    path.length <= 1000 &&
    !path.startsWith("/") &&
    !/[\\\x00-\x1f]/.test(path) &&
    !path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

export function environmentIssue(rows: { key: string; value: string }[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key && row.value)
      return "Give every environment value a variable name.";
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      return "Variable names must start with a letter or underscore and contain only letters, numbers, or underscores.";
    if (keys.has(key)) return `The variable ${key} is listed more than once.`;
    keys.add(key);
  }
  return "";
}
