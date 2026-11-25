"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sys, sysTx } from "@/lib/db";
import { deliverMail, sendMail, SITE_URL, escHtml } from "@/lib/mail";
import { erasePerson } from "@/lib/privacy";
import { rateLimit } from "@/lib/ratelimit";
import { asViewer, requireMember, requirePerm } from "@/lib/viewer";

const done = (path: string): never => {
  revalidatePath("/", "layout");
  redirect(path);
};

/** P2.8: гишүүн өөрийн бүртгэл, өгөгдлийг устгуулах хүсэлт гаргана. Өргөөний админ батална. */
export async function requestDeletion(fd: FormData) {
  const v = await requireMember();
  if (v.isPlatformAdmin) done("/me?d=super#data");
  if (!fd.get("confirm")) done("/me?d=confirm#data");
  if (!rateLimit(`del:${v.personId}`, 3, 60 * 60_000)) done("/me?d=rate#data");
  const note = String(fd.get("note") || "").trim().slice(0, 1000) || null;
  const created = await sysTx({ userId: v.userId, personId: v.personId, urguuId: v.urguu.id }, async (q) =>
    (await q("INSERT INTO data_request (person_id, urguu_id, note) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id", [v.personId, v.urguu.id, note])).length > 0);
  if (created) {
    const admins = await sys<{ email: string }>(
      `SELECT DISTINCT pp.email FROM membership m JOIN permission pm ON pm.role_id = m.role_id AND pm.key = 'data.request'
         JOIN person_private pp ON pp.person_id = m.person_id
       WHERE m.urguu_id = $1 AND m.state = 'approved' AND pp.email IS NOT NULL AND m.person_id <> $2`, [v.urguu.id, v.personId]);
    for (const a of admins)
      void sendMail({ to: a.email, template: "data_request", urguuId: v.urguu.id, subject: "Хуягтан: өгөгдлөө устгуулах хүсэлт", title: "Өгөгдлөө устгуулах хүсэлт",
        body: `<b>${escHtml(v.personName || "Гишүүн")}</b> өөрийн бүртгэл, өгөгдлийг устгуулах хүсэлт гаргалаа. Шийдвэрлэнэ үү.`,
        cta: { label: "Хүсэлтийг харах", url: `${SITE_URL}/admin/approvals` } });
  }
  done("/me?d=sent#data");
}

export async function cancelDeletion() {
  const v = await requireMember();
  await sysTx({ userId: v.userId, personId: v.personId }, (q) => q("UPDATE data_request SET state = 'cancelled', decided_at = now() WHERE person_id = $1 AND state = 'pending'", [v.personId]));
  done("/me?d=cancelled#data");
}

/** Админ устгах хүсэлтийг шийдвэрлэнэ. Баталбал хүний бүх өгөгдөл платформоос бүрмөсөн устна (буцаах боломжгүй). */
export async function decideDeletion(fd: FormData) {
  const v = await requirePerm("data.request");
  const id = String(fd.get("id") || "");
  const decision = String(fd.get("decision") || "");
  const approve = decision === "approve";
  const back = (m: string): never => done(`/admin/approvals?m=${encodeURIComponent(m)}`);
  if (!approve && decision !== "reject") back("Шийдвэр тодорхойгүй байна. Дахин оролдоно уу");
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("Хүсэлт олдсонгүй");
  // Хүсэлт энэ өргөөнийх мөн эсэхийг RLS-тэй контекстоор шалгана.
  const [req] = await asViewer(v, (q) => q<{ id: string; person_id: string | null }>("SELECT id, person_id FROM data_request WHERE id = $1 AND urguu_id = app_urguu() AND state = 'pending'", [id]));
  if (!req?.person_id) back("Хүсэлт олдсонгүй эсвэл аль хэдийн шийдвэрлэгдсэн");
  const pid = req.person_id!;
  if (!approve) {
    await asViewer(v, (q) => q("UPDATE data_request SET state = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1", [id, v.personId]));
    const [pp] = await sys<{ email: string | null }>("SELECT email FROM person_private WHERE person_id = $1", [pid]);
    if (pp?.email)
      void sendMail({ to: pp.email, template: "data_request_rejected", urguuId: v.urguu.id, subject: "Хуягтан: устгах хүсэлтийн хариу", title: "Хүсэлт батлагдсангүй",
        body: `${escHtml(v.urguu.name)}-ийн админ таны өгөгдлөө устгуулах хүсэлтийг батлаагүй байна. Тодруулах зүйл байвал өргөөний админтай холбогдоно уу.` });
    back("Хүсэлтийг татгалзлаа");
  }
  if (pid === v.personId) back("Өөрийн хүсэлтийг өөрөө батлах боломжгүй. Өөр админ шийдвэрлэнэ");
  const [chk] = await sys<{ is_super: boolean; others: number }>(
    `SELECT EXISTS (SELECT 1 FROM users u WHERE u.person_id = $1 AND u.is_platform_admin) AS is_super,
            (SELECT count(*)::int FROM membership m JOIN urguu u ON u.id = m.urguu_id WHERE m.person_id = $1 AND m.urguu_id <> $2 AND m.state = 'approved' AND u.state = 'active') AS others`,
    [pid, v.urguu.id]);
  if (chk.is_super) back("Платформын супер админыг энэ замаар устгах боломжгүй");
  if (chk.others && !(v.isPlatformAdmin && !v.viewAs)) back("Энэ хүн өөр өргөөнд ч гишүүн тул зөвхөн платформын супер админ батална");
  const { email } = await sysTx({ userId: v.userId, personId: v.personId, urguuId: v.urguu.id }, async (q) => {
    const r = await erasePerson(q, pid);
    await q("UPDATE data_request SET state = 'approved', decided_by = $2, decided_at = now(), note = NULL WHERE id = $1", [id, v.personId]);
    return r;
  });
  // Баталгаажуулах захидал: хаяг нь дахин хадгалагдахгүйн тулд outbox-оор дамжуулахгүй шууд илгээнэ.
  if (email)
    await deliverMail(email, { subject: "Хуягтан: таны өгөгдөл устгагдлаа", title: "Таны өгөгдөл устгагдлаа",
      body: "Таны хүсэлтийн дагуу Хуягтан систем дэх таны бүртгэл болон хувийн мэдээллийг устгалаа. Шифрлэгдсэн нөөц хуулбарт 30 хүртэл хоног үлдээд автоматаар устна." }).catch((e) => console.error("[privacy] баталгаажуулах захидал илгээж чадсангүй:", e instanceof Error ? e.message : e));
  back("Хүний өгөгдөл бүрмөсөн устгагдлаа");
}
