"use server";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asViewer, requirePerm } from "@/lib/viewer";
import { FIELD_KEYS, PERMISSIONS, VIEWS } from "@/lib/fields";
import { runImport } from "@/lib/import";
import { sendMail, SITE_URL, escHtml } from "@/lib/mail";
import { mergePersons, UUID } from "@/lib/people-write";

const str = (fd: FormData, k: string, max = 2000) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const orNull = (s: string) => (s ? s : null);
const uuid = (s: string) => (UUID.test(s) ? s : null);
const int = (s: string, d = 0) => (Number.isFinite(parseInt(s, 10)) ? parseInt(s, 10) : d);
const done = (path: string, msg?: string): never => {
  revalidatePath("/", "layout");
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : path);
};

/* ---------- P1.4 Бүртгэл батлах / татгалзах ---------- */
export async function decideMembership(fd: FormData) {
  const v = await requirePerm("member.approve");
  const id = uuid(str(fd, "membership_id"));
  const approve = str(fd, "decision") === "approve";
  const roleId = uuid(str(fd, "role_id"));
  if (!id) done("/admin/approvals");
  const row = await asViewer(v, async (q) => {
    const [m] = await q<{ person_id: string }>(
      `UPDATE membership SET state = $2, role_id = coalesce((SELECT r.id FROM role r WHERE r.id = $3 AND NOT r.is_system), role_id), decided_by = $4, decided_at = now()
       WHERE id = $1 AND state = 'pending' RETURNING person_id`,
      [id, approve ? "approved" : "rejected", roleId, v.personId],
    );
    if (!m) return null;
    const [pp] = await q<{ email: string | null }>("SELECT email FROM person_private WHERE person_id = $1", [m.person_id]);
    return pp;
  });
  if (row?.email)
    await sendMail(
      approve
        ? { to: row.email, template: "membership_approved", subject: "Хуягтан: таны бүртгэл батлагдлаа", title: "Бүртгэл батлагдлаа",
            body: `${escHtml(v.urguu.name)}-ийн админ таны хүсэлтийг баталлаа. Одоо нэвтэрч бүртгэлийн формоо бөглөнө үү.`, cta: { label: "Нэвтрэх", url: `${SITE_URL}/login` } }
        : { to: row.email, template: "membership_rejected", subject: "Хуягтан: бүртгэлийн хүсэлтийн хариу", title: "Хүсэлт батлагдсангүй",
            body: `${escHtml(v.urguu.name)}-ийн админ таны бүртгэлийн хүсэлтийг батлаагүй байна. Асуух зүйл байвал өргөөний админтай холбогдоно уу.` },
    );
  done("/admin/approvals", row ? (approve ? "Батлагдлаа" : "Татгалзлаа") : undefined);
}

