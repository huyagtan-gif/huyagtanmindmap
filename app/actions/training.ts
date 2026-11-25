"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { publicCode } from "@/lib/codes";
import { sys, sysTx, type Q } from "@/lib/db";
import { pickerValues } from "@/lib/events";
import { SITE_URL, escHtml } from "@/lib/mail";
import { notifyPerson, notifyPromoted } from "@/lib/notify";
import { UUID } from "@/lib/people-write";
import { fmtRange, parseLocal } from "@/lib/time";
import { joinTraining, leaveTraining, promoteWaitlist, syncFieldTraining, trainingAccess, type TrainingAccess } from "@/lib/training";
import { asViewer, requireMember, type Member } from "@/lib/viewer";

const str = (fd: FormData, k: string, max = 2000) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const orNull = (s: string) => (s ? s : null);
const uuid = (s: string) => (UUID.test(s) ? s : null);
const posInt = (s: string) => (/^\d{1,9}$/.test(s) ? parseInt(s, 10) : null);
const done = (path: string, msg?: string): never => {
  revalidatePath("/", "layout");
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : path);
};
const pids = (fd: FormData) => [...new Set(fd.getAll("pid").filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 500);

/** Сургалтыг удирдах эрхтэй эсэхийг шалгана (тэргүүлэх өргөөний «Сургалт удирдах» эрхтэй хүн эсвэл багш нь). */
async function mgr(fd: FormData, key = "training_id"): Promise<{ v: Member; a: TrainingAccess; id: string }> {
  const v = await requireMember();
  const id = uuid(str(fd, key));
  const a = id ? await asViewer(v, (q) => trainingAccess(q, v, id)) : null;
  if (!id || !a?.manage) done("/trainings", "Энэ сургалтыг удирдах эрхгүй байна");
  return { v, a: a!, id: id! };
}

async function firstSession(trainingId: string): Promise<string> {
  const [s] = await sys<{ starts_at: Date; ends_at: Date | null }>("SELECT starts_at, ends_at FROM training_session WHERE training_id = $1 AND starts_at > now() - interval '1 day' ORDER BY starts_at LIMIT 1", [trainingId]);
  return s ? fmtRange(s.starts_at, s.ends_at) : "";
}

/* ---------- P3.2 Сургалт үүсгэх / засах ---------- */
export async function saveTraining(fd: FormData) {
  const v = await requireMember();
  const id = uuid(str(fd, "id"));
  if (id) {
    const a = await asViewer(v, (q) => trainingAccess(q, v, id));
    if (!a?.manage) done("/trainings", "Энэ сургалтыг удирдах эрхгүй байна");
  } else if (!v.perms.has("training.manage")) done("/trainings");
  const back = id ? `/trainings/${id}?tab=set` : "/trainings?add=1";
  const name = str(fd, "name", 160);
  if (!name) done(back, "Нэрээ оруулна уу");
  const scope = str(fd, "scope") === "public" ? "public" : "members";
  const reg = ["invite", "open", "both"].includes(str(fd, "reg_mode")) ? str(fd, "reg_mode") : "invite";
  const state = ["draft", "open", "closed", "done", "cancelled"].includes(str(fd, "state")) ? str(fd, "state") : "open";
  const capRaw = str(fd, "capacity");
  const capacity = capRaw ? posInt(capRaw) : null;
  if (capRaw && !capacity) done(back, "Хязгаар эерэг бүхэл тоо байх ёстой");
  const fee = posInt(str(fd, "fee").replace(/[^\d]/g, "")) ?? 0;
  const url = str(fd, "online_url", 300);
  if (url && !/^https?:\/\//i.test(url)) done(back, "Онлайн холбоос http:// эсвэл https://-ээр эхлэх ёстой");
  const cols = [name, orNull(str(fd, "topic", 300)), orNull(str(fd, "description", 4000)), orNull(str(fd, "place", 200)), orNull(url), capacity, state, scope, reg, fee,
    fd.get("is_field") === "on", fd.get("survey_open") === "on"];
  const teachers = pickerValues(fd, "teachers").ids;
  const first = parseLocal(str(fd, "first_session"));
  let promoted: string[] = [];
  const tid = await asViewer(v, async (q) => {
    let tid = id;
    if (tid) {
      await q("UPDATE training SET name=$2, topic=$3, description=$4, place=$5, online_url=$6, capacity=$7, state=$8, scope=$9, reg_mode=$10, fee=$11, is_field=$12, survey_open=$13 WHERE id = $1", [tid, ...cols]);
      if (fd.has("teachers_sent")) {
        await q("DELETE FROM training_teacher WHERE training_id = $1 AND NOT (person_id = ANY($2::uuid[]))", [tid, teachers]);
        for (const p of teachers) await q("INSERT INTO training_teacher (training_id, person_id) SELECT $1, id FROM person WHERE id = $2 ON CONFLICT DO NOTHING", [tid, p]);
      }
      promoted = await promoteWaitlist(q, tid);
      await syncFieldTraining(q, (await q<{ person_id: string }>("SELECT person_id FROM training_participant WHERE training_id = $1 AND completion = 'completed'", [tid])).map((r) => r.person_id));
    } else {
      const [t] = await q<{ id: string }>(
        `INSERT INTO training (urguu_id, name, topic, description, place, online_url, capacity, state, scope, reg_mode, fee, is_field, survey_open, public_code, created_by)
         VALUES (app_urguu(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [...cols, publicCode(), v.personId]);
      tid = t.id;
      await q("INSERT INTO training_urguu (training_id, urguu_id, is_lead, share_pct) VALUES ($1, app_urguu(), true, 100)", [tid]);
      for (const p of teachers.length ? teachers : [v.personId]) await q("INSERT INTO training_teacher (training_id, person_id) SELECT $1, id FROM person WHERE id = $2 ON CONFLICT DO NOTHING", [tid, p]);
      if (first) await q("INSERT INTO training_session (training_id, starts_at, place) VALUES ($1,$2,$3)", [tid, first, orNull(str(fd, "place", 200))]);
    }
    return tid!;
  });
  if (promoted.length) await notifyPromoted({ id: tid, name, urguu_id: v.urguu.id, fee }, promoted);
  done(id ? `/trainings/${tid}?tab=set` : `/trainings/${tid}?tab=sess`, id ? "Хадгалагдлаа" : "Сургалт үүслээ. Хичээлийн хуваариа оруулна уу");
}

export async function deleteTraining(fd: FormData) {
  const { v, id } = await mgr(fd);
  if (!v.perms.has("training.manage")) done(`/trainings/${id}`, "Устгах эрхгүй байна");
  const paid = await sys("SELECT 1 FROM training_participant WHERE training_id = $1 AND pay_state = 'paid' LIMIT 1", [id]);
  if (paid.length) done(`/trainings/${id}?tab=set`, "Төлбөр төлсөн оролцогчтой сургалтыг устгах боломжгүй. Төлөвийг «Цуцалсан» болгоно уу");
  await asViewer(v, (q) => q("DELETE FROM training WHERE id = $1", [id]));
  done("/trainings", "Сургалт устгагдлаа");
}

/* ---------- Хичээл (P3.2) ба QR (P3.5) ---------- */
export async function saveSession(fd: FormData) {
  const { v, id } = await mgr(fd);
  const sid = uuid(str(fd, "id"));
  const starts = parseLocal(str(fd, "starts_at"));
  const ends = parseLocal(str(fd, "ends_at"));
  const back = `/trainings/${id}?tab=sess`;
  if (!starts) done(back, "Хичээлийн эхлэх огноо, цагийг оруулна уу");
  if (ends && ends <= starts!) done(back, "Дуусах цаг эхлэх цагаас хойш байх ёстой");
  const cols = [orNull(str(fd, "title", 160)), starts, ends, orNull(str(fd, "place", 200))];
  await asViewer(v, (q) =>
    sid
      ? q("UPDATE training_session SET title=$3, starts_at=$4, ends_at=$5, place=$6, reminded_at = CASE WHEN starts_at = $4 THEN reminded_at ELSE NULL END WHERE id = $1 AND training_id = $2", [sid, id, ...cols])
      : q("INSERT INTO training_session (training_id, title, starts_at, ends_at, place) VALUES ($1,$2,$3,$4,$5)", [id, ...cols]));
  done(back, sid ? "Хичээл хадгалагдлаа" : "Хичээл нэмэгдлээ");
}

export async function deleteSession(fd: FormData) {
  const { v, id } = await mgr(fd);
  const sid = uuid(str(fd, "id"));
  if (sid) await asViewer(v, (q) => q("DELETE FROM training_session WHERE id = $1 AND training_id = $2", [sid, id]));
  done(`/trainings/${id}?tab=sess`, "Хичээл устгагдлаа");
}

/** QR-аар ирц авахыг нээх / хаах. */
export async function toggleQr(fd: FormData) {
  const { v, id } = await mgr(fd);
  const sid = uuid(str(fd, "id"));
  if (sid) await asViewer(v, (q) => q("UPDATE training_session SET qr_open = NOT qr_open WHERE id = $1 AND training_id = $2", [sid, id]));
  done(str(fd, "back", 200).startsWith(`/trainings/${id}`) ? str(fd, "back", 200) : `/trainings/${id}?tab=sess`);
}

/** Ирцийг гараар тэмдэглэх / арилгах (P3.5). */
export async function toggleAttendance(fd: FormData) {
  const { v, id } = await mgr(fd);
  const sid = uuid(str(fd, "session_id"));
  const pid = uuid(str(fd, "person_id"));
  if (sid && pid)
    await asViewer(v, async (q) => {
      const del = await q("DELETE FROM training_attendance WHERE session_id = $1 AND person_id = $2 RETURNING 1", [sid, pid]);
      if (!del.length)
        await q(
          `INSERT INTO training_attendance (session_id, training_id, person_id, method, marked_by)
           SELECT s.id, s.training_id, tp.person_id, 'manual', $4 FROM training_session s JOIN training_participant tp ON tp.training_id = s.training_id
           WHERE s.id = $1 AND s.training_id = $3 AND tp.person_id = $2`, [sid, pid, id, v.personId]);
    });
  done(`/trainings/${id}`);
}

/* ---------- P3.3 Урилга ---------- */
export async function inviteToTraining(fd: FormData) {
  const { v, a, id } = await mgr(fd);
  const ids = [...new Set([...pids(fd), ...pickerValues(fd, "people").ids])].slice(0, 500);
  if (!ids.length) done(`/trainings/${id}?tab=invite`, "Урих хүнээ сонгоно уу");
  const added = await asViewer(v, async (q) => {
    const out: string[] = [];
    for (const pid of ids) {
      const r = await q(
        `INSERT INTO training_participant (training_id, person_id, state, source, invited_by)
         SELECT $1, p.id, 'invited', 'invite', $3 FROM person p WHERE p.id = $2 ON CONFLICT (training_id, person_id) DO NOTHING RETURNING person_id`, [id, pid, v.personId]);
      if (r.length) out.push(pid);
    }
    return out;
  });
  const when = await firstSession(id);
  for (const pid of added)
    await notifyPerson(pid, {
      template: "training_invite", urguuId: a.t.urguu_id, subject: `Хуягтан: «${a.t.name}» сургалтын урилга`, title: "Сургалтын урилга",
      body: `Таныг <b>${escHtml(a.t.name)}</b> сургалтад урьж байна.${when ? ` Эхлэх: ${escHtml(when)}.` : ""}${a.t.place ? ` Байршил: ${escHtml(a.t.place)}.` : ""} Ирэх эсэхээ хариулна уу.`,
      cta: { label: "Хариу өгөх", url: `${SITE_URL}/trainings/${id}` }, sms: `Хуягтан: «${a.t.name}» сургалтад урьж байна.${when ? ` ${when}.` : ""} Хариу: ${SITE_URL}/trainings/${id}`,
    });
  done(`/trainings/${id}`, added.length ? `${added.length} хүнд урилга илгээлээ` : "Сонгосон хүмүүс аль хэдийн жагсаалтад байна");
}

/* ---------- Оролцогчдыг бөөнөөр удирдах (formAction тус бүр) ---------- */
async function bulk(fd: FormData, fn: (q: Q, id: string, ids: string[], v: Member) => Promise<string>, after?: (a: TrainingAccess, promoted: string[]) => Promise<void>) {
  const { v, a, id } = await mgr(fd);
  const ids = pids(fd);
  if (!ids.length) done(`/trainings/${id}`, "Эхлээд хүмүүсээ сонгоно уу");
  let promoted: string[] = [];
  const msg = await asViewer(v, async (q) => {
    const m = await fn(q, id, ids, v);
    promoted = await promoteWaitlist(q, id);
    return m;
  });
  if (promoted.length) await notifyPromoted(a.t, promoted);
  await after?.(a, promoted);
  done(`/trainings/${id}`, msg);
}

/** Сонгосон хүмүүсийг оролцогч болгоно (хязгаарыг үл харгалзан: админы шийдвэр). */
export async function bulkConfirm(fd: FormData) {
  await bulk(fd, async (q, id, ids) => {
    let n = 0;
    for (const pid of ids) if ((await joinTraining(q, { trainingId: id, personId: pid, source: "admin", ignoreCapacity: true })).changed) n++;
    return `${n} хүнийг оролцогч болголоо`;
  });
}
export async function bulkWaitlist(fd: FormData) {
  await bulk(fd, async (q, id, ids) => {
    const r = await q("UPDATE training_participant SET state = 'waitlist', responded_at = clock_timestamp() WHERE training_id = $1 AND person_id = ANY($2::uuid[]) AND state <> 'waitlist' RETURNING 1", [id, ids]);
    return `${r.length} хүнийг хүлээлгийн жагсаалтад шилжүүллээ`;
  });
}
export async function bulkRemove(fd: FormData) {
  await bulk(fd, async (q, id, ids) => {
    const r = await q("DELETE FROM training_participant WHERE training_id = $1 AND person_id = ANY($2::uuid[]) AND pay_state NOT IN ('paid') RETURNING 1", [id, ids]);
    await q("DELETE FROM training_attendance WHERE training_id = $1 AND person_id = ANY($2::uuid[]) AND NOT EXISTS (SELECT 1 FROM training_participant tp WHERE tp.training_id = $1 AND tp.person_id = training_attendance.person_id)", [id, ids]);
    return r.length < ids.length ? `${r.length} хүнийг хаслаа. Төлбөр төлсөн хүнийг хасахгүй (эхлээд буцаалт тэмдэглэнэ)` : `${r.length} хүнийг жагсаалтаас хаслаа`;
  });
}
/** P3.6 Төгсөлт. */
export async function bulkComplete(fd: FormData) {
  await bulk(fd, async (q, id, ids) => {
    const r = await q("UPDATE training_participant SET completion = 'completed' WHERE training_id = $1 AND person_id = ANY($2::uuid[]) RETURNING person_id", [id, ids]);
    await syncFieldTraining(q, r.map((x: any) => x.person_id));
    return `${r.length} хүнийг «Дүүргэсэн» гэж тэмдэглэлээ`;
  });
}
export async function bulkIncomplete(fd: FormData) {
  await bulk(fd, async (q, id, ids) => {
    const r = await q("UPDATE training_participant SET completion = 'incomplete' WHERE training_id = $1 AND person_id = ANY($2::uuid[]) RETURNING 1", [id, ids]);
    return `${r.length} хүнийг «Дутуу» гэж тэмдэглэлээ`;
  });
}

/**
 * P3.7 (D32): сонгосон оролцогчдыг (зочин ч бай) Waiting list руу шилжүүлнэ.
 * Зочин (бүртгэлгүй хүн) өргөөний бүртгэлтэй хүн болж, хамгийн эхний явцын төлөвт орно. Аль хэдийн төлөвтэй гишүүнийг алгасна.
 */
export async function bulkToWaiting(fd: FormData) {
  await bulk(fd, async (q, id, ids, v) => {
    if (!v.perms.has("status.change") && !v.perms.has("training.manage")) return "Waiting list руу шилжүүлэх эрхгүй байна";
    const [st] = await q<{ id: string; name: string }>("SELECT id, name FROM status WHERE active ORDER BY sort, name LIMIT 1");
    if (!st) return "Идэвхтэй явцын төлөв алга";
    const [role] = await q<{ id: string }>("SELECT id FROM role WHERE NOT is_system ORDER BY sort DESC LIMIT 1");
    // Зөвхөн энэ сургалтын оролцогч, энэ өргөөний хүрээнд байгаа (RLS), явцын төлөвгүй эсвэл бүртгэлгүй хүн.
    const moved = await q<{ id: string }>(
      `UPDATE person p SET status_id = $3, is_registered = true
       WHERE p.id = ANY($2::uuid[]) AND p.merged_into_id IS NULL AND (p.status_id IS NULL OR NOT p.is_registered)
         AND EXISTS (SELECT 1 FROM training_participant tp WHERE tp.training_id = $1 AND tp.person_id = p.id)
       RETURNING p.id`, [id, ids, st.id]);
    for (const m of moved)
      await q(
        `INSERT INTO membership (person_id, urguu_id, role_id, state, decided_by, decided_at) VALUES ($1, app_urguu(), $2, 'approved', $3, now())
         ON CONFLICT (person_id, urguu_id) DO NOTHING`, [m.id, role?.id ?? null, v.personId]);
    const skip = ids.length - moved.length;
    return `${moved.length} хүн «${st.name}» рүү шилжлээ${skip ? `. ${skip} хүн аль хэдийн явцын төлөвтэй тул алгаслаа` : ""}`;
  });
}

/* ---------- P3.3 Гишүүн өөрөө: бүртгүүлэх, урилгад хариулах ---------- */
export async function rsvpTraining(fd: FormData) {
  const v = await requireMember();
  const id = uuid(str(fd, "training_id"));
  const op = str(fd, "op");
  const back = str(fd, "back") === "me" ? "/me#schedule" : `/trainings/${id}`;
  if (!id || !["yes", "no", "maybe"].includes(op)) done("/trainings");
  const a = await asViewer(v, (q) => trainingAccess(q, v, id!));
  if (!a) done("/trainings", "Сургалт олдсонгүй");
  const t = a!.t;
  let promoted: string[] = [];
  // Өөрийн мөрийг л өөрчилнө. Хамтарсан өргөөний гишүүн ч хариулж чадахын тулд системийн транзакцаар (эрхийг дээр шалгасан).
  const msg = await sysTx({ userId: v.userId, personId: v.personId, urguuId: t.urguu_id }, async (q) => {
    const [ex] = await q<{ state: string }>("SELECT state FROM training_participant WHERE training_id = $1 AND person_id = $2", [id, v.personId]);
    if (op !== "yes") {
      if (!ex) return "Та энэ сургалтад бүртгэлгүй байна";
      promoted = await leaveTraining(q, id!, v.personId, op as "no" | "maybe");
      return op === "no" ? "Ирэхгүй гэж тэмдэглэлээ" : "Магадгүй гэж тэмдэглэлээ";
    }
    if (t.state !== "open") return "Энэ сургалтын бүртгэл хаагдсан байна";
    if (!ex && t.reg_mode === "invite" && !a!.manage) return "Энэ сургалтад зөвхөн урилгаар оролцоно";
    const r = await joinTraining(q, { trainingId: id!, personId: v.personId, source: ex ? "invite" : "self" });
    return r.state === "waitlist" ? "Суудал дүүрсэн тул та хүлээлгийн жагсаалтад орлоо. Суудал суларвал мэдэгдэнэ" : r.fee > 0 ? "Бүртгэгдлээ. Төлбөрөө төлж баталгаажуулна уу" : "Бүртгэгдлээ";
  });
  if (promoted.length) await notifyPromoted(t, promoted);
  done(back, msg);
}

/** P3.6 Санал асуулга: оролцогч нэг удаа үнэлнэ (дараа нь засаж болно). */
export async function submitSurvey(fd: FormData) {
  const v = await requireMember();
  const id = uuid(str(fd, "training_id"));
  const rating = posInt(str(fd, "rating"));
  if (!id) done("/trainings");
  if (!rating || rating < 1 || rating > 5) done(`/trainings/${id}`, "Үнэлгээгээ сонгоно уу");
  const a = await asViewer(v, (q) => trainingAccess(q, v, id!));
  if (!a?.t.survey_open) done(`/trainings/${id}`, "Санал асуулга нээгдээгүй байна");
  const ok = await sysTx({ userId: v.userId, personId: v.personId, urguuId: a!.t.urguu_id }, async (q) => {
    const part = await q("SELECT 1 FROM training_participant WHERE training_id = $1 AND person_id = $2 AND state = 'yes'", [id, v.personId]);
    if (!part.length) return false;
    await q(
      `INSERT INTO training_survey (training_id, person_id, rating, comment) VALUES ($1,$2,$3,$4)
       ON CONFLICT (training_id, person_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment`, [id, v.personId, rating, orNull(str(fd, "comment", 2000))]);
    return true;
  });
  done(`/trainings/${id}`, ok ? "Баярлалаа! Үнэлгээ хадгалагдлаа" : "Зөвхөн оролцогч үнэлгээ өгнө");
}

/* ---------- P3.2 / P4.6 Хамтран зохион байгуулагч өргөө ба хувь ---------- */
export async function saveCoUrguus(fd: FormData) {
  const { v, id } = await mgr(fd);
  const back = `/trainings/${id}?tab=set`;
  if (!v.perms.has("training.manage")) done(back, "Хамтрагч өргөөг өөрчлөх эрхгүй байна");
  const others = await sys<{ id: string }>("SELECT id FROM urguu WHERE state = 'active' AND id <> $1", [v.urguu.id]);
  const rows: { id: string; pct: number }[] = [];
  for (const u of others) {
    if (fd.get(`u_${u.id}`) !== "on") continue;
    const pct = Number(str(fd, `pct_${u.id}`).replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) done(back, "Хувь 0–100 хооронд байх ёстой");
    rows.push({ id: u.id, pct: Math.round(pct * 100) / 100 });
  }
  const sum = rows.reduce((s, r) => s + r.pct, 0);
  if (sum > 100) done(back, "Хамтрагч өргөөдийн хувийн нийлбэр 100-гаас их байна");
  await asViewer(v, async (q) => {
    await q("DELETE FROM training_urguu WHERE training_id = $1 AND NOT is_lead AND NOT (urguu_id = ANY($2::uuid[]))", [id, rows.map((r) => r.id)]);
    for (const r of rows)
      await q("INSERT INTO training_urguu (training_id, urguu_id, is_lead, share_pct) VALUES ($1,$2,false,$3) ON CONFLICT (training_id, urguu_id) DO UPDATE SET share_pct = EXCLUDED.share_pct", [id, r.id, r.pct]);
    await q("UPDATE training_urguu SET share_pct = $2 WHERE training_id = $1 AND is_lead", [id, Math.round((100 - sum) * 100) / 100]);
  });
  done(back, "Хамтран зохион байгуулагчид хадгалагдлаа");
}
