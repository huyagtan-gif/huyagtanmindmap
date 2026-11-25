import Link from "next/link";
import { guestRsvp } from "@/app/actions/public";
import { ActBtn } from "@/components/ActBtn";
import { GuestPay } from "@/components/TrainingPay";
import { Icon } from "@/components/ui";
import { sys } from "@/lib/db";
import { displayName } from "@/lib/project";
import { participantByToken } from "@/lib/public";
import { fmtDay, fmtRange, money } from "@/lib/time";
import { PAY_STATE, type Training } from "@/lib/training";

export const dynamic = "force-dynamic";
export const metadata = { title: "Миний бүртгэл", robots: { index: false }, referrer: "no-referrer" as const };

const MSG: Record<string, [string, string]> = {
  yes: ["ok", "Та бүртгэгдлээ."],
  waitlist: ["info", "Суудал дүүрсэн тул та хүлээлгийн жагсаалтад орлоо."],
  cancelled: ["info", "Таны бүртгэл цуцлагдлаа."],
  closed: ["bad", "Бүртгэл хаагдсан тул дахин бүртгүүлэх боломжгүй."],
  rate: ["bad", "Хэт олон оролдлого хийлээ. Түр хүлээнэ үү."],
  paid: ["ok", "Төлбөр баталгаажлаа. Баярлалаа!"],
  unpaid: ["info", "Төлбөр хараахан орж ирээгүй байна. Төлсөн бол хэдэн минутын дараа дахин шалгана уу."],
  payerr: ["bad", "Төлбөрийн нэхэмжлэх үүсгэж чадсангүй. Дараа дахин оролдоно уу."],
};

/** P3.4: зочны «миний бүртгэл» хуудас. Нууц холбоосоор (токен) нээгдэнэ: төлөв, хуваарь, цуцлах, төлбөр. */
export default async function GuestStatus({ params, searchParams }: { params: Promise<{ code: string; token: string }>; searchParams: Promise<{ m?: string; new?: string }> }) {
  const { code, token } = await params;
  const sp = await searchParams;
  const q = sys as Parameters<typeof participantByToken>[0];
  const p = /^[a-z0-9]{6,20}$/.test(code) ? await participantByToken(q, code, token) : null;
  if (!p)
    return (
      <div className="pubwrap"><div className="card col g12"><h1>Бүртгэл олдсонгүй</h1><span className="muted">Холбоос буруу эсвэл хүчингүй болсон байна.</span><Link className="btn" href={`/t/${code}`}>Сургалтын хуудас</Link></div></div>
    );
  const [t] = await sys<Training>("SELECT * FROM training WHERE id = $1", [p.training_id]);
  const sessions = await sys<{ id: string; title: string | null; starts_at: Date; ends_at: Date | null; att: boolean }>(
    `SELECT s.id, s.title, s.starts_at, s.ends_at, EXISTS (SELECT 1 FROM training_attendance ta WHERE ta.session_id = s.id AND ta.person_id = $2) AS att
     FROM training_session s WHERE s.training_id = $1 ORDER BY s.starts_at`, [t.id, p.person_id]);
  const m = sp.m ? MSG[sp.m] : null;
  const active = p.state === "yes" || p.state === "waitlist";
  const live = t.state === "open" || t.state === "closed";
  return (
    <div className="pubwrap">
      <div className="brand" style={{ padding: 0 }}><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>Хуягтан</div>
      {m ? <div className={`banner ${m[0]}`} role="status">{m[1]}</div> : null}
      {sp.new ? <div className="banner info" role="note">Энэ хуудасны холбоосыг хадгалж аваарай: бүртгэлээ эндээс харж, цуцална. Бусдад бүү дамжуулаарай.</div> : null}
      <div className="card col g12">
        <div className="col g4"><h1>{t.name}</h1><span className="muted">{displayName(p)}</span></div>
        <div className="row wrap">
          {p.state === "yes" ? <span className="chip ok">Бүртгэгдсэн</span> : p.state === "waitlist" ? <span className="chip warn">Хүлээлгийн жагсаалтад</span> : <span className="chip">Бүртгэл цуцлагдсан</span>}
          {t.fee > 0 && p.state === "yes" ? <span className={`chip ${PAY_STATE[p.pay_state]?.[0] || ""}`}>Төлбөр: {p.pay_state === "none" ? "шаардлагагүй" : PAY_STATE[p.pay_state]?.[1]}</span> : null}
          {p.completion === "completed" ? <span className="chip ok">Сургалтыг дүүргэсэн</span> : null}
          {t.state === "cancelled" ? <span className="chip bad">Сургалт цуцлагдсан</span> : null}
        </div>
        {p.state === "waitlist" ? <span className="small muted">Суудал суларвал таныг автоматаар оруулж, мэдэгдэнэ.</span> : null}
        <dl className="kv">
          <dt>Хичээл</dt>
          <dd>{sessions.length ? sessions.map((s, i) => <div key={s.id}>{i + 1}. {fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at).slice(11)}{s.title ? ` · ${s.title}` : ""}{s.att ? " · ирсэн" : ""}</div>) : "Хуваарь удахгүй зарлагдана"}</dd>
          {t.place ? <><dt>Байршил</dt><dd>{t.place}</dd></> : null}
          {t.online_url && p.state === "yes" ? <><dt>Онлайн</dt><dd><a href={t.online_url} target="_blank" rel="noopener noreferrer">{t.online_url}</a></dd></> : null}
          <dt>Төлбөр</dt><dd>{t.fee ? money(t.fee) : "Үнэгүй"}</dd>
        </dl>
        {p.state === "yes" && t.fee > 0 ? <GuestPay code={code} token={token} participantId={p.id} payState={p.pay_state} fee={t.fee} /> : null}
        {live ? (
          <div className="row wrap">
            {active ? <ActBtn action={guestRsvp} fields={{ code, token, op: "cancel" }} className="btn sm ghost" confirm="Бүртгэлээ цуцлах уу? Таны суудал дараагийн хүнд очно.">Бүртгэлээ цуцлах</ActBtn>
              : t.state === "open" ? <ActBtn action={guestRsvp} fields={{ code, token, op: "join" }} className="btn pri">Дахин бүртгүүлэх</ActBtn> : null}
          </div>
        ) : null}
      </div>
      <span className="tiny muted" style={{ textAlign: "center" }}><Link href="/privacy">Нууцлалын бодлого</Link></span>
    </div>
  );
}
