import { sys } from "@/lib/db";
import { validEndpoint, vapidPublicKey } from "@/lib/push";
import { rateLimit } from "@/lib/ratelimit";
import { getViewer } from "@/lib/viewer";

/** Phase 5: энэ төхөөрөмжийн push бүртгэл (асаах / унтраах). Зөвхөн нэвтэрсэн гишүүн. */
async function who(req: Request) {
  const v = await getViewer();
  if (!v?.personId || !vapidPublicKey()) return null;
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!validEndpoint(endpoint) || !rateLimit(`push:${v.personId}`, 20)) return null;
  return { v, endpoint, ua: (req.headers.get("user-agent") || "").slice(0, 200) };
}
export async function POST(req: Request) {
  const w = await who(req);
  if (!w) return new Response(null, { status: 400 });
  await sys(
    `INSERT INTO push_subscription (person_id, endpoint, user_agent) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET person_id = EXCLUDED.person_id, user_agent = EXCLUDED.user_agent, failures = 0`, [w.v.personId, w.endpoint, w.ua]);
  return new Response(null, { status: 204 });
}
export async function DELETE(req: Request) {
  const w = await who(req);
  if (!w) return new Response(null, { status: 400 });
  await sys("DELETE FROM push_subscription WHERE endpoint = $1 AND person_id = $2", [w.endpoint, w.v.personId]);
  return new Response(null, { status: 204 });
}
