"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { type User } from "@/lib/api";
import {
  clearSession,
  isSessionUser,
  rememberDestination,
  userFromToken,
} from "@/lib/session";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  logout: (redirectTo?: string) => void;
};
const AuthContext = React.createContext<AuthContextValue | undefined>(
  undefined,
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("user");
      const token = localStorage.getItem("token");
      if (stored && token) {
        const saved: unknown = JSON.parse(stored);
        const decoded = userFromToken(token);
        if (!isSessionUser(saved) || saved.id !== decoded.id)
          throw new Error("Invalid saved session");
        setUser(decoded);
      } else clearSession();
    } catch {
      clearSession();
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = React.useCallback(
    (redirectTo = "/") => {
      clearSession();
      setUser(null);
      router.push(redirectTo);
    },
    [router],
  );
  React.useEffect(() => {
    const expired = () => {
      rememberDestination();
      logout("/login?error=session-expired");
    };
    window.addEventListener("launchpad:unauthorized", expired);
    return () => window.removeEventListener("launchpad:unauthorized", expired);
  }, [logout]);
  const value = React.useMemo(
    () => ({ user, loading, logout }),
    [user, loading, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