/* ---------- P1.5 Урилга ---------- */
export async function sendInvite(fd: FormData) {
  const v = await requirePerm("invite.send");
  const email = str(fd, "email", 254).toLowerCase();
  const roleId = uuid(str(fd, "role_id"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roleId) done("/admin/approvals", "Имэйл, түвшнээ зөв оруулна уу");
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const role = await asViewer(v, async (q) => {
    // Системийн түвшин (Супер админ)-г урилгаар олгохгүй.
    const [r] = await q<{ name: string }>("SELECT name FROM role WHERE id = $1 AND NOT is_system", [roleId]);
    if (!r) return null;
    await q("DELETE FROM invite WHERE lower(email) = $1 AND used_at IS NULL", [email]);
    await q("INSERT INTO invite (urguu_id, email, role_id, token_hash, expires_at, created_by) VALUES (app_urguu(), $1, $2, $3, now() + interval '7 days', $4)", [email, roleId, hash, v.personId]);
    return r;
  });
  if (!role) done("/admin/approvals", "Түвшин олдсонгүй");
  const ok = await sendMail({
    to: email, template: "invite", subject: `Хуягтан: ${v.urguu.name}-ийн урилга`, title: `${v.urguu.name} таныг урьж байна`,
    body: `Таныг «${escHtml(role!.name)}» түвшнээр урилаа. Урилга 7 хоног хүчинтэй, нэг удаа ашиглагдана.`,
    cta: { label: "Урилгыг нээх", url: `${SITE_URL}/invite/${token}` }, urguuId: v.urguu.id,
  }, { transient: true }); // нууц токентой тул агуулга outbox-д хадгалагдахгүй
  done("/admin/approvals", ok ? `Урилга илгээгдлээ: ${email}` : "Урилга үүссэн ч имэйл илгээж чадсангүй. Имэйлийн тохиргоог шалгана уу");
}

export async function revokeInvite(fd: FormData) {
  const v = await requirePerm("invite.send");
  await asViewer(v, (q) => q("DELETE FROM invite WHERE id = $1 AND used_at IS NULL", [uuid(str(fd, "id"))]));
  done("/admin/approvals", "Урилга цуцлагдлаа");
}

/** Гишүүний түвшин солих / гишүүнчлэл хаах. */
export async function setMemberRole(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const personId = uuid(str(fd, "person_id"));
  const roleId = uuid(str(fd, "role_id"));
  if (personId === v.personId) done("/admin/settings?tab=members", "Өөрийн түвшнийг өөрөө солих боломжгүй");
  await asViewer(v, async (q) => {
    // Системийн түвшинг зөвхөн системийн түвшинтэй хүн олгож/авч чадна.
    const [mine] = await q<{ is_system: boolean }>("SELECT r.is_system FROM role r WHERE r.id = $1", [v.realRole!.id]);
    await q(
      `UPDATE membership m SET role_id = $2 FROM role nr, role cur
       WHERE m.person_id = $1 AND m.urguu_id = app_urguu() AND nr.id = $2 AND cur.id = m.role_id AND ($3 OR (NOT nr.is_system AND NOT cur.is_system))`,
      [personId, roleId, !!mine?.is_system],
    );
  });
  done("/admin/settings?tab=members", "Хадгалагдлаа");
}

/* ---------- P1.14 Жагсаалтууд (D44) ---------- */
const LISTS: Record<string, { extra: string[] }> = {
  status: { extra: ["pal", "shape", "description"] },
  knowledge_level: { extra: [] },
  huyag_type: { extra: [] },
  era: { extra: ["color"] },
  relation_type: { extra: [] },
  deedes: { extra: ["description"] },
  event_type: { extra: [] },
  event_role: { extra: [] },
};
const listVals = (fd: FormData, table: string) => {
  const cols: Record<string, unknown> = { name: str(fd, "name", 120), sort: int(str(fd, "sort")), active: fd.get("active") === "on" || fd.get("active") === "true" };
  for (const e of LISTS[table].extra) cols[e] = e === "pal" ? Math.min(6, Math.max(0, int(str(fd, "pal")))) : orNull(str(fd, e, 300));
  return cols;
};

export async function saveListItem(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const table = str(fd, "table");
  const back = `/admin/settings?tab=${str(fd, "tab", 20) || "lists"}`;
  if (!LISTS[table]) done(back);
  const id = uuid(str(fd, "id"));
  const cols = listVals(fd, table);
  if (!cols.name) done(back, "Нэрээ оруулна уу");
  const keys = Object.keys(cols);
  await asViewer(v, async (q) => {
    if (id) await q(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...keys.map((k) => cols[k])]);
    else {
      if (!fd.has("active")) cols.active = true;
      const [r] = await q<{ id: string }>(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, keys.map((k) => cols[k]));
      if (table === "deedes") await q("INSERT INTO urguu_deedes (urguu_id, deedes_id) VALUES (app_urguu(), $1)", [r.id]);
    }
  });
  done(back, "Хадгалагдлаа");
}

