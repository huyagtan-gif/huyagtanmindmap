import Link from "next/link";
import { guestRsvp } from "@/app/actions/public";
import { ActBtn } from "@/components/ActBtn";
import { GuestPay } from "@/components/TrainingPay";
import { PubFooter } from "@/components/AuthFrame";
import { Icon } from "@/components/ui";
import { sys } from "@/lib/db";
import { getT, N, tMeta } from "@/lib/i18n";
import { displayName } from "@/lib/project";
import { participantByToken } from "@/lib/public";
import { fmtDay, fmtRange, money } from "@/lib/time";
import { PAY_STATE, type Training } from "@/lib/training";

export const dynamic = "force-dynamic";
export const generateMetadata = tMeta("Миний бүртгэл", { robots: { index: false }, referrer: "no-referrer" as const });

const MSG: Record<string, [string, string]> = {
  yes: ["ok", N("Та бүртгэгдлээ.")],
  waitlist: ["info", N("Суудал дүүрсэн тул та хүлээлгийн жагсаалтад орлоо.")],
  cancelled: ["info", N("Таны бүртгэл цуцлагдлаа.")],
  closed: ["bad", N("Бүртгэл хаагдсан тул дахин бүртгүүлэх боломжгүй.")],
  rate: ["bad", N("Хэт олон оролдлого хийлээ. Түр хүлээнэ үү.")],
  paid: ["ok", N("Төлбөр баталгаажлаа. Баярлалаа!")],
  unpaid: ["info", N("Төлбөр хараахан орж ирээгүй байна. Төлсөн бол хэдэн минутын дараа дахин шалгана уу.")],
  payerr: ["bad", N("Төлбөрийн нэхэмжлэх үүсгэж чадсангүй. Дараа дахин оролдоно уу.")],
};

/** P3.4: зочны «миний бүртгэл» хуудас. Нууц холбоосоор (токен) нээгдэнэ: төлөв, хуваарь, цуцлах, төлбөр. */
export default async function GuestStatus({ params, searchParams }: { params: Promise<{ code: string; token: string }>; searchParams: Promise<{ m?: string; new?: string }> }) {
  const { code, token } = await params;
  const sp = await searchParams;
  const tr = await getT();
  const q = sys as Parameters<typeof participantByToken>[0];
  const p = /^[a-z0-9]{6,20}$/.test(code) ? await participantByToken(q, code, token) : null;
  if (!p)
    return (
      <div className="pubwrap"><div className="card col g12"><h1>{tr("Бүртгэл олдсонгүй")}</h1><span className="muted">{tr("Холбоос буруу эсвэл хүчингүй болсон байна.")}</span><Link className="btn" href={`/t/${code}`}>{tr("Сургалтын хуудас")}</Link></div></div>
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
      <div className="brand" style={{ padding: 0 }}><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>{tr("Хуягтан")}</div>
      {m ? <div className={`banner ${m[0]}`} role="status">{tr(m[1])}</div> : null}
      {sp.new ? <div className="banner info" role="note">{tr("Энэ хуудасны холбоосыг хадгалж аваарай: бүртгэлээ эндээс харж, цуцална. Бусдад бүү дамжуулаарай.")}</div> : null}
      <div className="card col g12">
        <div className="col g4"><h1>{t.name}</h1><span className="muted">{displayName(p)}</span></div>
        <div className="row wrap">
          {p.state === "yes" ? <span className="chip ok">{tr("Бүртгэгдсэн")}</span> : p.state === "waitlist" ? <span className="chip warn">{tr("Хүлээлгийн жагсаалтад")}</span> : <span className="chip">{tr("Бүртгэл цуцлагдсан")}</span>}
          {t.fee > 0 && p.state === "yes" ? <span className={`chip ${PAY_STATE[p.pay_state]?.[0] || ""}`}>{tr("Төлбөр: {state}", { state: p.pay_state === "none" ? tr("шаардлагагүй") : tr(PAY_STATE[p.pay_state]?.[1] || p.pay_state) })}</span> : null}
          {p.completion === "completed" ? <span className="chip ok">{tr("Сургалтыг дүүргэсэн")}</span> : null}
          {t.state === "cancelled" ? <span className="chip bad">{tr("Сургалт цуцлагдсан")}</span> : null}
        </div>
        {p.state === "waitlist" ? <span className="small muted">{tr("Суудал суларвал таныг автоматаар оруулж, мэдэгдэнэ.")}</span> : null}
        <dl className="kv">
          <dt>{tr("Хичээл")}</dt>
          <dd>{sessions.length ? sessions.map((s, i) => <div key={s.id}>{i + 1}. {fmtDay(s.starts_at, tr.lang)} · {fmtRange(s.starts_at, s.ends_at).slice(11)}{s.title ? ` · ${s.title}` : ""}{s.att ? ` · ${tr("ирсэн")}` : ""}</div>) : tr("Хуваарь удахгүй зарлагдана")}</dd>
          {t.place ? <><dt>{tr("Байршил")}</dt><dd>{t.place}</dd></> : null}
          {t.online_url && p.state === "yes" ? <><dt>{tr("Онлайн")}</dt><dd><a href={t.online_url} target="_blank" rel="noopener noreferrer">{t.online_url}</a></dd></> : null}
          <dt>{tr("Төлбөр")}</dt><dd>{t.fee ? money(t.fee) : tr("Үнэгүй")}</dd>
        </dl>
        {p.completion === "completed" && p.certificate_code ? <Link className="btn sm" href={`/certificate/${p.certificate_code}`} style={{ alignSelf: "flex-start" }}>{tr("Сертификат харах")}</Link> : null}
        {p.state === "yes" && t.fee > 0 ? <GuestPay code={code} token={token} participantId={p.id} payState={p.pay_state} fee={t.fee} /> : null}
        {live ? (
          <div className="row wrap">
            {active ? <ActBtn action={guestRsvp} fields={{ code, token, op: "cancel" }} className="btn sm ghost" confirm={tr("Бүртгэлээ цуцлах уу? Таны суудал дараагийн хүнд очно.")}>{tr("Бүртгэлээ цуцлах")}</ActBtn>
              : t.state === "open" ? <ActBtn action={guestRsvp} fields={{ code, token, op: "join" }} className="btn pri">{tr("Дахин бүртгүүлэх")}</ActBtn> : null}
          </div>
        ) : null}
      </div>
      <PubFooter lang={tr.lang} privacy={tr("Нууцлалын бодлого")} />
    </div>
  );
}
