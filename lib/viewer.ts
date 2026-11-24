import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { sys, sysTx, withCtx, type DbCtx, type Q } from "./db";
import { sendMail, SITE_URL, escHtml } from "./mail";
import type { PermKey } from "./fields";

export type Viewer = {
  userId: number;
  email: string;
  userName: string | null;
  personId: string | null;
  personName: string | null;
  formCompleted: boolean;
  isPlatformAdmin: boolean;
  urguu: { id: string; name: string } | null;
  membershipState: "pending" | "approved" | "rejected" | "closed" | null;
  /** Жинхэнэ түвшин */
  realRole: { id: string; name: string } | null;
  /** Үйлчилж буй түвшин ("Түвшнээр харах" идэвхтэй бол өөр) */
  role: { id: string; name: string } | null;
  viewAs: boolean;
  canViewAs: boolean;
  perms: Set<string>;
  fields: Set<string>;
};

const superEmail = () => (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();

/** Нэвтэрсэн хэрэглэгчийг имэйлээр нь person-той холбоно. Супер админыг seed хийнэ (P1.3). */
async function linkUser(userId: number, email: string, name: string | null): Promise<string | null> {
  const lower = email.toLowerCase();
  return sysTx({ userId }, async (q) => {
    const [pp] = await q<{ person_id: string }>(
      `SELECT pp.person_id FROM person_private pp JOIN person p ON p.id = pp.person_id
       WHERE lower(pp.email) = $1 AND p.merged_into_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.person_id = pp.person_id)`,
      [lower],
    );
    let personId = pp?.person_id ?? null;
    const isSuper = !!superEmail() && lower === superEmail();
    if (!personId && isSuper) {
      const [u] = await q<{ id: string }>("SELECT id FROM urguu ORDER BY created_at LIMIT 1");
      const full = (process.env.SUPER_ADMIN_NAME || name || lower.split("@")[0]).trim().split(/\s+/);
      const given = full.pop()!;
      const [st] = await q<{ id: string }>("SELECT id FROM status WHERE active ORDER BY sort DESC LIMIT 1");
      const [p] = await q<{ id: string }>(
        "INSERT INTO person (father_name, given_name, status_id, created_urguu_id) VALUES ($1,$2,$3,$4) RETURNING id",
        [full.join(" ") || null, given, st?.id ?? null, u.id],
      );
      personId = p.id;
      await q("INSERT INTO person_private (person_id, email, email_verified) VALUES ($1,$2,true)", [personId, lower]);
    }
    if (!personId) return null;
    await q("UPDATE users SET person_id = $1, is_platform_admin = is_platform_admin OR $3 WHERE id = $2", [personId, userId, isSuper]);
    await q("UPDATE person_private SET email_verified = true WHERE person_id = $1", [personId]);
    if (isSuper) {
      // Супер админ бүх өргөөнд системийн түвшнээр батлагдсан байна.
      await q(
        `INSERT INTO membership (person_id, urguu_id, role_id, state, decided_at)
         SELECT $1, r.urguu_id, r.id, 'approved', now() FROM role r WHERE r.is_system
         ON CONFLICT (person_id, urguu_id) DO UPDATE SET role_id = EXCLUDED.role_id, state = 'approved'`,
        [personId],
      );
    } else {
      // P1.4: имэйлээ баталгаажуулсан шинэ хүсэлтийг өргөөний админуудад мэдэгдэнэ.
      const pend = await q<{ urguu_id: string }>("SELECT urguu_id FROM membership WHERE person_id = $1 AND state = 'pending'", [personId]);
      for (const m of pend) await notifyAdmins(q, m.urguu_id, personId);
    }
    return personId;
  });
}

async function notifyAdmins(q: Q, urguuId: string, personId: string) {
  const [p] = await q<{ father_name: string | null; given_name: string }>("SELECT father_name, given_name FROM person WHERE id = $1", [personId]);
  const admins = await q<{ email: string }>(
    `SELECT DISTINCT pp.email FROM membership m
       JOIN permission pm ON pm.role_id = m.role_id AND pm.key = 'member.approve'
       JOIN person_private pp ON pp.person_id = m.person_id
     WHERE m.urguu_id = $1 AND m.state = 'approved' AND pp.email IS NOT NULL`,
    [urguuId],
  );
  const nm = escHtml([p?.father_name, p?.given_name].filter(Boolean).join(" "));
  for (const a of admins)
    void sendMail({
      to: a.email,
      template: "admin_new_request",
      subject: "Хуягтан: шинэ бүртгэлийн хүсэлт",
      title: "Шинэ бүртгэлийн хүсэлт",
      body: `<b>${nm}</b> бүртгүүлэх хүсэлт илгээлээ. Батлах эсвэл татгалзана уу.`,
      cta: { label: "Хүсэлтийг харах", url: `${SITE_URL}/admin/approvals` },
    });
}

/** Нэвтэрсэн хэрэглэгч ба түүний өргөө, түвшин, эрхүүд. Хүсэлт бүрт нэг удаа тооцно. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  const userId = (session as any)?.userId as number | undefined;
  if (!userId) return null;
  const [u] = await sys<{ id: number; email: string; name: string | null; person_id: string | null; is_platform_admin: boolean }>(
    "SELECT id, email, name, person_id, is_platform_admin FROM users WHERE id = $1",
    [userId],
  );
  if (!u?.email) return null;
  let personId = u.person_id;
  if (!personId) personId = await linkUser(u.id, u.email, u.name);

  const v: Viewer = {
    userId: u.id, email: u.email, userName: u.name, personId, personName: null, formCompleted: false,
    isPlatformAdmin: u.is_platform_admin || (!!superEmail() && u.email.toLowerCase() === superEmail()),
    urguu: null, membershipState: null, realRole: null, role: null, viewAs: false, canViewAs: false,
    perms: new Set(), fields: new Set(),
  };
  if (!personId) return v;

  const [p] = await sys<{ father_name: string | null; given_name: string; form_completed_at: Date | null }>(
    "SELECT father_name, given_name, form_completed_at FROM person WHERE id = $1", [personId]);
  v.personName = p ? (p.father_name ? p.father_name[0] + "." : "") + p.given_name : null;
  v.formCompleted = !!p?.form_completed_at;

  const ms = await sys<{ urguu_id: string; urguu_name: string; state: Viewer["membershipState"]; role_id: string | null; role_name: string | null }>(
    `SELECT m.urguu_id, u.name AS urguu_name, m.state, m.role_id, r.name AS role_name
     FROM membership m JOIN urguu u ON u.id = m.urguu_id LEFT JOIN role r ON r.id = m.role_id
     WHERE m.person_id = $1 AND u.state = 'active'
     ORDER BY (m.state = 'approved') DESC, m.created_at`,
    [personId],
  );
  if (!ms.length) return v;
  const jar = await cookies();
  const want = jar.get("urguu")?.value;
  const m = ms.find((x) => x.urguu_id === want && x.state === "approved") ?? ms[0];
  v.urguu = { id: m.urguu_id, name: m.urguu_name };
  v.membershipState = m.state;
  if (m.state !== "approved" || !m.role_id) return v;
  v.realRole = v.role = { id: m.role_id, name: m.role_name || "" };

  const realPerms = (await sys<{ key: string }>("SELECT key FROM permission WHERE role_id = $1", [m.role_id])).map((r) => r.key);
  v.canViewAs = realPerms.includes("role.view_as");
  let roleId = m.role_id;
  const as = jar.get("view_as")?.value;
  if (v.canViewAs && as && as !== m.role_id) {
    const [r] = await sys<{ id: string; name: string }>("SELECT id, name FROM role WHERE id::text = $1 AND urguu_id = $2", [as, m.urguu_id]);
    if (r) {
      v.role = r;
      v.viewAs = true;
      roleId = r.id;
    }
  }
  v.perms = new Set(
    v.viewAs ? (await sys<{ key: string }>("SELECT key FROM permission WHERE role_id = $1", [roleId])).map((r) => r.key) : realPerms,
  );
  v.fields = new Set(
    (await sys<{ field_key: string }>("SELECT field_key FROM field_permission WHERE role_id = $1 AND urguu_id = $2", [roleId, m.urguu_id])).map(
      (r) => r.field_key,
    ),
  );
  return v;
});

export type Member = Viewer & { personId: string; urguu: { id: string; name: string }; role: { id: string; name: string } };

/** Батлагдсан гишүүн биш бол зохих хуудас руу чиглүүлнэ. P1.3: батлагдаагүй хэрэглэгч "Хүлээгдэж байна"-аас өөр юу ч харахгүй. */
export async function requireMember(): Promise<Member> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.personId) redirect("/register");
  if (v.membershipState !== "approved" || !v.urguu || !v.role) redirect("/pending");
  return v as Member;
}

export async function requirePerm(...keys: PermKey[]): Promise<Member> {
  const v = await requireMember();
  if (!keys.some((k) => v.perms.has(k))) redirect(v.perms.has("person.view") && !keys.includes("person.view") ? "/map" : "/me");
  return v;
}

export const can = (v: Viewer, k: PermKey) => v.perms.has(k);
export const ctxOf = (v: Viewer): DbCtx => ({ userId: v.userId, personId: v.personId, urguuId: v.urguu?.id ?? null });
/** Үзэгчийн контекстоор (RLS-тэй) DB транзакц. */
export const asViewer = <T,>(v: Viewer, fn: (q: Q) => Promise<T>) => withCtx(ctxOf(v), fn);
