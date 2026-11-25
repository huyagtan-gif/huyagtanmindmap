import { sys } from "./db";

// P2.7: мэдэгдлийн outbox — имэйл / SMS дараалал, дахин оролдлого.
// Хүснэгтийг зөвхөн системийн холболт уншиж бичнэ (апп-ын role эрхгүй).
export type Channel = "email" | "sms";
export const MAX_ATTEMPTS = 5;
/** n дэх амжилтгүй оролдлогын дараа хүлээх хугацаа (минут): 1, 5, 30, 120. */
export const backoffMinutes = (attempts: number) => [1, 5, 30, 120][Math.min(Math.max(attempts, 1), 4) - 1];

type Row = { id: string; channel: Channel; recipient: string; template: string; payload: any; attempts: number };

/** Дараалалд нэмнэ. */
export async function enqueue(channel: Channel, recipient: string, template: string, payload: unknown, urguuId?: string | null): Promise<string | null> {
  try {
    const [r] = await sys<{ id: string }>(
      "INSERT INTO notification_outbox (channel, recipient, template, payload, state, urguu_id) VALUES ($1,$2,$3,$4,'queued',$5) RETURNING id",
      [channel, recipient, template, JSON.stringify(payload), urguuId ?? null],
    );
    return r.id;
  } catch (e) {
    console.error("[outbox] дараалалд нэмж чадсангүй:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Дарааллаар явдаггүй (нууц агуулгатай) илгээлтийн үр дүнг бүртгэнэ. Агуулга хадгалагдахгүй. */
export async function record(channel: Channel, recipient: string, template: string, meta: unknown, error: string | null, urguuId?: string | null) {
  await sys(
    "INSERT INTO notification_outbox (channel, recipient, template, payload, state, attempts, last_error, sent_at, urguu_id) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)",
    [channel, recipient, template, JSON.stringify(meta), error ? "failed" : "sent", error, error ? null : new Date(), urguuId ?? null],
  ).catch(() => {});
}

async function deliver(r: Row): Promise<void> {
  if (r.channel === "email") {
    const { deliverMail } = await import("./mail");
    if (!r.payload?.body) throw new Error("агуулга алга");
    await deliverMail(r.recipient, r.payload);
  } else {
    const { deliverSms } = await import("./sms");
    if (!r.payload?.text) throw new Error("агуулга алга");
    await deliverSms(r.recipient, r.payload.text);
  }
}

async function attempt(r: Row): Promise<boolean> {
  try {
    await deliver(r);
    // Илгээгдсэний дараа агуулгыг цэвэрлэнэ (зөвхөн гарчиг үлдэнэ).
    await sys("UPDATE notification_outbox SET state = 'sent', sent_at = now(), last_error = NULL, payload = jsonb_build_object('subject', payload->>'subject') WHERE id = $1", [r.id]);
    return true;
  } catch (e) {
    const err = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const dead = r.attempts >= MAX_ATTEMPTS;
    await sys(
      "UPDATE notification_outbox SET state = $2, last_error = $3, next_attempt_at = now() + make_interval(mins => $4) WHERE id = $1",
      [r.id, dead ? "failed" : "queued", err, dead ? 0 : backoffMinutes(r.attempts)],
    ).catch(() => {});
    console.error(`[outbox] #${r.id} ${r.channel} илгээж чадсангүй (${r.attempts}/${MAX_ATTEMPTS}):`, err);
    return false;
  }
}

// Мөрийг "авч" оролдлогын тоог нэмнэ. next_attempt_at-ыг түр хойшлуулснаар зэрэг ажилласан хоёр ажилчин давхар илгээхгүй.
const CLAIM = `UPDATE notification_outbox o SET attempts = o.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  FROM (SELECT id FROM notification_outbox WHERE state = 'queued' AND %W ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED) c
  WHERE o.id = c.id RETURNING o.id, o.channel, o.recipient, o.template, o.payload, o.attempts`;

/** Шинээр нэмсэн мөрийг шууд нэг оролдоно. */
export async function deliverNow(id: string): Promise<boolean> {
  const [r] = await sys<Row>(CLAIM.replace("%W", "id = $2"), [1, id]).catch(() => []);
  return r ? attempt(r) : false;
}

/** Хугацаа нь болсон мөрүүдийг илгээнэ (ажилчин минут тутам дуудна). */
export async function processOutbox(limit = 10): Promise<{ sent: number; failed: number }> {
  const rows = await sys<Row>(CLAIM.replace("%W", "next_attempt_at <= now()"), [limit]);
  let sent = 0;
  for (const r of rows) if (await attempt(r)) sent++;
  return { sent, failed: rows.length - sent };
}

/** Админ: амжилтгүй болсон мөрийг дахин дараалалд оруулна. */
export async function requeue(id: string) {
  await sys("UPDATE notification_outbox SET state = 'queued', attempts = 0, next_attempt_at = now() WHERE id = $1 AND state = 'failed' AND (payload ? 'body' OR payload ? 'text')", [id]);
}
