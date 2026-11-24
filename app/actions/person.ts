"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asViewer, requireMember } from "@/lib/viewer";
import { capFirst, capWords, normPhone } from "@/lib/norm";
import { findOrCreateNamed, syncOwnAlias, UUID } from "@/lib/people-write";

const str = (fd: FormData, k: string, max = 4000) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const orNull = (s: string) => (s ? s : null);
const dateOrNull = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const uuidOrNull = (s: string) => (UUID.test(s) ? s : null);
const boolOrNull = (s: string) => (s === "true" ? true : s === "false" ? false : null);
const safeReturn = (s: string) => (s.startsWith("/") && !s.startsWith("//") ? s : "/me");

const REL_KEYS = ["teacher", "introducer", "supporter", "informant"] as const;

/** P1.6 / P1.7: бүртгэлийн формыг хадгална. Өөрийнхөө, эсвэл person.edit эрхтэй бол бусдын мэдээллийг. */
export async function savePerson(fd: FormData) {
  const v = await requireMember();
  const personId = uuidOrNull(str(fd, "person_id")) || v.personId;
  const isSelf = personId === v.personId;
  if (!isSelf && !v.perms.has("person.edit")) redirect("/me");
  // Талбарын эрх бичихэд ч үйлчилнэ: харж чадахгүй талбараа засаж чадахгүй.
  const canW = (key: string) => isSelf || v.fields.has(key);
  const has = (k: string) => fd.has(k);
  const given = capFirst(str(fd, "given_name", 80));
  const ret = safeReturn(str(fd, "return_to", 200) || "/me");
  if (!given) redirect(`${ret}?e=name`);

  let err = "";
  try {
    await asViewer(v, async (q) => {
      const [exists] = await q("SELECT 1 FROM person WHERE id = $1 AND merged_into_id IS NULL", [personId]);
      if (!exists) throw new Error("notfound");
      const father = orNull(capFirst(str(fd, "father_name", 80)));

      // --- person ---
      const set: Record<string, unknown> = {
        clan_name: orNull(capWords(str(fd, "clan_name", 80))),
        father_name: father,
        given_name: given,
        ongod_nickname: orNull(str(fd, "ongod_nickname", 120)),
        huyag_today: orNull(str(fd, "huyag_today", 60)),
        field_training: boolOrNull(str(fd, "field_training")),
        sutra: boolOrNull(str(fd, "sutra")),
        info_source: orNull(str(fd, "info_source", 300)),
      };
      if (canW("ulaach") && has("ulaach_name")) set.ulaach_name = orNull(str(fd, "ulaach_name", 120));
      if (canW("knowledge") && has("knowledge_level_id")) set.knowledge_level_id = uuidOrNull(str(fd, "knowledge_level_id"));
      if (canW("comment") && has("comment")) set.comment = orNull(str(fd, "comment"));
      if (canW("suggestion") && has("suggestion")) set.suggestion = orNull(str(fd, "suggestion"));
      if (!isSelf && v.fields.has("teacher_note") && has("teacher_note")) set.teacher_note = orNull(str(fd, "teacher_note"));
      const keys = Object.keys(set);
      await q(
        `UPDATE person SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}${isSelf ? ", form_completed_at = coalesce(form_completed_at, now())" : ""} WHERE id = $1`,
        [personId, ...keys.map((k) => set[k])],
      );
      await syncOwnAlias(q, personId, father, given);

      // --- person_private ---
      const priv: Record<string, unknown> = {};
      if (canW("phone") && has("phone")) priv.phone = orNull(normPhone(str(fd, "phone", 24)).value);
      if (canW("email") && has("email")) priv.email = orNull(str(fd, "email", 254).toLowerCase());
      if (canW("facebook") && has("facebook")) priv.facebook = orNull(str(fd, "facebook", 300));
      const pk = Object.keys(priv);
      if (pk.length) {
        await q(
          `INSERT INTO person_private (person_id, ${pk.join(", ")}) VALUES ($1, ${pk.map((_, i) => `$${i + 2}`).join(", ")})
           ON CONFLICT (person_id) DO UPDATE SET ${pk.map((k) => `${k} = EXCLUDED.${k}`).join(", ")}`,
          [personId, ...pk.map((k) => priv[k])],
        );
      }

      // --- huyag ---
      const hy: Record<string, unknown> = { huyag_type_id: uuidOrNull(str(fd, "huyag_type_id")), note: orNull(str(fd, "huyag_note", 300)) };
      if (canW("huyag_dates") && has("met_teacher_on")) hy.met_teacher_on = dateOrNull(str(fd, "met_teacher_on"));
      if (canW("huyag_dates") && has("huyag_on")) hy.huyag_on = dateOrNull(str(fd, "huyag_on"));
      const hk = Object.keys(hy);
      await q(
        `INSERT INTO huyag (person_id, ${hk.join(", ")}) VALUES ($1, ${hk.map((_, i) => `$${i + 2}`).join(", ")})
         ON CONFLICT (person_id) DO UPDATE SET ${hk.map((k) => `${k} = EXCLUDED.${k}`).join(", ")}`,
        [personId, ...hk.map((k) => hy[k])],
      );

      // --- онгод (олон; эхнийх нь үндсэн) ---
      const ongodIds = fd.getAll("ongod").map((x) => String(x).replace(/^id:/, "")).filter((x) => UUID.test(x));
      const newName = str(fd, "ongod_new_name", 120);
      if (newName) {
        const [o] = await q<{ id: string }>(
          "INSERT INTO ongod (urguu_id, name, era_id, title, kind, needs_review, sort) VALUES (app_urguu(), $1, $2, $3, 'ongod', true, 9999) RETURNING id",
          [newName, uuidOrNull(str(fd, "ongod_new_era")), orNull(str(fd, "ongod_new_title", 200))],
        );
        ongodIds.push(o.id);
      }
      const uniq = [...new Set(ongodIds)];
      await q("DELETE FROM person_ongod WHERE person_id = $1 AND NOT (ongod_id = ANY($2::uuid[]))", [personId, uniq]);
      for (let i = 0; i < uniq.length; i++)
        await q(
          `INSERT INTO person_ongod (person_id, ongod_id, is_primary, sort) SELECT $1, o.id, $3, $4 FROM ongod o WHERE o.id = $2
           ON CONFLICT (person_id, ongod_id) DO UPDATE SET is_primary = EXCLUDED.is_primary, sort = EXCLUDED.sort`,
          [personId, uniq[i], i === 0, i],
        );

      // --- дээдэс (олон) ---
      const deedes = [...new Set(fd.getAll("deedes").map(String).filter((x) => UUID.test(x)))];
      await q("DELETE FROM person_deedes WHERE person_id = $1 AND NOT (deedes_id = ANY($2::uuid[]))", [personId, deedes]);
      for (const d of deedes)
        await q("INSERT INTO person_deedes (person_id, deedes_id) SELECT $1, d.id FROM deedes d WHERE d.id = $2 ON CONFLICT DO NOTHING", [personId, d]);

      // --- хүн хоорондын холбоо (олон; байхгүй бол "бүртгэлгүй хүн" үүснэ) ---
      const types = await q<{ id: string; key: string }>("SELECT id, key FROM relation_type WHERE key = ANY($1)", [REL_KEYS as unknown as string[]]);
      for (const t of types) {
        const want: string[] = [];
        for (const raw of fd.getAll(`rel_${t.key}`).map(String)) {
          if (raw.startsWith("id:") && UUID.test(raw.slice(3))) want.push(raw.slice(3));
          else if (raw.startsWith("new:")) {
            const r = await findOrCreateNamed(q, v.urguu.id, raw.slice(4));
            if (r) want.push(r.id);
          }
        }
        const ids = [...new Set(want)].filter((x) => x !== personId);
        await q("DELETE FROM relation WHERE from_person_id = $1 AND type_id = $2 AND NOT (to_person_id = ANY($3::uuid[]))", [personId, t.id, ids]);
        for (const to of ids)
          await q(
            "INSERT INTO relation (from_person_id, to_person_id, type_id) SELECT $1, p.id, $3 FROM person p WHERE p.id = $2 ON CONFLICT DO NOTHING",
            [personId, to, t.id],
          );
      }

      // --- өргөөний нэмэлт асуулт ---
      const qs = await q<{ id: string }>("SELECT id FROM form_question WHERE active AND urguu_id = app_urguu()");
      for (const qq of qs) {
        if (!has(`q_${qq.id}`)) continue;
        await q(
          `INSERT INTO form_answer (person_id, question_id, urguu_id, value) VALUES ($1,$2,app_urguu(),$3)
           ON CONFLICT (person_id, question_id) DO UPDATE SET value = EXCLUDED.value`,
          [personId, qq.id, orNull(str(fd, `q_${qq.id}`))],
        );
      }
    });
  } catch (e: any) {
    err = e?.code === "23505" ? "email" : e?.message === "notfound" ? "notfound" : "save";
    if (err === "save") console.error("[savePerson]", e);
  }
  revalidatePath("/", "layout");
  redirect(err ? `${ret}?e=${err}` : `${ret}?saved=1`);
}

