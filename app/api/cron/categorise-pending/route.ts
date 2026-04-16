import { NextRequest, NextResponse } from "next/server";
import { processPendingCategorisation } from "@/lib/categorise/process-pending";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processPendingCategorisation();
    return NextResponse.json({ status: "ok", ...result });
  } catch (error) {
    console.error("categorise-pending: failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
