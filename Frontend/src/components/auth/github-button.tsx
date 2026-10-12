"use client";

import { API_BASE, UI_PREVIEW } from "@/lib/api";
import { buttonStyles } from "@/components/ui/button";
import { Github } from "lucide-react";

export function GitHubButton({
  label = "Continue with GitHub",
}: {
  label?: string;
}) {
  return (
    <a
      href={`${API_BASE}/auth/github`}
      className={buttonStyles("primary", "lg", "w-full")}
      data-testid="github-login"
    >
      <Github className="h-4 w-4" />
      {UI_PREVIEW ? "Enter preview workspace" : label}
    </a>
  );
}
