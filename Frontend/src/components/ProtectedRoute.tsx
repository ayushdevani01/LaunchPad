"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { rememberDestination } from "@/lib/session";

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !user) {
      rememberDestination();
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink">
        <div className="flex items-center gap-3 text-[13px] text-faint">
          <span className="h-4 w-4 animate-spin rounded-full border border-white/25 border-t-transparent" />
          Loading workspace
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
