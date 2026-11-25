"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sys } from "@/lib/db";
import { processOutbox, requeue } from "@/lib/outbox";
import { requirePlatformAdmin } from "@/lib/viewer";

const done = (path: string, msg?: string): never => {
  revalidatePath("/", "layout");
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : path);
};

/** P2.7: амжилтгүй болсон мэдэгдлийг дахин дараалалд оруулж, шууд оролдоно. */
export async function retryOutbox(fd: FormData) {
  await requirePlatformAdmin();
  const id = String(fd.get("id") || "");
  if (/^\d+$/.test(id)) await requeue(id);
  const r = await processOutbox(20);
  done("/admin/system?tab=outbox", `Дахин оролдлоо: ${r.sent} илгээгдсэн, ${r.failed} амжилтгүй`);
}

/** P2.9: алдааны бүртгэлийг шийдвэрлэсэн гэж тэмдэглэн устгана (id-гүй бол бүгдийг). */
export async function resolveError(fd: FormData) {
  await requirePlatformAdmin();
  const id = String(fd.get("id") || "");
  if (/^\d+$/.test(id)) await sys("DELETE FROM error_log WHERE id = $1", [id]);
  else if (fd.get("all")) await sys("DELETE FROM error_log");
  done("/admin/system?tab=errors", id ? "Алдааг шийдвэрлэсэн гэж тэмдэглэлээ" : "Алдааны жагсаалтыг цэвэрлэлээ");
}

/* ---------- P2.4 Олон өргөө ---------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string, max = 300) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const uuid = (s: string) => (UUID.test(s) ? s : null);
const U = "/admin/system?tab=urguu";

export async function createUrguuAction(fd: FormData) {
  const v = await requirePlatformAdmin();
  const name = str(fd, "name", 120);
  if (!name) done(U, "Өргөөний нэрээ оруулна уу");
  const template = uuid(str(fd, "template_id"));
  const ongodFrom = uuid(str(fd, "ongod_from"));
  const { sysTx } = await import("@/lib/db");
  const { createUrguu } = await import("@/lib/urguu");
  const msg = await sysTx({ userId: v.userId, personId: v.personId }, async (q) => {
    if ((await q("SELECT 1 FROM urguu WHERE lower(name) = lower($1)", [name])).length) return "Ийм нэртэй өргөө аль хэдийн байна";
    const [t] = await q<{ id: string }>("SELECT id FROM urguu WHERE id = coalesce($1, (SELECT id FROM urguu ORDER BY created_at LIMIT 1))", [template]);
    if (!t) return "Загвар өргөө олдсонгүй";
    if (ongodFrom && !(await q("SELECT 1 FROM urguu WHERE id = $1", [ongodFrom])).length) return "Онгодын мод хуулах өргөө олдсонгүй";
    await createUrguu(q, { name, description: str(fd, "description", 500) || null, templateId: t.id, ongodFromId: ongodFrom });
    return `«${name}» өргөө үүслээ. Одоо админыг нь томилно уу`;
  });
  done(U, msg);
}

export async function saveUrguu(fd: FormData) {
  const v = await requirePlatformAdmin();
  const id = uuid(str(fd, "id"));
  const name = str(fd, "name", 120);
  if (!id || !name) done(U, "Нэрээ оруулна уу");
  const { sysTx } = await import("@/lib/db");
  await sysTx({ userId: v.userId, personId: v.personId }, (q) => q("UPDATE urguu SET name = $2, description = $3 WHERE id = $1", [id, name, str(fd, "description", 500) || null]));
  done(U, "Хадгалагдлаа");
}

/** Өргөө хаах / дахин нээх. Хаагдсан өргөөний өгөгдөл хадгалагдана, гэхдээ гишүүд нь нэвтэрч харах боломжгүй болно. */
export async function setUrguuState(fd: FormData) {
  const v = await requirePlatformAdmin();
  const id = uuid(str(fd, "id"));
  const state = str(fd, "state") === "closed" ? "closed" : "active";
  const { sysTx } = await import("@/lib/db");
  const msg = await sysTx({ userId: v.userId, personId: v.personId }, async (q) => {
    if (state === "closed") {
      const [c] = await q<{ n: number }>("SELECT count(*)::int AS n FROM urguu WHERE state = 'active' AND id <> $1", [id]);
      if (!c.n) return "Сүүлийн идэвхтэй өргөөг хаах боломжгүй";
    }
    await q("UPDATE urguu SET state = $2 WHERE id = $1", [id, state]);
    return state === "closed" ? "Өргөө хаагдлаа" : "Өргөө дахин нээгдлээ";
  });
  done(U, msg);
}

