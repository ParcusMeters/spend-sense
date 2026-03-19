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
      // Never try to guard the login route itself
      if (pathname === "/login") {
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
          try {
            await supabase.auth.exchangeCodeForSession(code);
          } catch {
            // ignore, we'll fall back to normal getUser below
          } finally {
            url.searchParams.delete("code");
            window.history.replaceState({}, "", url.toString());
          }
        }
      }

      const { data } = await supabase.auth.getUser();

      if (!data.user) {
        router.replace("/login");
      } else {
        setIsAuthed(true);
      }
      setChecking(false);
    }

    initAuth();
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