export async function deleteListItem(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const table = str(fd, "table");
  const back = `/admin/settings?tab=${str(fd, "tab", 20) || "lists"}`;
  const id = uuid(str(fd, "id"));
  if (!LISTS[table] || !id) done(back);
  let msg = "Устгагдлаа";
  try {
    await asViewer(v, (q) => q(`DELETE FROM ${table} WHERE id = $1`, [id]));
  } catch (e: any) {
    if (e?.code !== "23503") throw e;
    // Ашиглагдаж байгаа бол устгахгүй, идэвхгүй болгоно.
    await asViewer(v, (q) => q(`UPDATE ${table} SET active = false WHERE id = $1`, [id]));
    msg = "Ашиглагдаж байгаа тул устгасангүй, идэвхгүй болголоо";
  }
  done(back, msg);
}

/* ---------- Түвшин, эрх, талбарын эрх ---------- */
export async function saveRole(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const id = uuid(str(fd, "id"));
  const name = str(fd, "name", 60);
  if (!name) done("/admin/settings?tab=roles", "Нэрээ оруулна уу");
  await asViewer(v, async (q) => {
    if (id) await q("UPDATE role SET name = $2, sort = $3 WHERE id = $1", [id, name, int(str(fd, "sort"))]);
    else {
      const [r] = await q<{ id: string }>("INSERT INTO role (urguu_id, name, sort) VALUES (app_urguu(), $1, $2) RETURNING id", [name, int(str(fd, "sort"), 99)]);
      await q("INSERT INTO permission (role_id, urguu_id, key) VALUES ($1, app_urguu(), 'person.view')", [r.id]);
      await q("INSERT INTO role_view (role_id, urguu_id, view) SELECT $1, app_urguu(), v FROM unnest($2::text[]) AS v", [r.id, VIEWS.map((x) => x.key)]);
    }
  });
  done("/admin/settings?tab=roles", "Хадгалагдлаа");
}

export async function deleteRole(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const id = uuid(str(fd, "id"));
  let msg = "Устгагдлаа";
  try {
    const n = await asViewer(v, async (q) => (await q("DELETE FROM role WHERE id = $1 AND NOT is_system RETURNING id", [id])).length);
    if (!n) msg = "Системийн түвшинг устгах боломжгүй";
  } catch (e: any) {
    if (e?.code !== "23503") throw e;
    msg = "Энэ түвшинд хүн эсвэл урилга байгаа тул устгах боломжгүй";
  }
  done("/admin/settings?tab=roles", msg);
}

export async function savePermissions(fd: FormData) {
  const v = await requirePerm("settings.manage");
  await asViewer(v, async (q) => {
    const roles = await q<{ id: string; is_system: boolean }>("SELECT id, is_system FROM role");
    for (const r of roles) {
      if (r.is_system) continue; // Супер админ үргэлж бүх эрхтэй
      const want = PERMISSIONS.map((p) => p.key).filter((k) => fd.get(`p:${r.id}:${k}`) === "on");
      await q("DELETE FROM permission WHERE role_id = $1 AND NOT (key = ANY($2))", [r.id, want]);
      for (const k of want) await q("INSERT INTO permission (role_id, urguu_id, key) VALUES ($1, app_urguu(), $2) ON CONFLICT DO NOTHING", [r.id, k]);
    }
  });
  done("/admin/settings?tab=roles", "Эрх хадгалагдлаа");
}

/** P2.2: түвшин бүрт зөвшөөрөх mind map харагдацууд (role_view). */
export async function saveRoleViews(fd: FormData) {
  const v = await requirePerm("settings.manage");
  await asViewer(v, async (q) => {
    const roles = await q<{ id: string; is_system: boolean }>("SELECT id, is_system FROM role");
    for (const r of roles) {
      // Супер админ бүх харагдацыг үргэлж харна
      const want = VIEWS.map((x) => x.key as string).filter((k) => r.is_system || fd.get(`v:${r.id}:${k}`) === "on");
      await q("DELETE FROM role_view WHERE role_id = $1 AND NOT (view = ANY($2))", [r.id, want]);
      for (const k of want) await q("INSERT INTO role_view (role_id, urguu_id, view) VALUES ($1, app_urguu(), $2) ON CONFLICT DO NOTHING", [r.id, k]);
    }
  });
  done("/admin/settings?tab=roles", "Харагдацын эрх хадгалагдлаа");
}

