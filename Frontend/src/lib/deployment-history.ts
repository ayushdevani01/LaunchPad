/** Keep a user's current selection, otherwise honor a link to a specific build. */
export function selectDeployment(
  deployments: { _id: string }[],
  current: string | null,
  requested: string | null,
  latest = false,
): string | null {
  if (!latest) {
    if (deployments.some(item => item._id === current)) return current;
    if (deployments.some(item => item._id === requested)) return requested;
  }
  return deployments[0]?._id ?? null;
}
