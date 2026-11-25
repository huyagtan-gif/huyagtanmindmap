import { takePending } from "@/lib/push";
import { getViewer } from "@/lib/viewer";

/** Service worker push ирэхэд нэвтэрсэн хэрэглэгчийн хүлээгдэж буй мессежийг татна. */
export async function GET() {
  const v = await getViewer();
  const messages = v?.personId ? await takePending(v.personId) : [];
  return Response.json({ messages }, { headers: { "Cache-Control": "no-store" } });
}
