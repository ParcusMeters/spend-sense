"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [checking, setChecking] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    async function initAuth() {
      console.log("[AuthGate] initAuth, pathname:", pathname);

      // Never try to guard the login route itself
      if (pathname === "/login") {
        console.log("[AuthGate] On /login, skipping auth check");
        setChecking(false);
        setIsAuthed(false);
        return;
      }

      const supabase = createClient();

      // Handle magic-link redirect: exchange code in URL for a session
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          console.log("[AuthGate] Found code in URL, exchanging for session");
          try {
            await supabase.auth.exchangeCodeForSession(code);
            console.log("[AuthGate] exchangeCodeForSession success");
          } catch (err) {
            console.error("[AuthGate] exchangeCodeForSession error", err);
          } finally {
            url.searchParams.delete("code");
            window.history.replaceState({}, "", url.toString());
          }
        }
      }

      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error("[AuthGate] getUser error", error);
      } else {
        console.log(
          "[AuthGate] getUser result",
          data?.user ? "has user" : "no user"
        );
      }

      if (!data.user) {
        console.log("[AuthGate] No user, redirecting to /login");
        router.replace("/login");
      } else {
        console.log("[AuthGate] User present, allowing access");
        setIsAuthed(true);
      }
      setChecking(false);
    }

    void initAuth();
  }, [router, pathname]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!isAuthed) {
    // We are redirecting; render nothing to avoid flicker
    return null;
  }

  return <>{children}</>;
}

