import Link from "next/link";
import { toggleQr } from "@/app/actions/training";
import { ActBtn } from "@/components/ActBtn";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Qr } from "@/components/Qr";
import { Empty, Icon } from "@/components/ui";
import { SITE_URL } from "@/lib/mail";
import { fmtDay, fmtRange } from "@/lib/time";
import { attToken, attTokenTtl, trainingAccess } from "@/lib/training";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Ирцийн QR" };

/** P3.5: хичээлийн ирцийн QR-ыг дэлгэцэнд томоор. Токен 15 минут тутам эргэнэ, хуудас өөрөө шинэчлэгдэнэ. */
export default async function QrPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const v = await requireMember();
  const { id, sid } = await params;
  const d = await asViewer(v, async (q) => {
    const a = await trainingAccess(q, v, id);
    if (!a?.manage || !/^[0-9a-f-]{36}$/i.test(sid)) return null;
    const [s] = await q<{ id: string; title: string | null; starts_at: Date; ends_at: Date | null; qr_open: boolean; n: number; idx: number }>(
      `SELECT s.id, s.title, s.starts_at, s.ends_at, s.qr_open,
         (SELECT count(*)::int FROM training_attendance ta WHERE ta.session_id = s.id) AS n,
         (SELECT count(*)::int FROM training_session x WHERE x.training_id = s.training_id AND x.starts_at <= s.starts_at) AS idx
       FROM training_session s WHERE s.id = $1 AND s.training_id = $2`, [sid, id]);
    if (!s) return null;
    const [c] = await q<{ n: number }>("SELECT count(*)::int AS n FROM training_participant WHERE training_id = $1 AND state = 'yes'", [id]);
    return { t: a.t, s, reg: c.n };
  });
  if (!d) return <Empty title="Хичээл олдсонгүй"><Link href="/trainings">Сургалт руу буцах</Link></Empty>;
  const { t, s, reg } = d;
  const back = `/trainings/${t.id}?tab=sess`;
  return (
    <>
      <AutoRefresh ms={20_000} />
      <Link href={back} className="row small" style={{ gap: 4, fontWeight: 500 }}><Icon n="back" s={14} w={2.4} />{t.name}</Link>
      <div className="col g16" style={{ alignItems: "center", textAlign: "center", maxWidth: 560, margin: "0 auto", width: "100%" }}>
        <div className="col g4">
          <h1>{s.idx}-р хичээлийн ирц</h1>
          <span className="muted">{fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at).slice(11)}{s.title ? ` · ${s.title}` : ""}</span>
        </div>
        {s.qr_open ? (
          <>
            <div style={{ width: "min(460px, 100%)" }}><Qr text={`${SITE_URL}/a/${s.id}/${attToken(s.id)}`} /></div>
            <b style={{ font: "800 28px var(--f-head)" }} className="num" aria-live="polite">{s.n} / {reg} ирсэн</b>
            <span className="small muted">Утасныхаа камераар QR-ыг уншуулна уу. Гишүүд нэвтэрсэн бол ирц шууд бүртгэгдэнэ, зочид утасны дугаараа оруулна. Код {Math.ceil(attTokenTtl() / 60)} минутын дараа шинэчлэгдэнэ.</span>
            <ActBtn action={toggleQr} fields={{ training_id: t.id, id: s.id, back }} className="btn">QR хаах</ActBtn>
          </>
        ) : (
          <>
            <Empty title="QR хаалттай байна">Ирц бүртгэж эхлэхдээ нээнэ үү.</Empty>
            <ActBtn action={toggleQr} fields={{ training_id: t.id, id: s.id, back: `/trainings/${t.id}/qr/${s.id}` }} className="btn pri">QR нээх</ActBtn>
          </>
        )}
      </div>
    </>
  );
}
