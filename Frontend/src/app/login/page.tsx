"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { GitHubButton } from "@/components/auth/github-button";

function SignIn() {
  const error = useSearchParams().get("error");
  return (
    <div className="space-y-5">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/25 bg-danger/[0.07] px-3 py-3 text-[13px] text-danger"
        >
          {error === "session-expired"
            ? "Your session expired. Continue with GitHub to sign in again."
            : "GitHub sign-in could not be completed. Please try again."}
        </p>
      ) : null}
      <GitHubButton />
      <p className="text-center text-[12px] leading-relaxed text-faint">
        LaunchPad uses GitHub for sign-in and repository access. There is no
        separate password to create.
      </p>
    </div>
  );
}
export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Continue with GitHub to open your workspace and manage deployments."
      footer={
        <>
          New to LaunchPad?{" "}
          <Link
            href="/register"
            className="text-fg underline decoration-white/25 underline-offset-4 hover:decoration-fg"
          >
            Get started
          </Link>
        </>
      }
    >
      <Suspense
        fallback={
          <div
            role="status"
            className="h-20 animate-pulse rounded-lg bg-white/[0.03]"
          >
            Loading sign-in...
          </div>
        }
      >
        <SignIn />
      </Suspense>
    </AuthShell>
  );
}
