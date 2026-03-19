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

      // Handle magic-link redirects
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        // 1) PKCE-style magic link (?code=...)
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
        } else if (window.location.hash.includes("access_token")) {
          // 2) Hash-based magic link (#access_token=...)
          console.log("[AuthGate] Found access_token in hash, setting session");
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");

          if (access_token && refresh_token) {
            try {
              await supabase.auth.setSession({ access_token, refresh_token });
              console.log("[AuthGate] setSession success");
            } catch (err) {
              console.error("[AuthGate] setSession error", err);
            } finally {
              // Clean up hash from URL
              window.location.hash = "";
            }
          } else {
            console.warn(
              "[AuthGate] access_token or refresh_token missing in hash params"
            );
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

