import { createHmac, timingSafeEqual } from "node:crypto";
import type { Q } from "./db";
import type { Viewer } from "./viewer";

export const T_STATE: Record<string, [string, string]> = {
  draft: ["", "Ноорог"], open: ["pri", "Бүртгэл нээлттэй"], closed: ["warn", "Бүртгэл хаагдсан"], done: ["", "Дууссан"], cancelled: ["bad", "Цуцалсан"],
};
export const P_STATE: Record<string, [string, string]> = {
  invited: ["warn", "Урьсан"], yes: ["ok", "Ирнэ"], no: ["", "Ирэхгүй"], maybe: ["", "Магадгүй"], waitlist: ["warn", "Хүлээлгэд"], cancelled: ["", "Цуцалсан"],
};
export const PAY_STATE: Record<string, [string, string]> = { none: ["", "—"], pending: ["warn", "Хүлээгдэж буй"], paid: ["ok", "Төлсөн"], refunded: ["bad", "Буцаасан"] };
export const SCOPE: Record<string, string> = { members: "Зөвхөн гишүүд", public: "Олон нийтэд нээлттэй" };
export const REG: Record<string, string> = { invite: "Урилгаар", open: "Нээлттэй", both: "Урилга + нээлттэй" };

export type Training = {
  id: string; urguu_id: string; name: string; topic: string | null; description: string | null; place: string | null; online_url: string | null;
  capacity: number | null; state: string; scope: string; reg_mode: string; fee: number; is_field: boolean; survey_open: boolean; public_code: string; created_at: Date;
};
export type TrainingAccess = { t: Training; lead: boolean; teacher: boolean; manage: boolean };

/** Үзэгчид харагдах сургалт ба түүний эрх. RLS: зохион байгуулагч өргөөний гишүүд л уншина. */
export async function trainingAccess(q: Q, v: Viewer, id: string): Promise<TrainingAccess | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [t] = await q<Training>("SELECT * FROM training WHERE id = $1", [id]);
  if (!t) return null;
  const lead = t.urguu_id === v.urguu?.id;
  const teacher = (await q("SELECT 1 FROM training_teacher WHERE training_id = $1 AND person_id = $2", [id, v.personId])).length > 0;
  // Зөвхөн тэргүүлэх өргөөний контекстод удирдана (RLS бичихийг тэнд л зөвшөөрнө).
  const manage = lead && (v.perms.has("training.manage") || teacher);
  if (t.state === "draft" && !manage) return null;
  return { t, lead, teacher, manage };
}

export const seatsTaken = async (q: Q, trainingId: string) =>
  (await q<{ n: number }>("SELECT count(*)::int AS n FROM training_participant WHERE training_id = $1 AND state = 'yes'", [trainingId]))[0].n;

export type JoinResult = { state: "yes" | "waitlist"; participantId: string; changed: boolean; fee: number };

/**
 * Сургалтад суудал эзлүүлнэ (P3.3): суудал байвал «Ирнэ», дүүрсэн бол хүлээлгийн жагсаалт.
 * Сургалтын мөрийг түгжиж, зэрэг бүртгүүлэхэд хязгаар давахаас сэргийлнэ. Транзакц дотор дуудна.
 */
export async function joinTraining(q: Q, o: { trainingId: string; personId: string; source: "invite" | "self" | "public" | "admin" | "qr"; invitedBy?: string | null; ignoreCapacity?: boolean }): Promise<JoinResult> {
  const [t] = await q<{ capacity: number | null; fee: number }>("SELECT capacity, fee FROM training WHERE id = $1 FOR UPDATE", [o.trainingId]);
  if (!t) throw new Error("Сургалт олдсонгүй");
  const [ex] = await q<{ id: string; state: string; pay_state: string }>("SELECT id, state, pay_state FROM training_participant WHERE training_id = $1 AND person_id = $2", [o.trainingId, o.personId]);
  if (ex?.state === "yes") return { state: "yes", participantId: ex.id, changed: false, fee: t.fee };
  const full = !o.ignoreCapacity && t.capacity !== null && (await seatsTaken(q, o.trainingId)) >= t.capacity;
  const state = full ? "waitlist" : "yes";
  // Хүлээлгэд байгаа хүн: суудал гарсан эсвэл админ/QR-аар (хязгааргүй) орсон бол оролцогч болно.
  if (ex?.state === "waitlist" && full) return { state: "waitlist", participantId: ex.id, changed: false, fee: t.fee };
  const pay = (cur: string) => (cur === "paid" || cur === "refunded" ? cur : t.fee > 0 && state === "yes" ? "pending" : "none");
  if (ex) {
    await q("UPDATE training_participant SET state = $2, pay_state = $3, responded_at = clock_timestamp() WHERE id = $1", [ex.id, state, pay(ex.pay_state)]);
    return { state, participantId: ex.id, changed: true, fee: t.fee };
  }
  const [p] = await q<{ id: string }>(
    "INSERT INTO training_participant (training_id, person_id, state, source, invited_by, responded_at, pay_state) VALUES ($1,$2,$3,$4,$5, clock_timestamp(), $6) RETURNING id",
    [o.trainingId, o.personId, state, o.source, o.invitedBy ?? null, pay("none")]);
  return { state, participantId: p.id, changed: true, fee: t.fee };
}

