import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { password } = await request.json();

  const expectedPassword = process.env.APP_LOGIN_PASSWORD;
  const loginEmail = process.env.APP_LOGIN_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!expectedPassword || !loginEmail) {
    return NextResponse.json(
      { error: "Auth is not configured on the server." },
      { status: 500 }
    );
  }

  if (password !== expectedPassword) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: loginEmail,
    options: {
      emailRedirectTo: `${appUrl}/`,
    },
  });

  if (error) {
    return NextResponse.json(
      { error: "Failed to send magic link." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