/** P1.10: явцын төлөв солих (Kanban чирэх, профайл дээрх сонголт). status_history-д trigger бичнэ. */
export async function changeStatus(personId: string, statusId: string): Promise<{ ok: boolean; error?: string }> {
  const v = await requireMember();
  if (!v.perms.has("status.change")) return { ok: false, error: "Төлөв солих эрхгүй байна." };
  if (!UUID.test(personId) || !UUID.test(statusId)) return { ok: false, error: "Буруу утга." };
  const n = await asViewer(v, async (q) => {
    const r = await q("UPDATE person SET status_id = s.id FROM status s WHERE person.id = $1 AND s.id = $2 AND s.active RETURNING person.id", [personId, statusId]);
    return r.length;
  });
  revalidatePath("/", "layout");
  return n ? { ok: true } : { ok: false, error: "Хүн эсвэл төлөв олдсонгүй." };
}

export async function changeStatusForm(fd: FormData) {
  await changeStatus(str(fd, "person_id"), str(fd, "status_id"));
  redirect(safeReturn(str(fd, "return_to", 200)));
}

/** Админ: хүн гараар нэмэх (бүртгэлийг дараа нь өөрөө эсвэл админ бөглөнө). */
export async function addPerson(fd: FormData) {
  const v = await requireMember();
  if (!v.perms.has("person.edit")) redirect("/people");
  const given = capFirst(str(fd, "given_name", 80));
  if (!given) redirect("/people?e=name");
  const id = await asViewer(v, async (q) => {
    const father = orNull(capFirst(str(fd, "father_name", 80)));
    const [role] = await q<{ id: string }>("SELECT id FROM role WHERE NOT is_system ORDER BY sort DESC LIMIT 1");
    const [p] = await q<{ id: string }>(
      "INSERT INTO person (father_name, given_name, status_id, created_urguu_id) VALUES ($1,$2,coalesce($3::uuid, (SELECT id FROM status WHERE active ORDER BY sort LIMIT 1)),app_urguu()) RETURNING id",
      [father, given, uuidOrNull(str(fd, "status_id"))],
    );
    const phone = normPhone(str(fd, "phone", 24)).value;
    const email = str(fd, "email", 254).toLowerCase();
    if (phone || email) await q("INSERT INTO person_private (person_id, phone, email) VALUES ($1,$2,$3)", [p.id, orNull(phone), orNull(email)]);
    await q("INSERT INTO membership (person_id, urguu_id, role_id, state, decided_by, decided_at) VALUES ($1, app_urguu(), $2, 'approved', $3, now())", [p.id, role?.id ?? null, v.personId]);
    await syncOwnAlias(q, p.id, father, given);
    return p.id;
  }).catch((e) => (e?.code === "23505" ? "dup" : Promise.reject(e)));
  if (id === "dup") redirect("/people?e=email");
  revalidatePath("/", "layout");
  redirect(`/people/${id}/edit`);
}