/** Суудал суларсан үед хүлээлгийн жагсаалтаас дарааллаар нь оруулна. Орсон хүмүүсийн id-г буцаана. */
export async function promoteWaitlist(q: Q, trainingId: string): Promise<string[]> {
  const [t] = await q<{ capacity: number | null; fee: number }>("SELECT capacity, fee FROM training WHERE id = $1 FOR UPDATE", [trainingId]);
  if (!t) return [];
  const free = t.capacity === null ? 10_000 : t.capacity - (await seatsTaken(q, trainingId));
  if (free <= 0) return [];
  const rows = await q<{ person_id: string }>(
    `UPDATE training_participant SET state = 'yes', pay_state = CASE WHEN pay_state IN ('paid','refunded') THEN pay_state WHEN $3 > 0 THEN 'pending' ELSE 'none' END
     WHERE id IN (SELECT id FROM training_participant WHERE training_id = $1 AND state = 'waitlist' ORDER BY responded_at NULLS LAST, created_at, id LIMIT $2) RETURNING person_id`,
    [trainingId, free, t.fee]);
  return rows.map((r) => r.person_id);
}

/** Оролцохоо больсон (Ирэхгүй / Магадгүй / Цуцалсан). Суудал суларвал хүлээлгээс дэвшүүлнэ. */
export async function leaveTraining(q: Q, trainingId: string, personId: string, state: "no" | "maybe" | "cancelled"): Promise<string[]> {
  const [ex] = await q<{ id: string; state: string }>("SELECT id, state FROM training_participant WHERE training_id = $1 AND person_id = $2", [trainingId, personId]);
  if (!ex) return [];
  await q("UPDATE training_participant SET state = $2, responded_at = clock_timestamp() WHERE id = $1", [ex.id, state]);
  return ex.state === "yes" ? promoteWaitlist(q, trainingId) : [];
}

/** P3.6: хээрийн сургалтыг дүүргэсэн хүний «Хээрийн сургалтад суусан» талбарыг автоматаар тэмдэглэнэ. */
export async function syncFieldTraining(q: Q, personIds: string[]) {
  if (!personIds.length) return;
  await q(
    `UPDATE person p SET field_training = true WHERE p.id = ANY($1::uuid[]) AND p.field_training IS DISTINCT FROM true
       AND EXISTS (SELECT 1 FROM training_participant tp JOIN training t ON t.id = tp.training_id WHERE tp.person_id = p.id AND t.is_field AND tp.completion = 'completed')`,
    [personIds]);
}

/* ---------- P3.5 QR ирц: 15 минут тутам эргэдэг токен ---------- */
const WINDOW_MS = 15 * 60_000;
const sign = (sessionId: string, w: number) =>
  createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`att:${sessionId}:${w}`).digest("base64url").slice(0, 16);
export const attToken = (sessionId: string, at = Date.now()) => sign(sessionId, Math.floor(at / WINDOW_MS));
/** Одоогийн болон өмнөх цонхны токеныг зөвшөөрнө (15–30 минут хүчинтэй). */
export function attTokenValid(sessionId: string, token: string, at = Date.now()): boolean {
  const w = Math.floor(at / WINDOW_MS);
  return [w, w - 1].some((x) => {
    const a = Buffer.from(sign(sessionId, x)), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
/** Одоогийн токен солигдох хүртэл үлдсэн секунд. */
export const attTokenTtl = (at = Date.now()) => Math.ceil((WINDOW_MS - (at % WINDOW_MS)) / 1000);
