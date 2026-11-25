import { sys } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sys("SELECT 1");
    return Response.json({ ok: true, build: process.env.NEXT_PUBLIC_BUILD_SHA || "local" });
  } catch {
    return Response.json({ ok: false, error: "db" }, { status: 503 });
  }
}