export async function saveFieldPermissions(fd: FormData) {
  const v = await requirePerm("settings.manage");
  await asViewer(v, async (q) => {
    const roles = await q<{ id: string; is_system: boolean }>("SELECT id, is_system FROM role");
    for (const f of FIELD_KEYS) {
      // Супер админ үргэлж бүгдийг харна
      const want = roles.filter((r) => r.is_system || fd.get(`f:${f.key}:${r.id}`) === "on").map((r) => r.id);
      await q("DELETE FROM field_permission WHERE field_key = $1 AND NOT (role_id = ANY($2::uuid[]))", [f.key, want]);
      for (const r of want) await q("INSERT INTO field_permission (urguu_id, field_key, role_id) VALUES (app_urguu(), $1, $2) ON CONFLICT DO NOTHING", [f.key, r]);
    }
  });
  done("/admin/settings?tab=fields", "Талбарын эрх хадгалагдлаа");
}

/* ---------- Формын нэмэлт асуулт ---------- */
export async function saveQuestion(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const id = uuid(str(fd, "id"));
  const text = str(fd, "text", 300);
  const type = ["text", "longtext", "yesno", "choice", "date"].includes(str(fd, "type")) ? str(fd, "type") : "text";
  const options = str(fd, "options", 1000).split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!text) done("/admin/settings?tab=questions", "Асуултаа оруулна уу");
  const vals = [text, type, type === "choice" ? JSON.stringify(options) : null, fd.get("required") === "on", int(str(fd, "sort")), id ? fd.get("active") === "on" : true];
  await asViewer(v, (q) =>
    id
      ? q("UPDATE form_question SET text=$2, type=$3, options=$4, required=$5, sort=$6, active=$7 WHERE id=$1 AND urguu_id = app_urguu()", [id, ...vals])
      : q("INSERT INTO form_question (urguu_id, text, type, options, required, sort, active) VALUES (app_urguu(), $1,$2,$3,$4,$5,$6)", vals),
  );
  done("/admin/settings?tab=questions", "Хадгалагдлаа");
}

export async function deleteQuestion(fd: FormData) {
  const v = await requirePerm("settings.manage");
  await asViewer(v, (q) => q("DELETE FROM form_question WHERE id = $1 AND urguu_id = app_urguu()", [uuid(str(fd, "id"))]));
  done("/admin/settings?tab=questions", "Устгагдлаа");
}

/* ---------- Онгодын мод ---------- */
export async function saveOngod(fd: FormData) {
  const v = await requirePerm("ongod.edit");
  const id = uuid(str(fd, "id"));
  const name = str(fd, "name", 160);
  const parent = uuid(str(fd, "parent_id"));
  const kind = str(fd, "kind") === "group" ? "group" : "ongod";
  if (!name) done("/admin/ongod", "Нэрээ оруулна уу");
  const msg = await asViewer(v, async (q) => {
    if (id && parent) {
      // Мөчрийг өөрийнх нь доор зөөхийг хориглоно (цикл үүснэ).
      const [cyc] = await q(
        `WITH RECURSIVE up AS (SELECT id, parent_id FROM ongod WHERE id = $2 UNION ALL SELECT o.id, o.parent_id FROM ongod o JOIN up ON o.id = up.parent_id)
         SELECT 1 FROM up WHERE id = $1`, [id, parent]);
      if (cyc) return "Зангилааг өөрийнх нь мөчир доор зөөх боломжгүй";
    }
    const vals = [name, parent, kind, uuid(str(fd, "era_id")), orNull(str(fd, "title", 300)), orNull(str(fd, "note", 4000)), int(str(fd, "sort"))];
    if (id) await q("UPDATE ongod SET name=$2, parent_id=$3, kind=$4, era_id=$5, title=$6, note=$7, sort=$8, needs_review=false WHERE id=$1", [id, ...vals]);
    else await q("INSERT INTO ongod (urguu_id, name, parent_id, kind, era_id, title, note, sort) VALUES (app_urguu(), $1,$2,$3,$4,$5,$6,$7)", vals);
    return "Хадгалагдлаа";
  });
  done("/admin/ongod", msg);
}

