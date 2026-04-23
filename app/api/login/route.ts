import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { email, password } = await request.json();

  const expectedPassword = process.env.APP_LOGIN_PASSWORD;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const normalizedAppUrl = appUrl.replace(/\/+$/, "");

  if (!expectedPassword) {
    return NextResponse.json(
      { error: "Auth is not configured on the server." },
      { status: 500 }
    );
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  if (password !== expectedPassword) {
    return NextResponse.json({ error: "Invalid invite code." }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: `${normalizedAppUrl}/`,
    },
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to send magic link." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
