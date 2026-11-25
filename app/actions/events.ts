"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { publicCode } from "@/lib/codes";
import { pickerValues } from "@/lib/events";
import { SITE_URL, escHtml } from "@/lib/mail";
import { notifyPerson } from "@/lib/notify";
import { findOrCreateNamed, UUID } from "@/lib/people-write";
import { fmtDay, fmtRange, parseLocal } from "@/lib/time";
import { asViewer, requireMember, requirePerm } from "@/lib/viewer";

const str = (fd: FormData, k: string, max = 2000) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const orNull = (s: string) => (s ? s : null);
const uuid = (s: string) => (UUID.test(s) ? s : null);
const done = (path: string, msg?: string): never => {
  revalidatePath("/", "layout");
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : path);
};

/** P3.1: үйл үүсгэх / засах. */
export async function saveEvent(fd: FormData) {
  const v = await requirePerm("event.manage");
  const id = uuid(str(fd, "id"));
  const back = id ? `/events/${id}` : "/events";
  const name = str(fd, "name", 160);
  const starts = parseLocal(str(fd, "starts_at"));
  const ends = parseLocal(str(fd, "ends_at"));
  if (!name || !starts) done(id ? `${back}?edit=1` : "/events?add=1", "Нэр, эхлэх огноогоо оруулна уу");
  if (ends && ends <= starts!) done(id ? `${back}?edit=1` : "/events?add=1", "Дуусах цаг эхлэх цагаас хойш байх ёстой");
  const organizer = pickerValues(fd, "organizer").ids[0] ?? null;
  const cols = [name, uuid(str(fd, "type_id")), starts, ends, orNull(str(fd, "place", 200)), orNull(str(fd, "description", 4000)),
    uuid(str(fd, "ongod_id")), uuid(str(fd, "deedes_id")), fd.get("donations_open") === "on"];
  const eid = await asViewer(v, async (q) => {
    if (id) {
      await q(
        `UPDATE event SET name=$2, type_id=$3, starts_at=$4, ends_at=$5, place=$6, description=$7, ongod_id=$8, deedes_id=$9, donations_open=$10, organizer_id=$11,
           reminded_at = CASE WHEN starts_at = $4 THEN reminded_at ELSE NULL END
         WHERE id = $1`, [id, ...cols, organizer]);
      return id;
    }
    const [e] = await q<{ id: string }>(
      `INSERT INTO event (urguu_id, name, type_id, starts_at, ends_at, place, description, ongod_id, deedes_id, donations_open, organizer_id, public_code, created_by)
       VALUES (app_urguu(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [...cols, organizer ?? v.personId, publicCode(), v.personId]);
    // Зохион байгуулагч автоматаар оролцогч болно.
    const [role] = await q<{ id: string }>("SELECT id FROM event_role WHERE active ORDER BY sort LIMIT 1");
    await q("INSERT INTO event_participant (event_id, urguu_id, person_id, role_id, rsvp) VALUES ($1, app_urguu(), $2, $3, 'yes') ON CONFLICT DO NOTHING", [e.id, organizer ?? v.personId, role?.id ?? null]);
    return e.id;
  });
  done(`/events/${eid}`, id ? "Хадгалагдлаа" : "Үйл үүслээ");
}

export async function deleteEvent(fd: FormData) {
  const v = await requirePerm("event.manage");
  const id = uuid(str(fd, "id"));
  if (id) await asViewer(v, (q) => q("DELETE FROM event WHERE id = $1", [id]));
  done("/events", "Үйл устгагдлаа");
}

/** Төлөв солих. «Болсон» болгоход «Ирнэ» гэсэн хүмүүсийн ирцийг урьдчилан тэмдэглэнэ (админ дараа нь засна). */
export async function setEventState(fd: FormData) {
  const v = await requirePerm("event.manage");
  const id = uuid(str(fd, "id"));
  const state = str(fd, "state");
  if (!id || !["planned", "done", "cancelled"].includes(state)) done("/events");
  await asViewer(v, async (q) => {
    await q("UPDATE event SET state = $2 WHERE id = $1", [id, state]);
    if (state === "done") await q("UPDATE event_participant SET attended = (rsvp IN ('yes','maybe')) WHERE event_id = $1 AND attended IS NULL", [id]);
  });
  done(`/events/${id}`, state === "done" ? "Болсон гэж тэмдэглэлээ. Ирцийг шалгаж засна уу" : state === "cancelled" ? "Үйл цуцлагдлаа" : "Төлөвлөсөн болголоо");
}

/** Оролцогч нэмэх (олон хүн; жагсаалтад байхгүй бол бүртгэлгүй хүн болгож нэмнэ). */
export async function addEventParticipants(fd: FormData) {
  const v = await requirePerm("event.manage");
  const id = uuid(str(fd, "event_id"));
  if (!id) done("/events");
  const { ids, names } = pickerValues(fd, "people");
  const roleId = uuid(str(fd, "role_id"));
  const invited = fd.get("invite") === "on";
  let ev: { state: string; name: string; starts_at: Date; ends_at: Date | null; place: string | null } | undefined;
  const added: string[] = [];
  const n = await asViewer(v, async (q) => {
    const [e] = await q<NonNullable<typeof ev>>("SELECT state, name, starts_at, ends_at, place FROM event WHERE id = $1", [id]);
    if (!e) return 0;
    ev = e;
    for (const nm of names) {
      const p = await findOrCreateNamed(q, v.urguu.id, nm);
      if (p) ids.push(p.id);
    }
    let n = 0;
    for (const pid of new Set(ids)) {
      const r = await q(
        `INSERT INTO event_participant (event_id, urguu_id, person_id, role_id, rsvp, attended)
         SELECT $1, app_urguu(), p.id, $3, $4, $5 FROM person p WHERE p.id = $2 ON CONFLICT (event_id, person_id) DO NOTHING RETURNING id`,
        [id, pid, roleId, invited && e.state === "planned" ? "invited" : "yes", e.state === "done" ? true : null]);
      n += r.length;
      if (r.length) added.push(pid);
    }
    return n;
  });
  // P3.3: урилга болгож нэмсэн бол мэдэгдэнэ (хариугаа өөрсдөө өгнө).
  if (ev && invited && ev.state === "planned") {
    const when = `${fmtDay(ev.starts_at)} ${fmtRange(ev.starts_at, ev.ends_at).slice(11)}`;
    for (const pid of added)
      await notifyPerson(pid, {
        template: "event_invite", urguuId: v.urguu.id, subject: `Хуягтан: «${ev.name}» урилга`, title: "Үйл ажиллагааны урилга",
        body: `Таныг <b>${escHtml(ev.name)}</b> үйлд урьж байна. ${escHtml(when)}.${ev.place ? ` Байршил: ${escHtml(ev.place)}.` : ""} Ирэх эсэхээ хариулна уу.`,
        cta: { label: "Хариу өгөх", url: `${SITE_URL}/events/${id}` }, sms: `Хуягтан: «${ev.name}» ${when}. Хариу: ${SITE_URL}/events/${id}`,
      });
  }
  done(`/events/${id}`, n ? `${n} оролцогч нэмэгдлээ` : "Шинэ оролцогч нэмэгдсэнгүй");
}

/** Оролцогчийн үүрэг, ирц, тэмдэглэл засах эсвэл хасах. */
export async function updateEventParticipant(fd: FormData) {
  const v = await requirePerm("event.manage");
  const id = uuid(str(fd, "id"));
  const eventId = uuid(str(fd, "event_id"));
  if (!id || !eventId) done("/events");
  const op = str(fd, "op");
  await asViewer(v, async (q) => {
    if (op === "remove") await q("DELETE FROM event_participant WHERE id = $1 AND event_id = $2", [id, eventId]);
    else if (op === "attend") await q("UPDATE event_participant SET attended = NOT coalesce(attended, false) WHERE id = $1 AND event_id = $2", [id, eventId]);
    else await q("UPDATE event_participant SET role_id = $3, note = $4 WHERE id = $1 AND event_id = $2", [id, eventId, uuid(str(fd, "role_id")), orNull(str(fd, "note", 500))]);
  });
  done(`/events/${eventId}`);
}

/** P3.3: гишүүн өөрөө хариу өгнө (Ирнэ / Ирэхгүй / Магадгүй). */
export async function rsvpEvent(fd: FormData) {
  const v = await requireMember();
  const id = uuid(str(fd, "event_id"));
  const rsvp = str(fd, "rsvp");
  if (!id || !["yes", "no", "maybe"].includes(rsvp)) done("/events");
  const ok = await asViewer(v, async (q) => {
    const [e] = await q<{ state: string }>("SELECT state FROM event WHERE id = $1", [id]);
    if (!e || e.state !== "planned") return false;
    const [role] = await q<{ id: string }>("SELECT id FROM event_role WHERE active ORDER BY sort DESC LIMIT 1");
    await q(
      `INSERT INTO event_participant (event_id, urguu_id, person_id, role_id, rsvp) VALUES ($1, app_urguu(), $2, $3, $4)
       ON CONFLICT (event_id, person_id) DO UPDATE SET rsvp = EXCLUDED.rsvp`, [id, v.personId, role?.id ?? null, rsvp]);
    return true;
  });
  done(str(fd, "back", 100) === "me" ? "/me#schedule" : `/events/${id}`, ok ? "Хариу хадгалагдлаа" : "Энэ үйлд хариу өгөх боломжгүй");
}
