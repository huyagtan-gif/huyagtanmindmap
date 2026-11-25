import Link from "next/link";
import { checkinGuest, checkinMember } from "@/app/actions/public";
import { AuthFrame } from "@/components/AuthFrame";
import { AutoSubmitOnce } from "@/components/AutoRefresh";
import { sys } from "@/lib/db";
import { fmtDay, fmtTime } from "@/lib/time";
import { attTokenValid } from "@/lib/training";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Ирц бүртгүүлэх", robots: { index: false } };
export const dynamic = "force-dynamic";

const MSG: Record<string, [string, string]> = {
  ok: ["ok", "Таны ирц бүртгэгдлээ. Баярлалаа!"],
  already: ["ok", "Таны ирц аль хэдийн бүртгэгдсэн байна."],
  not_listed: ["bad", "Та энэ сургалтын жагсаалтад алга. Зохион байгуулагчид хандана уу."],
  phone: ["bad", "Утасны дугаараа зөв оруулна уу."],
  rate: ["bad", "Хэт олон оролдлого хийлээ. Түр хүлээгээд дахин оролдоно уу."],
  need_name: ["info", "Энэ дугаараар бүртгэл олдсонгүй. Нэрээ оруулж бүртгүүлнэ үү."],
};

/** P3.5: QR уншуулахад нээгдэх хуудас. Гишүүн нэвтэрсэн бол шууд, зочин утасны дугаараар. */
export default async function CheckIn({ params, searchParams }: { params: Promise<{ sid: string; token: string }>; searchParams: Promise<{ r?: string; p?: string }> }) {
  const { sid, token } = await params;
  const sp = await searchParams;
  const valid = /^[0-9a-f-]{36}$/i.test(sid) && /^[\w-]{16}$/.test(token) && attTokenValid(sid, token);
  const [s] = valid
    ? await sys<{ id: string; starts_at: Date; qr_open: boolean; name: string; scope: string }>(
        "SELECT s.id, s.starts_at, s.qr_open, t.name, t.scope FROM training_session s JOIN training t ON t.id = s.training_id WHERE s.id = $1", [sid])
    : [];
  if (!s || !s.qr_open || sp.r === "expired")
    return (
      <AuthFrame title="QR хүчингүй болсон" sub="Ирцийн QR 15 минут тутам шинэчлэгддэг. Дэлгэц дээрх шинэ QR-ыг дахин уншуулна уу.">
        <Link className="btn" href="/">Нүүр хуудас</Link>
      </AuthFrame>
    );
  const v = await getViewer();
  const m = sp.r ? MSG[sp.r] : null;
  const fin = sp.r === "ok" || sp.r === "already";
  const sub = <><b>{s.name}</b> · {fmtDay(s.starts_at)} {fmtTime(s.starts_at)}</>;
  const here = `/a/${sid}/${token}`;
  return (
    <AuthFrame title="Ирц бүртгүүлэх" sub={sub}>
      {m ? <div className={`banner ${m[0]}`} role={m[0] === "bad" ? "alert" : "status"}>{m[1]}</div> : null}
      {fin ? (
        v?.personId ? <Link className="btn" href="/me#schedule">Миний хуваарь</Link> : null
      ) : v?.personId ? (
        <form id="ci" action={checkinMember} className="col g12">
          <input type="hidden" name="sid" value={sid} /><input type="hidden" name="token" value={token} />
          <span>Сайн байна уу, <b>{v.personName || v.email}</b>.</span>
          <button className="btn pri lg">Ирцээ бүртгүүлэх</button>
          {sp.r ? null : <AutoSubmitOnce formId="ci" />}
        </form>
      ) : (
        <>
          <form action={checkinGuest} className="col g12">
            <input type="hidden" name="sid" value={sid} /><input type="hidden" name="token" value={token} />
            <label className="field"><span>Утасны дугаар <span className="req">*</span></span>
              <input className="inp" name="phone" required inputMode="tel" autoComplete="tel" placeholder="9911 2233" maxLength={20} defaultValue={sp.p || ""} autoFocus={!sp.p} />
              <span className="hint">Бүртгүүлэхдээ өгсөн дугаараа оруулна.</span>
            </label>
            {sp.r === "need_name" && s.scope === "public" ? (
              <>
                <div className="formgrid">
                  <label className="field">Эцгийн нэр<input className="inp" name="father_name" maxLength={80} /></label>
                  <label className="field"><span>Өөрийн нэр <span className="req">*</span></span><input className="inp" name="given_name" required maxLength={80} autoFocus /></label>
                </div>
                <label className="row small" style={{ gap: 10, alignItems: "flex-start" }}>
                  <input type="checkbox" name="consent" required style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--pri)" }} />
                  <span>Миний нэр, утсыг <Link href="/privacy" target="_blank">Нууцлалын бодлого</Link>-ын дагуу сургалтын бүртгэлд ашиглахыг зөвшөөрч байна.</span>
                </label>
              </>
            ) : null}
            <button className="btn pri lg">Ирцээ бүртгүүлэх</button>
          </form>
          <span className="small muted">Гишүүн үү? <Link href={`/login?next=${encodeURIComponent(here)}`}>Нэвтэрч</Link> нэг товшилтоор бүртгүүлнэ.</span>
        </>
      )}
    </AuthFrame>
  );
}
