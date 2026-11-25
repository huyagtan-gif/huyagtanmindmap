import { exportOwnData } from "@/lib/privacy";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** P2.8: өөрийн бүх өгөгдлийг JSON файлаар татна. */
export async function GET() {
  const v = await getViewer();
  if (!v?.personId) return new Response("Unauthorized", { status: 401 });
  const data = await exportOwnData(v.personId);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="huyagtan-minii-ugugdul-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
