"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/site/logo";
import { clearSession, consumeDestination, userFromToken } from "@/lib/session";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState("Finishing sign in…");
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const token = params.get("token");
    if (!token) {
      router.replace("/login?error=No%20token%20received");
      return;
    }

    try {
      const user = userFromToken(token);
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
      setMessage("Opening your workspace…");
      window.history.replaceState(null, "", "/auth/callback");
      window.location.replace(consumeDestination());
    } catch {
      clearSession();
      setMessage("That sign-in link was not valid.");
      router.replace("/login?error=Callback%20failed");
    }
  }, [params, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-ink px-6">
      <div className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-panel p-8 text-center">
        <div className="flex justify-center">
          <Logo href="/" showBeta={false} />
        </div>
        <div className="mt-8 flex items-center justify-center gap-3 text-[13px] text-dim">
          <span className="h-4 w-4 animate-spin rounded-full border border-white/25 border-t-transparent" />
          {message}
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          GitHub OAuth
        </p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-ink">
          <span className="h-5 w-5 animate-spin rounded-full border border-white/25 border-t-transparent" />
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
