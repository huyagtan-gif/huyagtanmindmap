import type { Q } from "./db";

// P4.6 / P4.7: санхүүгийн тайлан (өргөө тус бүр, хугацаагаар). RLS-ээр зөвхөн өөрийн өргөөний төлбөр;
// хамтарсан сургалтын хамтрагч өргөөний хувийг training_share_report() функцээр (нэгтгэсэн дүн) авна.
export type FinRange = { from: Date; to: Date; fromYmd: string; toYmd: string };
export function finRange(fromS?: string, toS?: string): FinRange {
  const ub = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  const fromYmd = ok(fromS) ? fromS! : ub.slice(0, 8) + "01";
  const toYmd = ok(toS) && toS! >= fromYmd ? toS! : ub;
  return { from: new Date(`${fromYmd}T00:00:00+08:00`), to: new Date(+new Date(`${toYmd}T00:00:00+08:00`) + 86400_000), fromYmd, toYmd };
}

export type TrainingRow = { id: string; name: string; paid_count: number; gross: number; refunded: number; shares: { urguu: string; pct: number; amount: number; lead: boolean }[] };
export type FinReport = {
  totals: { training: number; donation: number; refunded: number; pending: number; manual: number };
  trainings: TrainingRow[];
  donations: { event_id: string | null; name: string; count: number; sum: number }[];
  partner: { training_id: string; training_name: string; lead_urguu: string; share_pct: number; paid_count: number; gross: number; share: number }[];
};

export async function financeReport(q: Q, r: FinRange): Promise<FinReport> {
  // Төлбөрийг төлөгдсөн өдрөөр (paid_at) нь тооцно.
  const [t] = await q<{ training: string; donation: string; refunded: string; pending: string; manual: string }>(
    `SELECT coalesce(sum(amount) FILTER (WHERE kind = 'training' AND state = 'paid'), 0) AS training,
            coalesce(sum(amount) FILTER (WHERE kind = 'donation' AND state = 'paid'), 0) AS donation,
            coalesce(sum(amount) FILTER (WHERE state = 'refunded'), 0) AS refunded,
            (SELECT count(*) FROM payment WHERE urguu_id = app_urguu() AND state = 'pending') AS pending,
            coalesce(sum(amount) FILTER (WHERE method = 'manual' AND state = 'paid'), 0) AS manual
     FROM payment WHERE urguu_id = app_urguu() AND paid_at >= $1 AND paid_at < $2`, [r.from, r.to]);
  const trs = await q<{ id: string; name: string; paid_count: number; gross: string; refunded: string }>(
    `SELECT t.id, t.name, count(*) FILTER (WHERE p.state = 'paid')::int AS paid_count,
            coalesce(sum(p.amount) FILTER (WHERE p.state = 'paid'), 0) AS gross, coalesce(sum(p.amount) FILTER (WHERE p.state = 'refunded'), 0) AS refunded
     FROM payment p JOIN training t ON t.id = p.training_id
     WHERE p.urguu_id = app_urguu() AND p.kind = 'training' AND p.state IN ('paid','refunded') AND p.paid_at >= $1 AND p.paid_at < $2
     GROUP BY t.id, t.name ORDER BY gross DESC`, [r.from, r.to]);
  const shares = trs.length
    ? await q<{ training_id: string; urguu: string; share_pct: string; is_lead: boolean }>(
        "SELECT tu.training_id, u.name AS urguu, tu.share_pct, tu.is_lead FROM training_urguu tu JOIN urguu_names() u ON u.id = tu.urguu_id WHERE tu.training_id = ANY($1::uuid[]) ORDER BY tu.is_lead DESC, u.name",
        [trs.map((x) => x.id)])
    : [];
  const trainings: TrainingRow[] = trs.map((x) => {
    const gross = Number(x.gross);
    const sh = shares.filter((s) => s.training_id === x.id);
    return {
      id: x.id, name: x.name, paid_count: x.paid_count, gross, refunded: Number(x.refunded),
      shares: (sh.length ? sh : [{ training_id: x.id, urguu: "Энэ өргөө", share_pct: "100", is_lead: true }]).map((s) => ({ urguu: s.urguu, pct: Number(s.share_pct), amount: Math.round((gross * Number(s.share_pct)) / 100), lead: s.is_lead })),
    };
  });
  const donations = (await q<{ event_id: string | null; name: string | null; count: number; sum: string }>(
    `SELECT p.event_id, e.name, count(*)::int AS count, sum(p.amount) AS sum FROM payment p LEFT JOIN event e ON e.id = p.event_id
     WHERE p.urguu_id = app_urguu() AND p.kind = 'donation' AND p.state = 'paid' AND p.paid_at >= $1 AND p.paid_at < $2 GROUP BY p.event_id, e.name ORDER BY sum DESC`, [r.from, r.to]))
    .map((d) => ({ event_id: d.event_id, name: d.name || "Ерөнхий хандив", count: d.count, sum: Number(d.sum) }));
  const partner = (await q<{ training_id: string; training_name: string; lead_urguu: string; share_pct: string; paid_count: number; gross: string }>(
    "SELECT * FROM training_share_report($1, $2) WHERE paid_count > 0", [r.from, r.to]))
    .map((p) => ({ ...p, share_pct: Number(p.share_pct), gross: Number(p.gross), share: Math.round((Number(p.gross) * Number(p.share_pct)) / 100) }));
  return { totals: { training: Number(t.training), donation: Number(t.donation), refunded: Number(t.refunded), pending: Number(t.pending), manual: Number(t.manual) }, trainings, donations, partner };
}