/** Өргөөнд админ томилно: бүртгэлтэй хүн бол шууд гишүүн болгоно, үгүй бол урилга илгээнэ. */
export async function assignUrguuAdmin(fd: FormData) {
  const v = await requirePlatformAdmin();
  const urguuId = uuid(str(fd, "urguu_id"));
  const email = str(fd, "email", 254).toLowerCase();
  if (!urguuId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) done(U, "Имэйл хаягаа зөв оруулна уу");
  const { createHash, randomBytes } = await import("node:crypto");
  const { sysTx } = await import("@/lib/db");
  const { sendMail, SITE_URL, escHtml } = await import("@/lib/mail");
  const token = randomBytes(32).toString("base64url");
  const r = await sysTx({ userId: v.userId, personId: v.personId }, async (q) => {
    const [u] = await q<{ name: string }>("SELECT name FROM urguu WHERE id = $1 AND state = 'active'", [urguuId]);
    if (!u) return null;
    // Админ түвшин: тохиргоо удирдах эрхтэй, системийн биш хамгийн дээд түвшин.
    const [role] = await q<{ id: string; name: string }>(
      `SELECT r.id, r.name FROM role r WHERE r.urguu_id = $1 AND NOT r.is_system
         AND EXISTS (SELECT 1 FROM permission p WHERE p.role_id = r.id AND p.key = 'settings.manage') ORDER BY r.sort LIMIT 1`, [urguuId]);
    if (!role) return { u, role: null, direct: false };
    const [pp] = await q<{ person_id: string }>("SELECT pp.person_id FROM person_private pp JOIN person p ON p.id = pp.person_id WHERE lower(pp.email) = $1 AND p.merged_into_id IS NULL", [email]);
    if (pp) {
      await q(
        `INSERT INTO membership (person_id, urguu_id, role_id, state, decided_by, decided_at) VALUES ($1,$2,$3,'approved',$4,now())
         ON CONFLICT (person_id, urguu_id) DO UPDATE SET role_id = CASE WHEN (SELECT is_system FROM role WHERE id = membership.role_id) THEN membership.role_id ELSE EXCLUDED.role_id END,
           state = 'approved', decided_by = EXCLUDED.decided_by, decided_at = now()`,
        [pp.person_id, urguuId, role.id, v.personId]);
      return { u, role, direct: true };
    }
    await q("DELETE FROM invite WHERE lower(email) = $1 AND urguu_id = $2 AND used_at IS NULL", [email, urguuId]);
    await q("INSERT INTO invite (urguu_id, email, role_id, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4, now() + interval '7 days', $5)",
      [urguuId, email, role.id, createHash("sha256").update(token).digest("hex"), v.personId]);
    return { u, role, direct: false };
  });
  if (!r) done(U, "Өргөө олдсонгүй");
  if (!r!.role) done(U, "Энэ өргөөнд «Тохиргоо удирдах» эрхтэй админ түвшин алга. Эхлээд түвшний эрхийг тохируулна уу");
  const { u, role, direct } = r!;
  if (direct) {
    await sendMail({ to: email, template: "urguu_admin", subject: `Хуягтан: ${u.name}-ийн админ боллоо`, title: `${u.name}-ийн админ`, urguuId,
      body: `Таныг «${escHtml(u.name)}» өргөөнд «${escHtml(role!.name)}» түвшнээр томиллоо. Нэвтэрсний дараа зүүн дээд буланд байрлах өргөө сэлгэх цэсээс сонгоно уу.`,
      cta: { label: "Нэвтрэх", url: `${SITE_URL}/login` } });
    done(U, `${email} хаягтай хүн «${u.name}»-ийн ${role!.name} боллоо`);
  }
  const ok = await sendMail({ to: email, template: "invite", subject: `Хуягтан: ${u.name}-ийн урилга`, title: `${u.name} таныг урьж байна`, urguuId,
    body: `Таныг «${escHtml(role!.name)}» түвшнээр урилаа. Урилга 7 хоног хүчинтэй, нэг удаа ашиглагдана.`,
    cta: { label: "Урилгыг нээх", url: `${SITE_URL}/invite/${token}` } }, { transient: true });
  done(U, ok ? `Урилга илгээгдлээ: ${email}` : "Урилга үүссэн ч имэйл илгээж чадсангүй. Имэйлийн тохиргоог шалгана уу");
}