export async function deleteOngod(fd: FormData) {
  const v = await requirePerm("ongod.edit");
  const id = uuid(str(fd, "id"));
  const msg = await asViewer(v, async (q) => {
    const [c] = await q<{ kids: string; ppl: string }>(
      "SELECT (SELECT count(*) FROM ongod WHERE parent_id = $1) AS kids, (SELECT count(*) FROM person_ongod WHERE ongod_id = $1) AS ppl", [id]);
    if (Number(c.kids)) return "Дотроо зангилаатай тул устгах боломжгүй. Эхлээд тэдгээрийг зөөнө үү";
    if (Number(c.ppl)) return "Энэ онгодод хүн холбогдсон тул устгах боломжгүй";
    await q("DELETE FROM ongod WHERE id = $1", [id]);
    return "Устгагдлаа";
  });
  done("/admin/ongod", msg);
}

/* ---------- P1.8 Импорт ---------- */
export async function importCsv(fd: FormData) {
  const v = await requirePerm("import.run");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) done("/admin/import", "CSV файлаа сонгоно уу");
  const f = file as File;
  if (f.size > 5_000_000) done("/admin/import", "Файл хэт том байна (5 MB-аас бага байх ёстой)");
  const text = await f.text();
  // Эх файл (хувийн мэдээлэлтэй) диск дээр хадгалагдахгүй: санах ойд уншаад шууд DB рүү.
  const r = await asViewer(v, (q) => runImport(q, v.urguu.id, v.personId, text, f.name));
  done(
    "/admin/import",
    r.duplicate ? "Энэ файл аль хэдийн импортлогдсон байна" : !r.rows ? "Файлаас мөр олдсонгүй. Google Sheet-ээс CSV болгон татсан файл мөн эсэхийг шалгана уу"
      : `Импорт дууслаа: ${r.created} шинэ, ${r.updated} шинэчлэгдсэн, ${r.skipped} алгассан, ${r.issues} анхааруулга`,
  );
}

export async function resolveIssue(fd: FormData) {
  const v = await requirePerm("import.run");
  const id = uuid(str(fd, "id"));
  const act = str(fd, "act");
  const msg = await asViewer(v, async (q) => {
    const [is] = await q<{ kind: string; person_id: string | null; data: any }>("SELECT kind, person_id, data FROM import_issue WHERE id = $1 AND resolved_at IS NULL", [id]);
    if (!is) return "Анхааруулга олдсонгүй";
    let resolution = "Зөв гэж тэмдэглэв";
    if (is.kind === "ongod_unmatched" && act === "match") {
      const target = uuid(str(fd, "ongod_id"));
      const temp = uuid(is.data?.ongod_id || "");
      if (!target || !temp) return "Онгодоо сонгоно уу";
      await q("INSERT INTO person_ongod (person_id, ongod_id, is_primary, sort) SELECT person_id, $2, is_primary, sort FROM person_ongod WHERE ongod_id = $1 ON CONFLICT DO NOTHING", [temp, target]);
      await q("DELETE FROM person_ongod WHERE ongod_id = $1", [temp]);
      await q("UPDATE ongod t SET title = coalesce(t.title, s.title) FROM ongod s WHERE t.id = $2 AND s.id = $1", [temp, target]);
      await q("DELETE FROM ongod WHERE id = $1 AND needs_review AND NOT EXISTS (SELECT 1 FROM ongod c WHERE c.parent_id = $1)", [temp]);
      resolution = "Модны онгодтой холбов";
    } else if (is.kind === "ongod_unmatched" && act === "keep") {
      resolution = "Шинэ зангилаа болгон үлдээв";
    } else if (is.kind === "person_merge_suggest" && act === "merge") {
      const from = uuid(is.data?.from_id || ""), into = uuid(is.data?.into_id || "");
      if (!from || !into) return "Буруу өгөгдөл";
      if (!v.perms.has("person.merge")) return "Нэр нэгтгэх эрхгүй байна";
      await mergePersons(q, from, into);
      // Нэгтгэгдсэн хүнтэй холбоотой бусад нээлттэй саналууд хүчингүй болно.
      await q("UPDATE import_issue SET resolved_at = now(), resolved_by = $2, resolution = 'Нэгтгэгдсэн тул хаагдав' WHERE resolved_at IS NULL AND kind = 'person_merge_suggest' AND id <> $3 AND (data->>'from_id' = $1 OR data->>'into_id' = $1)", [from, v.personId, id]);
      resolution = "Нэгтгэв";
    } else if (is.kind === "person_merge_suggest" && act === "ok") {
      resolution = "Өөр хүн гэж тэмдэглэв";
    }
    await q("UPDATE import_issue SET resolved_at = now(), resolved_by = $2, resolution = $3 WHERE id = $1", [id, v.personId, resolution]);
    return resolution;
  });
  done("/admin/import", msg);
}

