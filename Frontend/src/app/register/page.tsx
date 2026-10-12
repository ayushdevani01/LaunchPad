import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { GitHubButton } from "@/components/auth/github-button";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Connect GitHub to create your LaunchPad account and choose the repositories you want to deploy."
      footer={
        <>
          Already have a workspace?{" "}
          <Link
            href="/login"
            className="text-fg underline decoration-white/25 underline-offset-4 hover:decoration-fg"
          >
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GitHubButton label="Get started with GitHub" />
        <p className="text-center text-[12px] leading-relaxed text-faint">
          Your profile comes from GitHub. You don’t need to enter a username,
          email, or password here.
        </p>
      </div>
    </AuthShell>
  );
}