/* ---------- Нэр нэгтгэх (гараар) ---------- */
export async function mergePeople(fd: FormData) {
  const v = await requirePerm("person.merge");
  const from = uuid(str(fd, "from_id").replace(/^id:/, "")), into = uuid(str(fd, "into_id").replace(/^id:/, ""));
  if (!from || !into || from === into) done("/admin/import", "Нэгтгэх хоёр өөр хүнээ сонгоно уу");
  const msg = await asViewer(v, async (q) => {
    const rows = await q<{ id: string; is_registered: boolean; has_user: boolean }>(
      "SELECT p.id, p.is_registered, EXISTS (SELECT 1 FROM membership m WHERE m.person_id = p.id) AS has_user FROM person p WHERE p.id = ANY($1::uuid[]) AND p.merged_into_id IS NULL", [[from, into]]);
    const f = rows.find((r) => r.id === from);
    if (rows.length !== 2 || !f) return "Хүн олдсонгүй";
    // Бүртгэлтэй (гишүүнчлэлтэй) хүнийг өөр хүн рүү уусгахгүй: зөвхөн нэрээр дурдагдсан бүртгэлийг уусгана.
    if (f.is_registered && f.has_user) return "«Уусгах» талд зөвхөн бүртгэлгүй (нэрээр дурдагдсан) хүнийг сонгоно. Чиглэлийг солино уу";
    await mergePersons(q, from!, into!);
    return "Нэгтгэгдлээ";
  });
  done("/admin/import", msg);
}

/* ---------- P2.5 Өргөө хоорондын харах эрх ---------- */
export async function saveGrants(fd: FormData) {
  const v = await requirePerm("settings.manage");
  const want = fd.getAll("grantee").map((x) => uuid(String(x))).filter((x): x is string => !!x && x !== v.urguu.id);
  const { sys } = await import("@/lib/db");
  // Зөвхөн идэвхтэй, бодит өргөөнд л эрх олгоно (өргөөний жагсаалтыг апп-ын role харахгүй тул системийн холболтоор шалгана).
  const valid = (await sys<{ id: string }>("SELECT id FROM urguu WHERE state = 'active' AND id = ANY($1::uuid[])", [want])).map((r) => r.id);
  await asViewer(v, async (q) => {
    await q("DELETE FROM cross_urguu_grant WHERE owner_urguu_id = app_urguu() AND NOT (grantee_urguu_id = ANY($1::uuid[]))", [valid]);
    for (const g of valid)
      await q("INSERT INTO cross_urguu_grant (owner_urguu_id, grantee_urguu_id, created_by) VALUES (app_urguu(), $1, $2) ON CONFLICT DO NOTHING", [g, v.personId]);
  });
  done("/admin/settings?tab=grants", "Өргөө хоорондын эрх хадгалагдлаа");
}
